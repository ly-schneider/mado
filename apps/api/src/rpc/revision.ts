import type { Revision, RevisionSummary } from "@mado/contract";
import { leads, revisions, tasks } from "@mado/db";
import { and, desc, eq } from "drizzle-orm";
import type { Actor } from "../lib/actor";
import { initials } from "../lib/actor";
import { notFound } from "../lib/errors";
import { authed } from "./base";
import type { Services } from "./services";

type RevisionRow = typeof revisions.$inferSelect;

interface TaskPatchLike {
  title?: string;
  description?: string;
  type?: string;
  status?: string;
  priority?: string;
  assignee?: string | null;
  labelIds?: string[];
  epicId?: string | null;
  dueDate?: string | null;
}

/**
 * TaskService snapshots store `assignee` as "user:<id>"; the git stream stores the raw row
 * (assigneeUserId/assigneeGrantId). Accept both, plus expanded labels/epic.
 */
function taskPatchFromSnapshot(snap: Record<string, unknown>): TaskPatchLike {
  const patch: TaskPatchLike = {};
  if (typeof snap.title === "string") patch.title = snap.title;
  if (typeof snap.description === "string") patch.description = snap.description;
  if (typeof snap.type === "string") patch.type = snap.type;
  if (typeof snap.status === "string") patch.status = snap.status;
  if (typeof snap.priority === "string") patch.priority = snap.priority;
  if (Array.isArray(snap.labelIds)) patch.labelIds = snap.labelIds as string[];
  else if (Array.isArray(snap.labels)) patch.labelIds = (snap.labels as ({ id: string } | string)[]).map((l) => (typeof l === "string" ? l : l.id));
  if ("epicId" in snap) patch.epicId = (snap.epicId as string | null) ?? null;
  else if ("epic" in snap) patch.epicId = (snap.epic as { id: string } | null)?.id ?? null;
  if ("dueDate" in snap) patch.dueDate = (snap.dueDate as string | null) ?? null;
  if ("assignee" in snap) {
    const a = snap.assignee as string | { type: string; id: string } | null;
    patch.assignee = a == null ? null : typeof a === "string" ? a : `${a.type}:${a.id}`;
  } else if ("assigneeUserId" in snap || "assigneeGrantId" in snap) {
    patch.assignee = snap.assigneeUserId ? `user:${snap.assigneeUserId}` : snap.assigneeGrantId ? `agent:${snap.assigneeGrantId}` : null;
  }
  return patch;
}

export const revisionRouter = (s: Services) => {
  const db = () => s.doc.dbs.db;

  async function requireEntity(actor: Actor, entityType: "doc" | "task" | "lead", entityId: string, level: "read" | "write") {
    if (entityType === "doc") {
      await s.access.requireDoc(actor, entityId, level, { includeDeleted: level === "read" });
      return;
    }
    if (entityType === "task") {
      const [t] = await db().select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, entityId));
      if (!t) throw notFound("Task");
      await s.access.requireProject(actor, t.projectId, level, "tasks");
      return;
    }
    const [l] = await db().select({ projectId: leads.projectId }).from(leads).where(eq(leads.id, entityId));
    if (!l) throw notFound("Lead");
    await s.access.requireProject(actor, l.projectId, level, "crm");
  }

  const toSummary = (r: RevisionRow, latest: number): RevisionSummary => ({
    id: r.id,
    number: r.number,
    actor: { type: r.actorType, id: r.actorId, name: r.actorName, initials: r.actorType === "user" ? initials(r.actorName) : null },
    sessionId: r.sessionId,
    summary: r.summary,
    added: r.added,
    removed: r.removed,
    createdAt: r.createdAt.toISOString(),
    current: r.number === latest,
  });

  async function load(actor: Actor, id: string, level: "read" | "write") {
    const [rev] = await db().select().from(revisions).where(eq(revisions.id, id));
    if (!rev) throw notFound("Revision");
    await requireEntity(actor, rev.entityType, rev.entityId, level);
    const [top] = await db()
      .select({ number: revisions.number })
      .from(revisions)
      .where(and(eq(revisions.entityType, rev.entityType), eq(revisions.entityId, rev.entityId)))
      .orderBy(desc(revisions.number))
      .limit(1);
    return { rev, latest: top?.number ?? rev.number };
  }

  return {
    list: authed.revision.list.handler(async ({ input, context }) => {
      await requireEntity(context.actor, input.entityType, input.entityId, "read");
      const rows = await db()
        .select()
        .from(revisions)
        .where(and(eq(revisions.entityType, input.entityType), eq(revisions.entityId, input.entityId)))
        .orderBy(desc(revisions.number));
      return rows.map((r) => toSummary(r, rows[0]!.number));
    }),

    get: authed.revision.get.handler(async ({ input, context }): Promise<Revision> => {
      const { rev, latest } = await load(context.actor, input.id, "read");
      return { ...toSummary(rev, latest), snapshot: rev.snapshot as Revision["snapshot"] };
    }),

    restore: authed.revision.restore.handler(async ({ input, context }) => {
      const actor = context.actor;
      const { rev } = await load(actor, input.id, "write");
      const snap = rev.snapshot as Record<string, unknown>;
      if (rev.entityType === "doc") {
        await s.doc.restoreRevision(actor, rev.entityId, rev.id);
      } else if (rev.entityType === "lead") {
        await s.crm.update(
          actor,
          rev.entityId,
          {
            ...(typeof snap.notes === "string" ? { notes: snap.notes } : {}),
            ...(typeof snap.stage === "string" ? { stage: snap.stage as never } : {}),
            ...(typeof snap.source === "string" ? { source: snap.source } : {}),
          },
          { summary: `Restored revision ${rev.number}`, forceRevision: true },
        );
      } else {
        // TaskService owns task writes (labels, epic inheritance, audit, its own revision).
        await s.task.update(actor, rev.entityId, taskPatchFromSnapshot(snap) as Parameters<Services["task"]["update"]>[2], {
          summary: `Restored revision ${rev.number}`,
        });
      }
      return { ok: true as const };
    }),
  };
};
