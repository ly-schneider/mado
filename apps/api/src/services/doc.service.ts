import type { Actor as ActorView, Backlink, Doc, DocNode } from "@mado/contract";
import { agentGrants, type Db, docs, favorites, projects, refs, revisions, shareLinks, taskDocs, tasks, type Tx, users } from "@mado/db";
import { Injectable } from "@nestjs/common";
import { and, asc, count, desc, eq, ilike, inArray, isNull, max, or, sql } from "drizzle-orm";
import { DbService } from "../db";
import { type Actor, actorId, initials } from "../lib/actor";
import { AppError, badRequest, forbidden, notFound } from "../lib/errors";
import { AccessService } from "./access.service";
import { AiService } from "./ai.service";
import { AuditService, diffStats } from "./audit.service";
import { RefsService } from "./refs.service";

type DocRow = typeof docs.$inferSelect;
type Exec = Db | Tx;

/** Autosaves by the same actor within this window fold into the previous revision. */
export const REVISION_WINDOW_MS = 2 * 60_000;

const actorKey = (type: string, id: string) => `${type}:${id}`;

/** Display actors for (type, id) pairs stored on rows. Unknown ids fall back to a neutral name. */
export async function resolveActors(db: Exec, list: { type: string | null; id: string | null }[]): Promise<Map<string, ActorView>> {
  const out = new Map<string, ActorView>();
  const ids = { user: new Set<string>(), agent: new Set<string>(), guest: new Set<string>() };
  for (const a of list) {
    if (a.type && a.id && a.type in ids) ids[a.type as keyof typeof ids].add(a.id);
    if (a.type === "system") out.set(actorKey("system", a.id ?? "system"), { type: "system", id: "system", name: "System", initials: null });
  }
  if (ids.user.size) {
    const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...ids.user]));
    for (const u of rows) out.set(actorKey("user", u.id), { type: "user", id: u.id, name: u.name, initials: initials(u.name) });
  }
  if (ids.agent.size) {
    const rows = await db.select({ id: agentGrants.id, name: agentGrants.agentName }).from(agentGrants).where(inArray(agentGrants.id, [...ids.agent]));
    for (const g of rows) out.set(actorKey("agent", g.id), { type: "agent", id: g.id, name: g.name, initials: null });
  }
  if (ids.guest.size) {
    const rows = await db.select({ id: shareLinks.id, name: shareLinks.name }).from(shareLinks).where(inArray(shareLinks.id, [...ids.guest]));
    for (const l of rows) out.set(actorKey("guest", l.id), { type: "guest", id: l.id, name: guestName(l.name), initials: null });
  }
  return out;
}

export function lookupActor(map: Map<string, ActorView>, type: string | null, id: string | null): ActorView | null {
  if (!type || !id) return null;
  return map.get(actorKey(type, id)) ?? { type: type as ActorView["type"], id, name: type === "agent" ? "Agent" : "Unknown", initials: type === "user" ? "?" : null };
}

export const guestName = (linkName: string) => `Guest via “${linkName}”`;

function safeFileName(title: string) {
  return title.replace(/[/\\:*?"<>|\n\r]+/g, "-").trim() || "Untitled";
}

/**
 * Wiki pages. Deleting a page soft-deletes its whole subtree with ONE shared deletedAt, so the
 * trash can bring the pages back together: restoreSubtree(tx, id, deletedAt) restores exactly the
 * rows that were deleted in that same operation (pages deleted earlier on their own stay in the trash).
 */
@Injectable()
export class DocService {
  constructor(
    readonly dbs: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly refs: RefsService,
    private readonly ai: AiService,
  ) {}

  private get db() {
    return this.dbs.db;
  }

  /** Docs the actor may read in a workspace. Guests get their shared subtree only. */
  async readableDocs(actor: Actor, workspaceId: string): Promise<DocRow[]> {
    if (actor.type === "guest") {
      if (actor.workspaceId !== workspaceId) throw forbidden();
      const ids = await this.access.subtreeIds(actor.rootDocId);
      return this.db.select().from(docs).where(and(inArray(docs.id, ids), isNull(docs.deletedAt))).orderBy(asc(docs.sortOrder), asc(docs.createdAt));
    }
    await this.access.requireWorkspace(actor, workspaceId);
    const projectIds = await this.access.readableProjectIds(actor, workspaceId, "docs");
    const workspacePages = actor.type !== "agent" || (actor.grant.projectScope === "all" && actor.grant.resourceTypes.includes("docs"));
    const scope = or(
      projectIds.length ? inArray(docs.projectId, projectIds) : undefined,
      workspacePages ? isNull(docs.projectId) : undefined,
    );
    if (!scope) return [];
    return this.db
      .select()
      .from(docs)
      .where(and(eq(docs.workspaceId, workspaceId), isNull(docs.deletedAt), scope))
      .orderBy(asc(docs.sortOrder), asc(docs.createdAt));
  }

  private toNodes(rows: DocRow[]): DocNode[] {
    const parents = new Set(rows.map((r) => r.parentId).filter(Boolean));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      parentId: r.parentId,
      projectId: r.projectId,
      sortOrder: r.sortOrder,
      hasChildren: parents.has(r.id),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async tree(actor: Actor, workspaceId: string): Promise<DocNode[]> {
    const rows = await this.readableDocs(actor, workspaceId);
    const nodes = this.toNodes(rows);
    // A page whose parent the actor can't see is shown at the top level.
    const visible = new Set(rows.map((r) => r.id));
    return nodes.map((n) => (n.parentId && !visible.has(n.parentId) ? { ...n, parentId: null } : n));
  }

  private async node(id: string): Promise<DocNode> {
    const [row] = await this.db.select().from(docs).where(eq(docs.id, id));
    const [child] = await this.db.select({ id: docs.id }).from(docs).where(and(eq(docs.parentId, id), isNull(docs.deletedAt))).limit(1);
    return { ...this.toNodes([row!])[0]!, hasChildren: !!child };
  }

  async ancestors(doc: DocRow, stopAt?: string): Promise<{ id: string; title: string }[]> {
    const path: { id: string; title: string }[] = [];
    let parentId = doc.id === stopAt ? null : doc.parentId;
    for (let depth = 0; parentId && depth < 64; depth++) {
      const [p] = await this.db.select({ id: docs.id, title: docs.title, parentId: docs.parentId }).from(docs).where(eq(docs.id, parentId));
      if (!p) break;
      path.unshift({ id: p.id, title: p.title });
      if (p.id === stopAt) break;
      parentId = p.parentId;
    }
    return path;
  }

  async get(actor: Actor, id: string): Promise<Doc> {
    const doc = await this.access.requireDoc(actor, id, "read");
    const guest = actor.type === "guest" ? actor : null;

    const [revCount] = await this.db
      .select({ n: count() })
      .from(revisions)
      .where(and(eq(revisions.entityType, "doc"), eq(revisions.entityId, id)));
    const actors = await resolveActors(this.db, [{ type: doc.updatedByType, id: doc.updatedById }]);

    let favorite = false;
    let shareCount = 0;
    if (actor.type === "user") {
      const [fav] = await this.db.select().from(favorites).where(and(eq(favorites.userId, actor.userId), eq(favorites.docId, id)));
      favorite = !!fav;
    }
    if (!guest) {
      const [n] = await this.db
        .select({ n: count() })
        .from(shareLinks)
        .where(and(eq(shareLinks.docId, id), isNull(shareLinks.revokedAt), or(isNull(shareLinks.expiresAt), sql`${shareLinks.expiresAt} > now()`)));
      shareCount = n?.n ?? 0;
    }

    let canEdit: boolean;
    if (guest) canEdit = guest.canEdit;
    else canEdit = await this.access.requireDoc(actor, id, "write").then(() => true, () => false);

    if (actor.type === "agent") await this.markReadByAgent(actor, doc);

    return {
      id: doc.id,
      workspaceId: doc.workspaceId,
      projectId: doc.projectId,
      parentId: guest && doc.id === guest.rootDocId ? null : doc.parentId,
      title: doc.title,
      content: doc.content,
      path: await this.ancestors(doc, guest?.rootDocId),
      revisionNumber: doc.revisionNumber,
      revisionCount: revCount?.n ?? 0,
      updatedAt: doc.updatedAt.toISOString(),
      updatedBy: lookupActor(actors, doc.updatedByType, doc.updatedById),
      favorite,
      backlinks: await this.backlinks(actor, doc),
      shareLinks: shareCount,
      canEdit,
    };
  }

  /** Powers "read by agent · 34m" on tasks assigned to this agent that link the page. */
  private async markReadByAgent(actor: Extract<Actor, { type: "agent" }>, doc: DocRow) {
    await this.db.transaction(async (tx) => {
      const assigned = tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.assigneeGrantId, actor.grant.id));
      await tx
        .update(taskDocs)
        .set({ lastReadByAgentAt: new Date() })
        .where(and(eq(taskDocs.docId, doc.id), inArray(taskDocs.taskId, assigned)));
      await this.audit.record(tx, actor, {
        workspaceId: doc.workspaceId,
        projectId: doc.projectId,
        action: "doc.read",
        entityType: "doc",
        entityId: doc.id,
        entityLabel: doc.title,
      });
    });
  }

  private async backlinks(actor: Actor, doc: DocRow): Promise<Backlink[]> {
    const incoming = await this.db
      .select({ type: refs.sourceType, id: refs.sourceId })
      .from(refs)
      .where(and(eq(refs.targetType, "doc"), eq(refs.targetId, doc.id)));
    const docIds = incoming.filter((r) => r.type === "doc").map((r) => r.id);
    const out: Backlink[] = [];

    if (docIds.length) {
      let allowed: Set<string> | null = null;
      if (actor.type === "guest") allowed = new Set(await this.access.subtreeIds(actor.rootDocId));
      else if (actor.type === "agent") allowed = new Set((await this.readableDocs(actor, doc.workspaceId)).map((d) => d.id));
      const rows = await this.db.select().from(docs).where(and(inArray(docs.id, docIds), isNull(docs.deletedAt)));
      const parentIds = [...new Set(rows.map((r) => r.parentId).filter((p): p is string => !!p))];
      const parents = parentIds.length ? await this.db.select({ id: docs.id, title: docs.title }).from(docs).where(inArray(docs.id, parentIds)) : [];
      const parentTitle = new Map(parents.map((p) => [p.id, p.title]));
      for (const r of rows) {
        if (allowed && !allowed.has(r.id)) continue;
        out.push({ type: "doc", id: r.id, title: r.title, subtitle: (r.parentId && parentTitle.get(r.parentId)) ?? "", key: null });
      }
    }

    if (actor.type === "guest") return out;

    const linked = await this.db.select({ taskId: taskDocs.taskId }).from(taskDocs).where(eq(taskDocs.docId, doc.id));
    const taskIds = [...new Set([...incoming.filter((r) => r.type === "task").map((r) => r.id), ...linked.map((l) => l.taskId)])];
    if (taskIds.length) {
      const readable = new Set(await this.access.readableProjectIds(actor, doc.workspaceId, "tasks"));
      const rows = await this.db
        .select({ id: tasks.id, key: tasks.key, title: tasks.title, projectId: tasks.projectId })
        .from(tasks)
        .where(and(inArray(tasks.id, taskIds), isNull(tasks.deletedAt)));
      for (const t of rows) {
        if (!readable.has(t.projectId)) continue;
        out.push({ type: "task", id: t.id, title: t.title, subtitle: t.title, key: t.key });
      }
    }
    return out;
  }

  /** Checks write access to the place a new page goes: a parent page, a project, or the workspace. */
  private async requireContainer(actor: Actor, workspaceId: string, projectId: string | null) {
    if (projectId) {
      const project = await this.access.requireProject(actor, projectId, "write", "docs");
      if (project.workspaceId !== workspaceId) throw badRequest("Project is in another workspace");
      return;
    }
    if (actor.type === "guest") throw forbidden();
    await this.access.requireWorkspace(actor, workspaceId);
    if (actor.type === "agent" && (actor.grant.projectScope !== "all" || actor.grant.allLevel === "read" || !actor.grant.resourceTypes.includes("docs"))) {
      throw new AppError("INSUFFICIENT_SCOPE", "insufficient_scope: needs write docs on workspace pages", {
        error: "insufficient_scope",
        required: { project: "workspace pages", level: "write", resource: "docs" },
      });
    }
  }

  async create(
    actor: Actor,
    input: { workspaceId: string; projectId?: string | null; parentId?: string | null; title: string; content: string; clientId?: string },
  ): Promise<DocNode> {
    if (input.clientId) {
      const [existing] = await this.db.select({ id: docs.id }).from(docs).where(eq(docs.id, input.clientId));
      if (existing) {
        await this.access.requireDoc(actor, existing.id, "read");
        return this.node(existing.id);
      }
    }
    let projectId = input.projectId ?? null;
    if (input.parentId) {
      const parent = await this.access.requireDoc(actor, input.parentId, "write");
      if (parent.workspaceId !== input.workspaceId) throw badRequest("Parent page is in another workspace");
      projectId = parent.projectId;
    } else {
      await this.requireContainer(actor, input.workspaceId, projectId);
    }
    const title = input.title.trim() || "Untitled";

    const id = await this.db.transaction(async (tx) => {
      const [last] = await tx
        .select({ m: max(docs.sortOrder) })
        .from(docs)
        .where(
          and(
            eq(docs.workspaceId, input.workspaceId),
            input.parentId ? eq(docs.parentId, input.parentId) : isNull(docs.parentId),
            projectId ? eq(docs.projectId, projectId) : isNull(docs.projectId),
            isNull(docs.deletedAt),
          ),
        );
      const [row] = await tx
        .insert(docs)
        .values({
          ...(input.clientId ? { id: input.clientId } : {}),
          workspaceId: input.workspaceId,
          projectId,
          parentId: input.parentId ?? null,
          title,
          content: input.content,
          sortOrder: (last?.m ?? 0) + 1,
          updatedByType: actor.type,
          updatedById: actorId(actor),
        })
        .returning();
      const number = await this.audit.revision(tx, actor, {
        entityType: "doc",
        entityId: row!.id,
        snapshot: { title, content: input.content },
        ...diffStats("", input.content),
        summary: "Created",
      });
      await tx.update(docs).set({ revisionNumber: number }).where(eq(docs.id, row!.id));
      await this.refs.rebuild(tx, { type: "doc", id: row!.id, workspaceId: input.workspaceId }, input.content);
      await this.relinkTitle(tx, input.workspaceId, title);
      await this.audit.record(tx, actor, {
        workspaceId: input.workspaceId,
        projectId,
        action: "doc.create",
        entityType: "doc",
        entityId: row!.id,
        entityLabel: title,
        after: { title, parentId: row!.parentId },
      });
      return row!.id;
    });
    return this.node(id);
  }

  /**
   * Pages that mention [[title]] were linked (or unlinked) by a create or rename, so rebuild their refs.
   * Refs are only rebuilt on save, which would otherwise leave backlinks stale.
   */
  private async relinkTitle(tx: Tx, workspaceId: string, ...titles: string[]) {
    for (const title of new Set(titles.map((t) => t.trim()).filter(Boolean))) {
      const pattern = `%${title.replace(/[\\%_]/g, (c) => `\\${c}`)}]]%`;
      const docRows = await tx
        .select({ id: docs.id, content: docs.content })
        .from(docs)
        .where(and(eq(docs.workspaceId, workspaceId), isNull(docs.deletedAt), ilike(docs.content, pattern)));
      for (const d of docRows) await this.refs.rebuild(tx, { type: "doc", id: d.id, workspaceId }, d.content);
      const taskRows = await tx
        .select({ id: tasks.id, description: tasks.description })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(and(eq(projects.workspaceId, workspaceId), isNull(tasks.deletedAt), ilike(tasks.description, pattern)));
      for (const t of taskRows) await this.refs.rebuild(tx, { type: "task", id: t.id, workspaceId }, t.description);
    }
  }

  /**
   * Autosave. Saves always land (last write wins); a revision is written when the actor differs from
   * the last revision's, the last revision is older than REVISION_WINDOW_MS, on checkpoint, or when
   * none exists. Otherwise the edit folds into the latest revision window.
   */
  async save(
    actor: Actor,
    input: { id: string; title?: string; content?: string; baseRevision?: number; checkpoint?: boolean; summary?: string; action?: "doc.save" | "doc.restore" },
  ): Promise<{ revisionNumber: number; revisionCount: number; updatedAt: string }> {
    await this.access.requireDoc(actor, input.id, "write");
    const result = await this.db.transaction(async (tx) => {
      const [doc] = await tx.select().from(docs).where(eq(docs.id, input.id)).for("update");
      if (!doc || doc.deletedAt) throw notFound("Page");
      const title = input.title !== undefined ? input.title.trim() || "Untitled" : doc.title;
      const content = input.content ?? doc.content;
      const me = actorId(actor);

      const [last] = await tx
        .select()
        .from(revisions)
        .where(and(eq(revisions.entityType, "doc"), eq(revisions.entityId, doc.id)))
        .orderBy(desc(revisions.number))
        .limit(1);
      const sameActor = last && last.actorType === actor.type && last.actorId === me;
      const needRevision =
        !last || !sameActor || input.checkpoint || Date.now() - last.createdAt.getTime() > REVISION_WINDOW_MS;
      const conflict =
        input.baseRevision !== undefined &&
        input.baseRevision < doc.revisionNumber &&
        !(doc.updatedByType === actor.type && doc.updatedById === me);

      let revisionNumber = doc.revisionNumber;
      let stats = { added: 0, removed: 0 };
      if (needRevision) {
        await this.flushPending(tx, doc, last, actor);
        const prev = (await this.lastSnapshot(tx, doc.id)) ?? { title: "", content: "" };
        stats = diffStats(prev.content, content);
        revisionNumber = await this.audit.revision(tx, actor, {
          entityType: "doc",
          entityId: doc.id,
          snapshot: { title, content },
          ...stats,
          summary: input.summary ?? (prev.title && prev.title !== title ? `Renamed from “${prev.title}”` : null),
        });
      }

      const [updated] = await tx
        .update(docs)
        .set({ title, content, revisionNumber, updatedByType: actor.type, updatedById: me, updatedAt: new Date() })
        .where(eq(docs.id, doc.id))
        .returning();
      await this.refs.rebuild(tx, { type: "doc", id: doc.id, workspaceId: doc.workspaceId }, content);
      if (title !== doc.title) await this.relinkTitle(tx, doc.workspaceId, doc.title, title);

      // Agents and guests get full before/after so a session revert can put the old text back;
      // a user's autosave only logs metadata to keep the audit log small.
      const full = actor.type !== "user";
      await this.audit.record(tx, actor, {
        workspaceId: doc.workspaceId,
        projectId: doc.projectId,
        action: input.action ?? "doc.save",
        entityType: "doc",
        entityId: doc.id,
        entityLabel: title,
        before: full ? { title: doc.title, content: doc.content } : { title: doc.title, revisionNumber: doc.revisionNumber },
        after: {
          ...(full ? { title, content } : { title }),
          revisionNumber,
          ...stats,
          ...(conflict ? { conflict: true, baseRevision: input.baseRevision, overwroteBy: { type: doc.updatedByType, id: doc.updatedById } } : {}),
        },
      });
      const [n] = await tx
        .select({ n: count() })
        .from(revisions)
        .where(and(eq(revisions.entityType, "doc"), eq(revisions.entityId, doc.id)));
      return { revisionNumber, revisionCount: n?.n ?? 0, updatedAt: updated!.updatedAt.toISOString() };
    });
    return result;
  }

  private async lastSnapshot(tx: Tx, docId: string) {
    const [last] = await tx
      .select({ snapshot: revisions.snapshot })
      .from(revisions)
      .where(and(eq(revisions.entityType, "doc"), eq(revisions.entityId, docId)))
      .orderBy(desc(revisions.number))
      .limit(1);
    return (last?.snapshot as { title: string; content: string } | undefined) ?? null;
  }

  /**
   * Before another actor's revision lands, keep the previous author's folded-in edits: if the page
   * moved on since the last snapshot, snapshot it first under the author who wrote it.
   */
  private async flushPending(tx: Tx, doc: DocRow, last: typeof revisions.$inferSelect | undefined, actor: Actor) {
    if (!last || !doc.updatedByType || !doc.updatedById) return;
    if (doc.updatedByType === actor.type && doc.updatedById === actorId(actor)) return;
    const snap = last.snapshot as { title?: string; content?: string };
    if (snap.title === doc.title && snap.content === doc.content) return;
    const author = lookupActor(await resolveActors(tx, [{ type: doc.updatedByType, id: doc.updatedById }]), doc.updatedByType, doc.updatedById)!;
    await tx.insert(revisions).values({
      entityType: "doc",
      entityId: doc.id,
      number: last.number + 1,
      snapshot: { title: doc.title, content: doc.content },
      ...diffStats(snap.content ?? "", doc.content),
      actorType: doc.updatedByType,
      actorId: doc.updatedById,
      actorName: author.name,
      sessionId: doc.updatedByType === last.actorType && doc.updatedById === last.actorId ? last.sessionId : null,
    });
  }

  /** Writes a snapshot back as the current content and appends a revision on top. */
  async restoreRevision(actor: Actor, docId: string, revisionId: string) {
    const doc = await this.access.requireDoc(actor, docId, "write");
    const [rev] = await this.db.select().from(revisions).where(eq(revisions.id, revisionId));
    if (!rev || rev.entityType !== "doc" || rev.entityId !== doc.id) throw notFound("Revision");
    const snap = rev.snapshot as { title: string; content: string };
    await this.save(actor, { id: doc.id, title: snap.title, content: snap.content, checkpoint: true, summary: `Restored revision ${rev.number}`, action: "doc.restore" });
  }

  async move(actor: Actor, input: { id: string; parentId: string | null; sortOrder: number }) {
    const doc = await this.access.requireDoc(actor, input.id, "write");
    let projectId = doc.projectId;
    if (input.parentId) {
      if (input.parentId === doc.id || (await this.access.isInSubtree(input.parentId, doc.id))) {
        throw badRequest("A page can't move into its own sub-pages");
      }
      const parent = await this.access.requireDoc(actor, input.parentId, "write");
      if (parent.workspaceId !== doc.workspaceId) throw badRequest("Parent page is in another workspace");
      projectId = parent.projectId;
    } else if (actor.type === "guest") {
      throw forbidden("Pages stay inside the shared folder");
    }
    if (actor.type === "guest" && doc.id === actor.rootDocId) throw forbidden("The shared page itself can't be moved");

    await this.db.transaction(async (tx) => {
      await tx.update(docs).set({ parentId: input.parentId, sortOrder: input.sortOrder }).where(eq(docs.id, doc.id));
      if (projectId !== doc.projectId) {
        const ids = await this.access.subtreeIds(doc.id);
        await tx.update(docs).set({ projectId }).where(inArray(docs.id, ids));
      }
      await this.audit.record(tx, actor, {
        workspaceId: doc.workspaceId,
        projectId,
        action: "doc.move",
        entityType: "doc",
        entityId: doc.id,
        entityLabel: doc.title,
        before: { parentId: doc.parentId, sortOrder: doc.sortOrder, projectId: doc.projectId },
        after: { parentId: input.parentId, sortOrder: input.sortOrder, projectId },
      });
    });
  }

  async delete(actor: Actor, id: string) {
    const doc = await this.access.requireDoc(actor, id, actor.type === "guest" ? "write" : "delete");
    if (actor.type === "guest" && doc.id === actor.rootDocId) throw forbidden("The shared page itself can't be deleted");
    const ids = await this.access.subtreeIds(doc.id);
    const deletedAt = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(docs)
        .set({ deletedAt, deletedByType: actor.type, deletedById: actorId(actor) })
        .where(and(inArray(docs.id, ids), isNull(docs.deletedAt)));
      await this.audit.record(tx, actor, {
        workspaceId: doc.workspaceId,
        projectId: doc.projectId,
        action: "doc.delete",
        entityType: "doc",
        entityId: doc.id,
        entityLabel: doc.title,
        before: { title: doc.title, parentId: doc.parentId },
        after: { deletedAt: deletedAt.toISOString(), subtree: ids },
      });
    });
  }

  /** Restores a page and the sub-pages deleted with it (same deletedAt). For TrashService. */
  async restoreSubtree(tx: Tx, docId: string, deletedAt: Date): Promise<string[]> {
    const restored: string[] = [];
    let frontier = [docId];
    const [root] = await tx.select({ deletedAt: docs.deletedAt }).from(docs).where(eq(docs.id, docId));
    if (!root?.deletedAt || root.deletedAt.getTime() !== deletedAt.getTime()) return restored;
    while (frontier.length) {
      restored.push(...frontier);
      const children = await tx
        .select({ id: docs.id })
        .from(docs)
        .where(and(inArray(docs.parentId, frontier), eq(docs.deletedAt, deletedAt)));
      frontier = children.map((c) => c.id);
    }
    await tx.update(docs).set({ deletedAt: null, deletedByType: null, deletedById: null }).where(inArray(docs.id, restored));
    return restored;
  }

  async favorite(actor: Actor, id: string, on: boolean) {
    const user = this.access.requireUser(actor);
    await this.access.requireDoc(actor, id, "read");
    if (on) await this.db.insert(favorites).values({ userId: user.userId, docId: id }).onConflictDoNothing();
    else await this.db.delete(favorites).where(and(eq(favorites.userId, user.userId), eq(favorites.docId, id)));
  }

  async favorites(actor: Actor, workspaceId: string): Promise<DocNode[]> {
    const user = this.access.requireUser(actor);
    await this.access.requireWorkspace(actor, workspaceId);
    const rows = await this.db
      .select({ d: docs })
      .from(favorites)
      .innerJoin(docs, eq(docs.id, favorites.docId))
      .where(and(eq(favorites.userId, user.userId), eq(docs.workspaceId, workspaceId), isNull(docs.deletedAt)))
      .orderBy(asc(favorites.createdAt));
    const nodes = this.toNodes(rows.map((r) => r.d));
    const ids = nodes.map((n) => n.id);
    if (!ids.length) return [];
    const withKids = await this.db
      .selectDistinct({ parentId: docs.parentId })
      .from(docs)
      .where(and(inArray(docs.parentId, ids), isNull(docs.deletedAt)));
    const parents = new Set(withKids.map((k) => k.parentId));
    return nodes.map((n) => ({ ...n, hasChildren: parents.has(n.id) }));
  }

  /** [[Page]] or [[Folder/Page]] → page id, case-insensitive, among pages the actor can read. */
  async resolveTitle(actor: Actor, workspaceId: string, raw: string): Promise<{ id: string } | null> {
    const parts = raw.replace(/^\[\[|\]\]$/g, "").split("/").map((p) => p.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return null;
    const rows = await this.readableDocs(actor, workspaceId);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const title = parts[parts.length - 1]!;
    const candidates = rows.filter((r) => r.title.trim().toLowerCase() === title);
    if (parts.length > 1) {
      const folder = parts[parts.length - 2]!;
      const inFolder = candidates.find((c) => c.parentId && byId.get(c.parentId)?.title.trim().toLowerCase() === folder);
      if (inFolder) return { id: inFolder.id };
    }
    return candidates[0] ? { id: candidates[0].id } : null;
  }

  async export(actor: Actor, input: { workspaceId: string; docId?: string; projectId?: string }) {
    let rows = await this.readableDocs(actor, input.workspaceId);
    if (input.docId) {
      await this.access.requireDoc(actor, input.docId, "read");
      const ids = new Set(await this.access.subtreeIds(input.docId));
      rows = rows.filter((r) => ids.has(r.id));
    } else if (input.projectId) {
      await this.access.requireProject(actor, input.projectId, "read", "docs");
      rows = rows.filter((r) => r.projectId === input.projectId);
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const folderOf = new Map<string, string>();
    const used = new Set<string>();
    const dirFor = (r: DocRow): string => {
      if (!r.parentId || !byId.has(r.parentId) || r.id === input.docId) return "";
      return folderOf.get(r.parentId) ?? "";
    };
    // Parents before children so a child's folder path is known.
    const ordered: DocRow[] = [];
    const visit = (parentId: string | null) => {
      for (const r of rows) {
        const effectiveParent = r.parentId && byId.has(r.parentId) && r.id !== input.docId ? r.parentId : null;
        if (effectiveParent === parentId) {
          ordered.push(r);
          visit(r.id);
        }
      }
    };
    visit(null);

    const files: { path: string; content: string }[] = [];
    for (const r of ordered) {
      const dir = dirFor(r);
      let name = safeFileName(r.title);
      let base = dir ? `${dir}/${name}` : name;
      for (let i = 2; used.has(base.toLowerCase()); i++) base = dir ? `${dir}/${name} (${i})` : `${name} (${i})`;
      used.add(base.toLowerCase());
      folderOf.set(r.id, base);
      name = base;
      const front = `---\ntitle: ${JSON.stringify(r.title)}\nupdated: ${r.updatedAt.toISOString()}\n---\n\n`;
      files.push({ path: `${name}.md`, content: front + r.content });
    }
    return { files };
  }

  async summarize(actor: Actor, id: string) {
    const doc = await this.access.requireDoc(actor, id, "read");
    const { data, model } = await this.ai.json<{ summary?: string }>(
      "docSummary",
      'Summarise the wiki page for a busy reader in 2 to 4 sentences, in the language of the page. Return {"summary": string}.',
      `# ${doc.title}\n\n${doc.content.slice(0, 60_000)}`,
    );
    return { summary: String(data.summary ?? "").trim(), model };
  }
}
