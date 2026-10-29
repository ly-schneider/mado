import { type LeadStage, type SearchResults } from "@mado/contract";
import { companies, contacts, docs, leads, tasks } from "@mado/db";
import { Injectable } from "@nestjs/common";
import { and, desc, eq, ilike, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import { DbService } from "../db";
import type { Actor } from "../lib/actor";
import { AccessService } from "./access.service";
import { docPaths, resolveActors } from "./task.service";

type Kind = "tasks" | "docs" | "leads";

const KEY_RE = /^[A-Za-z][A-Za-z0-9]{1,4}-\d+$/;
const HEADLINE_OPTS = "StartSel=\u0002,StopSel=\u0003,MaxWords=14,MinWords=6,MaxFragments=1,FragmentDelimiter= … ";

/** ts_headline output as plain text: no highlight markers, no Markdown syntax. */
function cleanSnippet(s: string | null): string | null {
  if (!s) return null;
  const text = s
    .replace(/[\u0002\u0003]/g, "")
    .replace(/\[\[|\]\]/g, "")
    .replace(/\[[ xX]\]|\[[ xX]?$/g, "")
    .replace(/(^|\s)-(?=\s)/g, "$1")
    .replace(/[#*`>_]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const bodyVector = (col: SQL | unknown) =>
  sql`(to_tsvector('english', coalesce(${col}, '')) || to_tsvector('german', coalesce(${col}, '')) || to_tsvector('simple', coalesce(${col}, '')))`;

const titleVector = (col: SQL | unknown) =>
  sql`(to_tsvector('simple', coalesce(${col}, '')) || to_tsvector('english', coalesce(${col}, '')) || to_tsvector('german', coalesce(${col}, '')))`;

@Injectable()
export class SearchService {
  constructor(
    private readonly dbs: DbService,
    private readonly access: AccessService,
  ) {}

  /**
   * The user's text OR'ed through simple, English and German parsers, plus a prefix match on the
   * last word so results show up while typing ("rru" finds RRULE). Words are reduced to letters and
   * digits before they reach to_tsquery, so input can never produce a tsquery syntax error.
   */
  private tsquery(q: string): SQL {
    const words = q.match(/[\p{L}\p{N}]+/gu) ?? [];
    // A one-letter prefix matches half the dictionary; short input falls back to the title ILIKE.
    const last = words[words.length - 1];
    const prefix = last && last.length >= 2 ? words.map((w, i) => (i === words.length - 1 ? `${w}:*` : w)).join(" & ") : null;
    const ws = sql`websearch_to_tsquery('simple', ${q}) || websearch_to_tsquery('english', ${q}) || websearch_to_tsquery('german', ${q})`;
    return prefix ? sql`(${ws} || to_tsquery('simple', ${prefix}))` : sql`(${ws})`;
  }

  async query(actor: Actor, input: { workspaceId: string; q: string; types?: Kind[]; limit: number }): Promise<SearchResults> {
    const started = performance.now();
    await this.access.requireWorkspace(actor, input.workspaceId);
    const q = input.q.trim();
    const want = new Set<Kind>(input.types?.length ? input.types : ["tasks", "docs", "leads"]);
    if (!q) return { tasks: [], docs: [], leads: [], ms: Math.round(performance.now() - started) };

    const tsq = this.tsquery(q);
    const like = `%${escapeLike(q)}%`;
    const [taskHits, docHits, leadHits] = await Promise.all([
      want.has("tasks") ? this.tasks(actor, input.workspaceId, q, tsq, like, input.limit) : [],
      want.has("docs") ? this.docs(actor, input.workspaceId, tsq, like, input.limit) : [],
      want.has("leads") ? this.leads(actor, input.workspaceId, tsq, like, input.limit) : [],
    ]);
    return { tasks: taskHits, docs: docHits, leads: leadHits, ms: Math.round(performance.now() - started) };
  }

  private async tasks(actor: Actor, workspaceId: string, q: string, tsq: SQL, like: string, limit: number): Promise<SearchResults["tasks"]> {
    const projectIds = await this.access.readableProjectIds(actor, workspaceId, "tasks");
    if (projectIds.length === 0) return [];
    const key = KEY_RE.test(q) ? q.toUpperCase() : null;
    const rank = sql<number>`ts_rank(${tasks.search}, ${tsq})
      + case when ${tasks.title} ilike ${like} then 0.3 else 0 end
      + case when ${tasks.key} = ${key ?? ""} then 10 else 0 end`;
    const rows = await this.dbs.db
      .select({
        id: tasks.id,
        key: tasks.key,
        title: tasks.title,
        status: tasks.status,
        assigneeUserId: tasks.assigneeUserId,
        assigneeGrantId: tasks.assigneeGrantId,
        rank,
      })
      .from(tasks)
      .where(
        and(
          isNull(tasks.deletedAt),
          inArray(tasks.projectId, projectIds),
          or(sql`${tasks.search} @@ ${tsq}`, ilike(tasks.title, like), key ? eq(tasks.key, key) : undefined),
        ),
      )
      .orderBy(desc(rank), desc(tasks.updatedAt))
      .limit(limit);
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const [snippets, actors] = await Promise.all([
      this.dbs.db
        .select({ id: tasks.id, snippet: sql<string>`ts_headline('english', ${tasks.description}, ${tsq}, ${HEADLINE_OPTS})` })
        .from(tasks)
        .where(
          and(
            inArray(tasks.id, ids),
            sql`${bodyVector(tasks.description)} @@ ${tsq}`,
            sql`not (${titleVector(tasks.title)} @@ ${tsq})`,
            sql`${tasks.title} not ilike ${like}`,
          ),
        ),
      resolveActors(this.dbs.db, [
        ...rows.filter((r) => r.assigneeUserId).map((r) => ({ type: "user", id: r.assigneeUserId! })),
        ...rows.filter((r) => r.assigneeGrantId).map((r) => ({ type: "agent", id: r.assigneeGrantId! })),
      ]),
    ]);
    const snippetBy = new Map(snippets.map((s) => [s.id, cleanSnippet(s.snippet)]));
    return rows.map((r) => {
      const a = r.assigneeUserId ? actors.get(`user:${r.assigneeUserId}`) : r.assigneeGrantId ? actors.get(`agent:${r.assigneeGrantId}`) : undefined;
      return {
        id: r.id,
        key: r.key,
        title: r.title,
        status: r.status,
        assignee: a ? { type: a.type as "user" | "agent", id: a.id, name: a.name, initials: a.initials } : null,
        snippet: snippetBy.get(r.id) ?? null,
      };
    });
  }

  private async docs(actor: Actor, workspaceId: string, tsq: SQL, like: string, limit: number): Promise<SearchResults["docs"]> {
    const projectIds = await this.access.readableProjectIds(actor, workspaceId, "docs");
    // Workspace-level pages: every member sees them, agents only with an all-projects grant.
    const workspacePages =
      actor.type === "user" || (actor.type === "agent" && actor.grant.projectScope === "all" && actor.grant.resourceTypes.includes("docs"));
    const scope = or(
      projectIds.length ? inArray(docs.projectId, projectIds) : undefined,
      workspacePages ? isNull(docs.projectId) : undefined,
    );
    if (!scope) return [];
    const rank = sql<number>`ts_rank(${docs.search}, ${tsq}) + case when ${docs.title} ilike ${like} then 0.3 else 0 end`;
    const rows = await this.dbs.db
      .select({ id: docs.id, title: docs.title, updatedAt: docs.updatedAt, rank })
      .from(docs)
      .where(and(eq(docs.workspaceId, workspaceId), isNull(docs.deletedAt), scope, or(sql`${docs.search} @@ ${tsq}`, ilike(docs.title, like))))
      .orderBy(desc(rank), desc(docs.updatedAt))
      .limit(limit);
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [snippets, pathOf] = await Promise.all([
      this.dbs.db
        .select({ id: docs.id, snippet: sql<string>`ts_headline('english', ${docs.content}, ${tsq}, ${HEADLINE_OPTS})` })
        .from(docs)
        .where(
          and(
            inArray(docs.id, ids),
            sql`${bodyVector(docs.content)} @@ ${tsq}`,
            sql`not (${titleVector(docs.title)} @@ ${tsq})`,
            sql`${docs.title} not ilike ${like}`,
          ),
        ),
      docPaths(this.dbs.db, workspaceId),
    ]);
    const snippetBy = new Map(snippets.map((s) => [s.id, cleanSnippet(s.snippet)]));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      path: pathOf(r.id),
      snippet: snippetBy.get(r.id) ?? null,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  private async leads(actor: Actor, workspaceId: string, tsq: SQL, like: string, limit: number): Promise<SearchResults["leads"]> {
    const projectIds = await this.access.readableProjectIds(actor, workspaceId, "crm");
    if (projectIds.length === 0) return [];
    const nameMatch = sql`(to_tsvector('simple', ${companies.name}) @@ ${tsq} or ${companies.name} ilike ${like} or ${companies.location} ilike ${like} or coalesce(${contacts.name}, '') ilike ${like})`;
    const rank = sql<number>`ts_rank(${leads.search}, ${tsq}) + case when ${nameMatch} then 1 else 0 end`;
    const rows = await this.dbs.db
      .select({
        id: leads.id,
        company: companies.name,
        contact: contacts.name,
        stage: leads.stage,
        nameHit: sql<boolean>`${nameMatch}`,
        snippet: sql<string | null>`case when ${bodyVector(leads.notes)} @@ ${tsq} then ts_headline('english', ${leads.notes}, ${tsq}, ${HEADLINE_OPTS}) end`,
        rank,
      })
      .from(leads)
      .innerJoin(companies, eq(companies.id, leads.companyId))
      .leftJoin(contacts, and(eq(contacts.id, leads.contactId), isNull(contacts.deletedAt)))
      .where(
        and(
          isNull(leads.deletedAt),
          inArray(leads.projectId, projectIds),
          or(sql`${leads.search} @@ ${tsq}`, nameMatch, ilike(leads.notes, like)),
        ),
      )
      .orderBy(desc(rank), desc(leads.updatedAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      company: r.company,
      contact: r.contact ?? null,
      stage: r.stage as LeadStage,
      snippet: r.nameHit ? null : cleanSnippet(r.snippet),
    }));
  }
}
