import { TRASH_RETENTION_DAYS, type TrashItem } from "@mado/contract";
import {
  agentGrantProjects,
  comments,
  companies,
  contacts,
  docs,
  favorites,
  gitLinks,
  labels,
  leads,
  notifications,
  projects,
  refs,
  repos,
  revisions,
  shareLinks,
  taskDocs,
  taskLabels,
  tasks,
  type Tx,
} from "@mado/db";
import { Injectable } from "@nestjs/common";
import { and, eq, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DbService } from "../db";
import type { Actor } from "../lib/actor";
import { notFound } from "../lib/errors";
import { AccessService } from "./access.service";
import { AuditService } from "./audit.service";
import { DocService } from "./doc.service";
import { RefsService } from "./refs.service";
import { docPaths, resolveActors } from "./task.service";

export type TrashType = TrashItem["entityType"];

interface Located {
  workspaceId: string;
  projectId: string | null;
  label: string;
  deletedAt: Date | null;
}

type PurgeSet = Record<TrashType, string[]>;

const emptySet = (): PurgeSet => ({ task: [], doc: [], comment: [], lead: [], label: [], project: [] });
const RETENTION_MS = TRASH_RETENTION_DAYS * 86_400_000;
const restored = { deletedAt: null, deletedByType: null, deletedById: null };

/**
 * Trash = every soft-deleted row. Restore needs the same level the delete needed. Purge is the only
 * hard delete in the app: owner-only, user-only (never an agent), and it runs on the mado_purge
 * connection because the app role has no DELETE on core tables. Audit rows always survive.
 */
@Injectable()
export class TrashService {
  constructor(
    private readonly dbs: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly refsService: RefsService,
    private readonly docService: DocService,
  ) {}

  private get db() {
    return this.dbs.db;
  }

  async list(actor: Actor, workspaceId: string): Promise<TrashItem[]> {
    await this.access.requireWorkspace(actor, workspaceId);
    this.access.requireAccount(actor);
    const items = await this.collect(workspaceId, actor);
    const actors = await resolveActors(
      this.db,
      items.map((i) => ({ type: i.deletedByType ?? "system", id: i.deletedById ?? "system" })),
    );
    return items
      .map((i) => ({
        entityType: i.entityType,
        id: i.id,
        title: i.title,
        subtitle: i.subtitle,
        deletedAt: i.deletedAt.toISOString(),
        deletedBy: actors.get(`${i.deletedByType ?? "system"}:${i.deletedById ?? "system"}`)!,
        purgeAt: new Date(i.deletedAt.getTime() + RETENTION_MS).toISOString(),
      }))
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }

  /** Top-level trash entries: children that went with their parent (pages, comments of a deleted task) are folded in. */
  private async collect(workspaceId: string, actor: Actor | null) {
    const allProjects = await this.db
      .select({ id: projects.id, key: projects.key, name: projects.name, deletedAt: projects.deletedAt, deletedByType: projects.deletedByType, deletedById: projects.deletedById })
      .from(projects)
      .where(eq(projects.workspaceId, workspaceId));
    const projectName = new Map(allProjects.map((p) => [p.id, p.name]));
    const agent = actor?.type === "agent" ? actor : null;
    const allowed = async (resource: "tasks" | "docs" | "crm") =>
      agent ? await this.access.readableProjectIds(agent, workspaceId, resource) : allProjects.map((p) => p.id);
    const [taskProjects, docProjects, crmProjects] = await Promise.all([allowed("tasks"), allowed("docs"), allowed("crm")]);
    const workspacePages = !agent || (agent.grant.projectScope === "all" && agent.grant.resourceTypes.includes("docs"));
    const commentProjects = agent && !agent.grant.resourceTypes.includes("comments") ? [] : taskProjects;

    const out: {
      entityType: TrashType;
      id: string;
      title: string;
      subtitle: string;
      deletedAt: Date;
      deletedByType: string | null;
      deletedById: string | null;
    }[] = [];

    if (!agent) {
      for (const p of allProjects) {
        if (p.deletedAt) out.push({ entityType: "project", id: p.id, title: p.name, subtitle: `Project · ${p.key}`, deletedAt: p.deletedAt, deletedByType: p.deletedByType, deletedById: p.deletedById });
      }
    }

    if (taskProjects.length) {
      const rows = await this.db
        .select({ id: tasks.id, key: tasks.key, title: tasks.title, projectId: tasks.projectId, type: tasks.type, deletedAt: tasks.deletedAt, deletedByType: tasks.deletedByType, deletedById: tasks.deletedById })
        .from(tasks)
        .where(and(inArray(tasks.projectId, taskProjects), isNotNull(tasks.deletedAt)));
      for (const t of rows) {
        out.push({ entityType: "task", id: t.id, title: `${t.key} ${t.title}`, subtitle: `${t.type === "epic" ? "Epic" : t.type === "bug" ? "Bug" : "Task"} · ${projectName.get(t.projectId) ?? ""}`, deletedAt: t.deletedAt!, deletedByType: t.deletedByType, deletedById: t.deletedById });
      }
      const labelRows = await this.db
        .select({ id: labels.id, name: labels.name, projectId: labels.projectId, deletedAt: labels.deletedAt, deletedByType: labels.deletedByType, deletedById: labels.deletedById })
        .from(labels)
        .where(and(inArray(labels.projectId, taskProjects), isNotNull(labels.deletedAt)));
      for (const l of labelRows) {
        out.push({ entityType: "label", id: l.id, title: l.name, subtitle: `Label · ${projectName.get(l.projectId) ?? ""}`, deletedAt: l.deletedAt!, deletedByType: l.deletedByType, deletedById: l.deletedById });
      }
    }

    if (commentProjects.length) {
      const rows = await this.db
        .select({ id: comments.id, body: comments.body, key: tasks.key, deletedAt: comments.deletedAt, deletedByType: comments.deletedByType, deletedById: comments.deletedById })
        .from(comments)
        .innerJoin(tasks, eq(tasks.id, comments.taskId))
        .where(and(inArray(tasks.projectId, commentProjects), isNotNull(comments.deletedAt), isNull(tasks.deletedAt)));
      for (const c of rows) {
        const body = c.body.replace(/\s+/g, " ").trim();
        out.push({ entityType: "comment", id: c.id, title: body.length > 80 ? `${body.slice(0, 79)}…` : body, subtitle: `Comment · ${c.key}`, deletedAt: c.deletedAt!, deletedByType: c.deletedByType, deletedById: c.deletedById });
      }
    }

    const parent = alias(docs, "parent");
    const docScope = or(docProjects.length ? inArray(docs.projectId, docProjects) : undefined, workspacePages ? isNull(docs.projectId) : undefined);
    if (docScope) {
      const rows = await this.db
        .select({ id: docs.id, title: docs.title, projectId: docs.projectId, deletedAt: docs.deletedAt, deletedByType: docs.deletedByType, deletedById: docs.deletedById })
        .from(docs)
        .leftJoin(parent, eq(parent.id, docs.parentId))
        .where(
          and(
            eq(docs.workspaceId, workspaceId),
            isNotNull(docs.deletedAt),
            docScope,
            or(isNull(parent.id), isNull(parent.deletedAt), ne(parent.deletedAt, docs.deletedAt)),
          ),
        );
      if (rows.length) {
        const pathOf = await docPaths(this.db, workspaceId);
        for (const d of rows) {
          const where = pathOf(d.id) || (d.projectId ? projectName.get(d.projectId) : null) || "Wiki";
          out.push({ entityType: "doc", id: d.id, title: d.title, subtitle: `Page · ${where}`, deletedAt: d.deletedAt!, deletedByType: d.deletedByType, deletedById: d.deletedById });
        }
      }
    }

    if (crmProjects.length) {
      const rows = await this.db
        .select({ id: leads.id, company: companies.name, projectId: leads.projectId, deletedAt: leads.deletedAt, deletedByType: leads.deletedByType, deletedById: leads.deletedById })
        .from(leads)
        .innerJoin(companies, eq(companies.id, leads.companyId))
        .where(and(inArray(leads.projectId, crmProjects), isNotNull(leads.deletedAt)));
      for (const l of rows) {
        out.push({ entityType: "lead", id: l.id, title: l.company, subtitle: `Lead · ${projectName.get(l.projectId) ?? ""}`, deletedAt: l.deletedAt!, deletedByType: l.deletedByType, deletedById: l.deletedById });
      }
    }
    return out;
  }

  private async locate(type: TrashType, id: string): Promise<Located> {
    const db = this.db;
    switch (type) {
      case "project": {
        const [p] = await db.select().from(projects).where(eq(projects.id, id));
        if (!p) break;
        return { workspaceId: p.workspaceId, projectId: p.id, label: `${p.name} ${p.key}`, deletedAt: p.deletedAt };
      }
      case "task": {
        const [r] = await db
          .select({ t: tasks, workspaceId: projects.workspaceId })
          .from(tasks)
          .innerJoin(projects, eq(projects.id, tasks.projectId))
          .where(eq(tasks.id, id));
        if (!r) break;
        return { workspaceId: r.workspaceId, projectId: r.t.projectId, label: `${r.t.key} ${r.t.title}`, deletedAt: r.t.deletedAt };
      }
      case "comment": {
        const [r] = await db
          .select({ c: comments, key: tasks.key, title: tasks.title, projectId: tasks.projectId, workspaceId: projects.workspaceId })
          .from(comments)
          .innerJoin(tasks, eq(tasks.id, comments.taskId))
          .innerJoin(projects, eq(projects.id, tasks.projectId))
          .where(eq(comments.id, id));
        if (!r) break;
        return { workspaceId: r.workspaceId, projectId: r.projectId, label: `${r.key} ${r.title}`, deletedAt: r.c.deletedAt };
      }
      case "doc": {
        const [d] = await db.select().from(docs).where(eq(docs.id, id));
        if (!d) break;
        return { workspaceId: d.workspaceId, projectId: d.projectId, label: d.title, deletedAt: d.deletedAt };
      }
      case "lead": {
        const [r] = await db
          .select({ l: leads, company: companies.name, workspaceId: projects.workspaceId })
          .from(leads)
          .innerJoin(companies, eq(companies.id, leads.companyId))
          .innerJoin(projects, eq(projects.id, leads.projectId))
          .where(eq(leads.id, id));
        if (!r) break;
        return { workspaceId: r.workspaceId, projectId: r.l.projectId, label: r.company, deletedAt: r.l.deletedAt };
      }
      case "label": {
        const [r] = await db
          .select({ l: labels, workspaceId: projects.workspaceId })
          .from(labels)
          .innerJoin(projects, eq(projects.id, labels.projectId))
          .where(eq(labels.id, id));
        if (!r) break;
        return { workspaceId: r.workspaceId, projectId: r.l.projectId, label: r.l.name, deletedAt: r.l.deletedAt };
      }
    }
    throw notFound("Item");
  }

  async restore(actor: Actor, type: TrashType, id: string) {
    const loc = await this.locate(type, id);
    if (type === "project") await this.access.requireOwner(actor, loc.workspaceId);
    else if (type === "doc") await this.access.requireDoc(actor, id, "delete", { includeDeleted: true });
    else {
      const resource = type === "lead" ? "crm" : type === "comment" ? "comments" : "tasks";
      await this.access.requireProject(actor, loc.projectId!, "delete", resource);
    }
    if (!loc.deletedAt) return;

    await this.db.transaction(async (tx) => {
      switch (type) {
        case "project":
          await tx.update(projects).set(restored).where(eq(projects.id, id));
          break;
        case "task": {
          const [t] = await tx.update(tasks).set(restored).where(eq(tasks.id, id)).returning();
          const bodies = await tx.select({ body: comments.body }).from(comments).where(and(eq(comments.taskId, id), isNull(comments.deletedAt)));
          await this.refsService.rebuild(tx, { type: "task", id, workspaceId: loc.workspaceId }, [t!.description, ...bodies.map((b) => b.body)].join("\n"));
          break;
        }
        case "comment":
          await tx.update(comments).set(restored).where(eq(comments.id, id));
          break;
        case "label":
          await tx.update(labels).set(restored).where(eq(labels.id, id));
          break;
        case "lead": {
          const [l] = await tx.update(leads).set(restored).where(eq(leads.id, id)).returning();
          await tx.update(companies).set(restored).where(and(eq(companies.id, l!.companyId), isNotNull(companies.deletedAt)));
          if (l!.contactId) await tx.update(contacts).set(restored).where(and(eq(contacts.id, l!.contactId), isNotNull(contacts.deletedAt)));
          break;
        }
        case "doc":
          await this.restoreDoc(tx, id, loc);
          break;
      }
      await this.audit.record(tx, actor, {
        workspaceId: loc.workspaceId,
        projectId: loc.projectId,
        action: `${type}.restore`,
        entityType: type,
        entityId: id,
        entityLabel: loc.label,
      });
    });
  }

  /** Brings back the page and the sub-pages deleted with it; a page whose parent is still in the trash lands at the root. */
  private async restoreDoc(tx: Tx, id: string, loc: Located) {
    const [doc] = await tx.select({ parentId: docs.parentId }).from(docs).where(eq(docs.id, id));
    if (doc?.parentId) {
      const [p] = await tx.select({ deletedAt: docs.deletedAt }).from(docs).where(eq(docs.id, doc.parentId));
      if (!p || p.deletedAt) await tx.update(docs).set({ parentId: null }).where(eq(docs.id, id));
    }
    const ids = await this.docService.restoreSubtree(tx, id, loc.deletedAt!);
    if (ids.length === 0) await tx.update(docs).set(restored).where(eq(docs.id, id));
    const restoredDocs = await tx.select({ id: docs.id, content: docs.content }).from(docs).where(inArray(docs.id, ids.length ? ids : [id]));
    for (const d of restoredDocs) await this.refsService.rebuild(tx, { type: "doc", id: d.id, workspaceId: loc.workspaceId }, d.content);
  }

  async purge(actor: Actor, type: TrashType, id: string) {
    const loc = await this.locate(type, id);
    await this.access.requireOwner(actor, loc.workspaceId);
    if (!loc.deletedAt) throw notFound("Item in trash");
    const set = emptySet();
    set[type].push(id);
    await this.dbs.purgeDb.transaction((tx) => this.purgeSet(tx, set));
    await this.db.transaction((tx) =>
      this.audit.record(tx, actor, {
        workspaceId: loc.workspaceId,
        projectId: loc.projectId,
        action: `${type}.purge`,
        entityType: type,
        entityId: id,
        entityLabel: loc.label,
      }),
    );
  }

  async empty(actor: Actor, workspaceId: string) {
    await this.access.requireOwner(actor, workspaceId);
    const items = await this.collect(workspaceId, null);
    if (items.length === 0) return { purged: 0 };
    const set = emptySet();
    for (const i of items) set[i.entityType].push(i.id);
    await this.dbs.purgeDb.transaction((tx) => this.purgeSet(tx, set));
    await this.db.transaction((tx) =>
      this.audit.record(tx, actor, {
        workspaceId,
        action: "trash.empty",
        entityType: "trash",
        entityId: workspaceId,
        entityLabel: "Trash",
        before: { items: items.map((i) => ({ type: i.entityType, id: i.id, title: i.title })) },
      }),
    );
    return { purged: items.length };
  }

  /** Called by the nightly job: removes everything that has been in the trash longer than the retention. */
  async purgeExpired(now = new Date()) {
    const cutoff = new Date(now.getTime() - RETENTION_MS);
    const db = this.db;
    const ids = async (table: typeof tasks | typeof docs | typeof comments | typeof leads | typeof labels | typeof projects) =>
      (await db.select({ id: table.id }).from(table).where(lt(table.deletedAt, cutoff))).map((r) => r.id);
    const set: PurgeSet = {
      project: await ids(projects),
      task: await ids(tasks),
      doc: await ids(docs),
      comment: await ids(comments),
      lead: await ids(leads),
      label: await ids(labels),
    };
    const total = Object.values(set).reduce((n, list) => n + list.length, 0);
    if (total > 0) await this.dbs.purgeDb.transaction((tx) => this.purgeSet(tx, set));
    return { purged: total };
  }

  // ── Hard delete (purge role only) ─────────────────────────────────────

  private async purgeSet(tx: Tx, set: PurgeSet) {
    for (const projectId of set.project) await this.purgeProject(tx, projectId);
    await this.purgeTasks(tx, set.task);
    await this.purgeDocs(tx, await this.withDeletedDescendants(tx, set.doc));
    if (set.comment.length) await tx.delete(comments).where(inArray(comments.id, set.comment));
    await this.purgeLeads(tx, set.lead);
    await this.purgeLabels(tx, set.label);
  }

  private async purgeProject(tx: Tx, projectId: string) {
    const taskIds = (await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, projectId))).map((r) => r.id);
    const docIds = (await tx.select({ id: docs.id }).from(docs).where(eq(docs.projectId, projectId))).map((r) => r.id);
    const leadIds = (await tx.select({ id: leads.id }).from(leads).where(eq(leads.projectId, projectId))).map((r) => r.id);
    const labelIds = (await tx.select({ id: labels.id }).from(labels).where(eq(labels.projectId, projectId))).map((r) => r.id);
    await this.purgeTasks(tx, taskIds);
    await this.purgeDocs(tx, docIds);
    await this.purgeLeads(tx, leadIds);
    await this.purgeLabels(tx, labelIds);
    await tx.delete(contacts).where(eq(contacts.projectId, projectId));
    await tx.delete(companies).where(eq(companies.projectId, projectId));
    await tx.delete(repos).where(eq(repos.projectId, projectId));
    await tx.delete(agentGrantProjects).where(eq(agentGrantProjects.projectId, projectId));
    await tx.delete(projects).where(eq(projects.id, projectId));
  }

  private async purgeTasks(tx: Tx, ids: string[]) {
    if (ids.length === 0) return;
    await tx.delete(taskLabels).where(inArray(taskLabels.taskId, ids));
    await tx.delete(taskDocs).where(inArray(taskDocs.taskId, ids));
    await tx
      .delete(refs)
      .where(or(and(eq(refs.sourceType, "task"), inArray(refs.sourceId, ids)), and(eq(refs.targetType, "task"), inArray(refs.targetId, ids))));
    await tx.delete(gitLinks).where(inArray(gitLinks.taskId, ids));
    await tx.delete(comments).where(inArray(comments.taskId, ids));
    await tx.delete(notifications).where(and(eq(notifications.entityType, "task"), inArray(notifications.entityId, ids)));
    await tx.delete(revisions).where(and(eq(revisions.entityType, "task"), inArray(revisions.entityId, ids)));
    await tx.update(tasks).set({ epicId: null }).where(and(inArray(tasks.epicId, ids), notInArray(tasks.id, ids)));
    await tx.delete(tasks).where(inArray(tasks.id, ids));
  }

  /** Sub-pages deleted along with a page go with it; live sub-pages (restored separately) move to the root. */
  private async withDeletedDescendants(tx: Tx, rootIds: string[]) {
    const all = new Set(rootIds);
    let frontier = rootIds;
    while (frontier.length) {
      const rows = await tx
        .select({ id: docs.id })
        .from(docs)
        .where(and(inArray(docs.parentId, frontier), isNotNull(docs.deletedAt)));
      frontier = rows.map((r) => r.id).filter((id) => !all.has(id));
      for (const id of frontier) all.add(id);
    }
    return [...all];
  }

  private async purgeDocs(tx: Tx, ids: string[]) {
    if (ids.length === 0) return;
    await tx.update(docs).set({ parentId: null }).where(and(inArray(docs.parentId, ids), notInArray(docs.id, ids)));
    await tx.delete(taskDocs).where(inArray(taskDocs.docId, ids));
    await tx
      .delete(refs)
      .where(or(and(eq(refs.sourceType, "doc"), inArray(refs.sourceId, ids)), and(eq(refs.targetType, "doc"), inArray(refs.targetId, ids))));
    await tx.delete(favorites).where(inArray(favorites.docId, ids));
    await tx.delete(shareLinks).where(inArray(shareLinks.docId, ids));
    await tx.delete(notifications).where(and(eq(notifications.entityType, "doc"), inArray(notifications.entityId, ids)));
    await tx.delete(revisions).where(and(eq(revisions.entityType, "doc"), inArray(revisions.entityId, ids)));
    await tx.delete(docs).where(inArray(docs.id, ids));
  }

  /** Companies and contacts go too once no remaining lead points at them. */
  private async purgeLeads(tx: Tx, ids: string[]) {
    if (ids.length === 0) return;
    const rows = await tx.select({ companyId: leads.companyId, contactId: leads.contactId }).from(leads).where(inArray(leads.id, ids));
    await tx.delete(notifications).where(and(eq(notifications.entityType, "lead"), inArray(notifications.entityId, ids)));
    await tx.delete(revisions).where(and(eq(revisions.entityType, "lead"), inArray(revisions.entityId, ids)));
    await tx.delete(leads).where(inArray(leads.id, ids));

    const contactIds = [...new Set(rows.map((r) => r.contactId).filter((x): x is string => !!x))];
    if (contactIds.length) {
      await tx
        .delete(contacts)
        .where(and(inArray(contacts.id, contactIds), sql`not exists (select 1 from ${leads} where ${leads.contactId} = ${contacts.id})`));
    }
    const companyIds = [...new Set(rows.map((r) => r.companyId))];
    await tx
      .delete(companies)
      .where(
        and(
          inArray(companies.id, companyIds),
          sql`not exists (select 1 from ${leads} where ${leads.companyId} = ${companies.id})`,
          sql`not exists (select 1 from ${contacts} where ${contacts.companyId} = ${companies.id})`,
        ),
      );
  }

  private async purgeLabels(tx: Tx, ids: string[]) {
    if (ids.length === 0) return;
    await tx.delete(taskLabels).where(inArray(taskLabels.labelId, ids));
    await tx.delete(labels).where(inArray(labels.id, ids));
  }
}

