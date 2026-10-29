import { type AuditEntry, type LeadStage, type Notification, PRIORITY_LABEL, type Priority, STAGE_LABEL, STATUS_LABEL, type TaskStatus } from "@mado/contract";
import { agentGrants, auditLog, notifications, tasks } from "@mado/db";
import { Injectable } from "@nestjs/common";
import { and, count, desc, eq, inArray, isNotNull, isNull, type SQL } from "drizzle-orm";
import { DbService } from "../db";
import type { Actor } from "../lib/actor";
import { notFound } from "../lib/errors";
import { AccessService } from "./access.service";
import { storedActor } from "./task.service";

type AuditRow = typeof auditLog.$inferSelect;
type Json = Record<string, unknown>;

function stageText(a: Json, label: string, withLabel: boolean) {
  const to = STAGE_LABEL[a.stage as LeadStage] ?? String(a.stage ?? "");
  return withLabel ? `${label} → ${to}` : typeof a.stageText === "string" ? `moved ${a.stageText}` : `moved to ${to}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * One human sentence per audit row. `withLabel` names the entity ("moved GAT-109 → In progress");
 * without it the sentence reads inside the entity's own activity feed ("moved Todo → In progress").
 *
 * Action names: <entity>.create | update | save | delete | restore | purge | read | link_doc | unlink_doc,
 * comment.create | delete, task.git_link (after: { provider, kind: commit | pr | branch, count, number, state, branch }).
 * Update rows hold only changed fields, keyed by column name (assigneeUserId/assigneeGrantId, labelIds).
 */
export function describeAudit(row: Pick<AuditRow, "action" | "entityType" | "entityLabel" | "before" | "after">, opts: { withLabel: boolean }): string {
  const a = (row.after ?? {}) as Json;
  const b = (row.before ?? {}) as Json;
  const label = row.entityLabel;
  const key = row.entityType === "task" || row.entityType === "comment" ? label.split(" ")[0]! : label;
  const target = opts.withLabel ? ` ${label}` : "";
  const verb = row.action.slice(row.action.indexOf(".") + 1);

  if (row.action.startsWith("comment.")) {
    if (verb === "create") return opts.withLabel ? `commented on ${key}` : "commented";
    if (verb === "delete") return opts.withLabel ? `deleted a comment on ${key}` : "deleted a comment";
    if (verb === "restore") return opts.withLabel ? `restored a comment on ${key}` : "restored a comment";
  }
  if (row.action === "task.git_link") {
    const on = opts.withLabel ? ` on ${key}` : "";
    if (a.kind === "pr") {
      const verbPr = a.state === "merged" ? "merged" : a.state === "closed" ? "closed" : "opened";
      return `${verbPr} PR #${String(a.number ?? "").replace(/^#/, "")}${on}`;
    }
    if (a.kind === "commit") {
      const n = Number(a.count ?? 1);
      return `linked ${plural(n, "commit")}${a.branch ? ` on ${a.branch}` : ""}${opts.withLabel ? ` to ${key}` : ""}`;
    }
    return `linked branch ${a.branch ?? ""}${opts.withLabel ? ` to ${key}` : ""}`;
  }
  if (row.action.startsWith("git.")) {
    const to = opts.withLabel ? ` to ${key}` : "";
    const commits = Number(a.commits ?? 0);
    if (a.pr) return `linked PR #${String(a.pr).replace(/^#/, "")}${a.state ? ` (${a.state})` : ""}${to}`;
    if (commits) return `linked ${plural(commits, "commit")}${a.branch ? ` on ${a.branch}` : ""}${to}`;
    if (a.branch) return `linked branch ${a.branch}${to}`;
    return `linked a commit${to}`;
  }

  switch (verb) {
    case "create":
      if (row.entityType === "task" && !opts.withLabel) return a.fromDraft ? "created the task from a sentence and approved the AI draft" : "created the task";
      return `created${opts.withLabel ? ` ${row.entityType === "task" ? key : label}` : ""}`;
    case "update":
    case "save": {
      const parts: string[] = [];
      if (a.status !== undefined && b.status !== undefined) {
        const to = STATUS_LABEL[a.status as TaskStatus] ?? a.status;
        parts.push(opts.withLabel ? `${key} → ${to}` : `moved ${STATUS_LABEL[b.status as TaskStatus] ?? b.status} → ${to}`);
      }
      if (a.assigneeUserId !== undefined || a.assigneeGrantId !== undefined || a.assignee !== undefined) {
        parts.push(a.assigneeUserId || a.assigneeGrantId || a.assignee ? `assigned ${a.assigneeName ?? "someone"}` : "removed the assignee");
      }
      if (a.priority !== undefined) parts.push(`set priority ${PRIORITY_LABEL[a.priority as Priority] ?? a.priority}`);
      if (a.title !== undefined && b.title !== undefined && a.title !== b.title) parts.push(`renamed to “${a.title}”`);
      if (a.description !== undefined || a.content !== undefined) {
        const stats = typeof a.added === "number" ? ` (+${a.added} −${a.removed ?? 0})` : "";
        parts.push(row.entityType === "task" ? `edited the description${stats}` : `edited${opts.withLabel ? ` ${label}` : ""}${stats}`);
      }
      if (a.labelIds !== undefined) parts.push("changed labels");
      if (a.epicId !== undefined) parts.push(a.epicId ? (b.epicId ? "moved to another epic" : "added to an epic") : "removed the epic");
      if (a.dueDate !== undefined) parts.push(a.dueDate ? `set due ${a.dueDate}` : "removed the due date");
      if (a.type !== undefined) parts.push(`changed type to ${a.type}`);
      if (a.stage !== undefined) parts.push(stageText(a, label, opts.withLabel));
      if (parts.length === 0) {
        const stats = typeof a.added === "number" ? ` (+${a.added} −${a.removed ?? 0})` : "";
        return `edited${target}${stats}`;
      }
      const sentence = parts.join(", ");
      // Status sentences already carry the key.
      return opts.withLabel && !(a.status !== undefined && parts.length === 1) && row.entityType === "task" ? `${sentence} on ${key}` : sentence;
    }
    case "delete":
      return opts.withLabel ? `deleted ${row.entityType === "task" ? key : label} → Trash` : "moved to the trash";
    case "restore":
      return `restored${target}`;
    case "purge":
      return `purged${target}`;
    case "read": {
      const n = Number(a.docs ?? 0);
      if (n) return `read ${plural(n, "linked doc")}${opts.withLabel ? ` of ${key}` : ""}`;
      return `read${target}`;
    }
    case "link_doc":
      return `linked ${a.title ?? "a page"}${opts.withLabel ? ` to ${key}` : ""}`;
    case "unlink_doc":
      return `unlinked ${b.title ?? "a page"}${opts.withLabel ? ` from ${key}` : ""}`;
    case "stage":
      return stageText(a, label, opts.withLabel);
    case "revert":
      return `reverted${target}`;
    default:
      return `${verb.replace(/_/g, " ")}${target}`;
  }
}

export function toAuditEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    actor: storedActor(row.actorType, row.actorId, row.actorName),
    sessionId: row.sessionId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    entityLabel: row.entityLabel,
    text: describeAudit(row, { withLabel: true }),
    revertedAt: row.revertedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class InboxService {
  constructor(
    private readonly dbs: DbService,
    private readonly access: AccessService,
  ) {}

  async list(actor: Actor, input: { workspaceId?: string; archived: boolean }): Promise<Notification[]> {
    const user = this.access.requireUser(actor);
    const rows = await this.dbs.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, user.userId),
          input.workspaceId ? eq(notifications.workspaceId, input.workspaceId) : undefined,
          input.archived ? isNotNull(notifications.archivedAt) : isNull(notifications.archivedAt),
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(200);
    const taskIds = rows.filter((r) => r.entityType === "task").map((r) => r.entityId);
    const keys = new Map(
      taskIds.length ? (await this.dbs.db.select({ id: tasks.id, key: tasks.key }).from(tasks).where(inArray(tasks.id, taskIds))).map((t) => [t.id, t.key]) : [],
    );
    return rows.map((n) => ({
      id: n.id,
      kind: n.kind,
      entityType: n.entityType,
      entityId: n.entityId,
      ref: n.entityType === "task" ? (keys.get(n.entityId) ?? n.entityId) : n.entityId,
      title: n.title,
      body: n.body,
      actor: storedActor(n.actorType, n.actorId, n.actorName),
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  async unread(actor: Actor) {
    if (actor.type !== "user") return { count: 0 };
    const [row] = await this.dbs.db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt), isNull(notifications.archivedAt)));
    return { count: row?.n ?? 0 };
  }

  async markRead(actor: Actor, ids: string[], read: boolean) {
    const user = this.access.requireUser(actor);
    if (ids.length === 0) return;
    await this.dbs.db
      .update(notifications)
      .set({ readAt: read ? new Date() : null })
      .where(and(eq(notifications.userId, user.userId), inArray(notifications.id, ids)));
  }

  async archive(actor: Actor, ids: string[]) {
    const user = this.access.requireUser(actor);
    if (ids.length === 0) return;
    const now = new Date();
    const rows = await this.dbs.db
      .select({ id: notifications.id, readAt: notifications.readAt })
      .from(notifications)
      .where(and(eq(notifications.userId, user.userId), inArray(notifications.id, ids)));
    if (rows.length === 0) return;
    await this.dbs.db
      .update(notifications)
      .set({ archivedAt: now })
      .where(inArray(notifications.id, rows.map((r) => r.id)));
    const unread = rows.filter((r) => !r.readAt).map((r) => r.id);
    if (unread.length) await this.dbs.db.update(notifications).set({ readAt: now }).where(inArray(notifications.id, unread));
  }

  /** Audit log for the settings and agent screens. Always bounded by the actor's workspaces. */
  async auditList(actor: Actor, input: { workspaceId?: string; grantId?: string; entityId?: string; limit: number }): Promise<AuditEntry[]> {
    const account = this.access.requireAccount(actor);
    let workspaceIds: string[];
    if (input.workspaceId) {
      await this.access.requireWorkspace(actor, input.workspaceId);
      workspaceIds = [input.workspaceId];
    } else {
      workspaceIds = await this.access.workspaceIds(actor);
    }
    if (workspaceIds.length === 0) return [];
    const where: (SQL | undefined)[] = [inArray(auditLog.workspaceId, workspaceIds)];
    if (input.grantId) {
      const [grant] = await this.dbs.db
        .select({ id: agentGrants.id })
        .from(agentGrants)
        .where(and(eq(agentGrants.id, input.grantId), eq(agentGrants.userId, account.userId)));
      if (!grant) throw notFound("Agent");
      where.push(eq(auditLog.actorType, "agent"), eq(auditLog.actorId, input.grantId));
    }
    if (input.entityId) where.push(eq(auditLog.entityId, input.entityId));
    if (actor.type === "agent") {
      const readable = await this.access.readableProjectIds(actor);
      where.push(readable.length ? inArray(auditLog.projectId, readable) : eq(auditLog.id, "00000000-0000-0000-0000-000000000000"));
    }
    const rows = await this.dbs.db
      .select()
      .from(auditLog)
      .where(and(...where))
      .orderBy(desc(auditLog.createdAt))
      .limit(input.limit);
    return rows.map(toAuditEntry);
  }

}
