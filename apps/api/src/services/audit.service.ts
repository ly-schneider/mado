import { agentSessions, auditLog, notifications, revisions, type Tx } from "@mado/db";
import { Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { type Actor, actorId, actorSession } from "../lib/actor";

export interface AuditInput {
  workspaceId: string;
  projectId?: string | null;
  action: string; // task.create, task.update, doc.save, doc.delete, comment.create, ...
  entityType: string;
  entityId: string;
  entityLabel: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Every write goes through record(): one audit row with before/after, attributed to the real
 * actor (an agent is never disguised as its user), and counted against the agent session.
 */
@Injectable()
export class AuditService {
  async record(tx: Tx, actor: Actor, input: AuditInput) {
    const sessionId = actorSession(actor);
    await tx.insert(auditLog).values({
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      actorType: actor.type,
      actorId: actorId(actor),
      actorName: actor.name,
      sessionId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      entityLabel: input.entityLabel,
      before: (input.before ?? null) as object | null,
      after: (input.after ?? null) as object | null,
    });
    if (sessionId && actor.type === "agent" && !input.action.endsWith(".read")) {
      const lastTaskKey = input.entityType === "task" ? input.entityLabel.split(" ")[0] : undefined;
      await tx
        .update(agentSessions)
        .set({ writes: sql`${agentSessions.writes} + 1`, lastActiveAt: new Date(), ...(lastTaskKey ? { lastTaskKey } : {}) })
        .where(eq(agentSessions.id, sessionId));
    }
  }

  /** Append-only revision. Returns the new revision number. */
  async revision(
    tx: Tx,
    actor: Actor,
    input: {
      entityType: "doc" | "task" | "lead";
      entityId: string;
      snapshot: unknown;
      added?: number;
      removed?: number;
      summary?: string | null;
    },
  ) {
    const [last] = await tx
      .select({ number: revisions.number })
      .from(revisions)
      .where(and(eq(revisions.entityType, input.entityType), eq(revisions.entityId, input.entityId)))
      .orderBy(desc(revisions.number))
      .limit(1);
    const number = (last?.number ?? 0) + 1;
    await tx.insert(revisions).values({
      entityType: input.entityType,
      entityId: input.entityId,
      number,
      snapshot: input.snapshot as object,
      added: input.added ?? 0,
      removed: input.removed ?? 0,
      summary: input.summary ?? null,
      actorType: actor.type,
      actorId: actorId(actor),
      actorName: actor.name,
      sessionId: actorSession(actor),
    });
    return number;
  }

  async notify(
    tx: Tx,
    actor: Actor,
    input: {
      userId: string;
      workspaceId: string;
      kind: string;
      entityType: string;
      entityId: string;
      title: string;
      body?: string;
    },
  ) {
    // Never notify people about their own actions.
    if (actor.type === "user" && actor.userId === input.userId) return;
    await tx.insert(notifications).values({
      ...input,
      body: input.body ?? "",
      actorType: actor.type,
      actorId: actorId(actor),
      actorName: actor.name,
    });
  }
}

/** Line-level diff stats for revisions: lines added and removed. */
export function diffStats(before: string, after: string) {
  const a = before.split("\n");
  const b = after.split("\n");
  const counts = new Map<string, number>();
  for (const line of a) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of b) {
    const n = counts.get(line) ?? 0;
    if (n > 0) counts.set(line, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of counts.values()) removed += n;
  return { added, removed };
}
