import {
  type AgentGrant,
  type AgentSession,
  type AssignableAgent,
  expiryToDate,
  type GrantInput,
  type GrantLevel,
} from "@mado/contract";
import {
  agentGrantProjects,
  agentGrants,
  agentSessions,
  agentTokens,
  auditLog,
  comments,
  docs,
  labels,
  leads,
  memberships,
  oauthClients,
  projects,
  tasks,
  type Tx,
  users,
  workspaces,
} from "@mado/db";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { DbService } from "../db";
import type { Actor, LoadedGrant } from "../lib/actor";
import { randomToken, sha256, shortId } from "../lib/crypto";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { AccessService } from "./access.service";
import { CrmService } from "./crm.service";
import { DocService } from "./doc.service";
import { toAuditEntry } from "./inbox.service";
import { TaskService } from "./task.service";
import { TrashService, type TrashType } from "./trash.service";

type GrantRow = typeof agentGrants.$inferSelect;
type AuditRow = typeof auditLog.$inferSelect;
type UserActor = Extract<Actor, { type: "user" }>;
type AgentActor = Extract<Actor, { type: "agent" }>;

export const PAT_PREFIX = "mado_pat_";
const LAST_USED_THROTTLE_MS = 60_000;
const ACTIVE_WINDOW_MS = 10 * 60_000;

export interface GrantProjectInfo {
  id: string;
  key: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  level: GrantLevel;
}

export function grantStatus(g: Pick<GrantRow, "revokedAt" | "expiresAt">, now = new Date()): AgentGrant["status"] {
  if (g.revokedAt) return "revoked";
  if (g.expiresAt && g.expiresAt <= now) return "expired";
  return "active";
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

const SOFT_TABLES: Record<TrashType, unknown> = { task: tasks, doc: docs, comment: comments, lead: leads, label: labels, project: projects };
const isTrashType = (t: string): t is TrashType => t in SOFT_TABLES;

/**
 * Grants (OAuth and personal tokens), bearer authentication for MCP, the «Connected agents»
 * screen and one-click revert of an agent session.
 */
@Injectable()
export class AgentService {
  constructor(
    private readonly dbs: DbService,
    private readonly access: AccessService,
    private readonly tasks: TaskService,
    private readonly docs: DocService,
    private readonly crm: CrmService,
    private readonly trash: TrashService,
  ) {}

  // ── Grants ──────────────────────────────────────────────────────────

  /** Active grants of every member of the workspace. Any of these agents may be assigned to a task there. */
  async assignable(actor: Actor, workspaceId: string): Promise<AssignableAgent[]> {
    const viewer = await this.access.requireWorkspace(actor, workspaceId);
    if (!viewer) return [];
    const rows = await this.dbs.db
      .select({ id: agentGrants.id, agentName: agentGrants.agentName, userId: agentGrants.userId, ownerName: users.name })
      .from(agentGrants)
      .innerJoin(memberships, and(eq(memberships.userId, agentGrants.userId), eq(memberships.workspaceId, workspaceId)))
      .innerJoin(users, eq(users.id, agentGrants.userId))
      .where(and(isNull(agentGrants.revokedAt), or(isNull(agentGrants.expiresAt), gt(agentGrants.expiresAt, new Date()))))
      .orderBy(asc(agentGrants.agentName));
    const me = actor.type === "user" || actor.type === "agent" ? actor.userId : null;
    return rows.map((r) => ({ grantId: r.id, agentName: r.agentName, ownerName: r.ownerName, mine: r.userId === me }));
  }

  /** Projects of every workspace the user belongs to. A grant can never reach beyond these. */
  async userProjects(userId: string) {
    return this.dbs.db
      .select({
        id: projects.id,
        key: projects.key,
        name: projects.name,
        description: projects.description,
        workspaceId: projects.workspaceId,
        workspaceName: workspaces.name,
        workspaceSlug: workspaces.slug,
        role: memberships.role,
      })
      .from(projects)
      .innerJoin(memberships, and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, userId)))
      .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
      .where(and(isNull(projects.deletedAt), isNull(workspaces.deletedAt)))
      .orderBy(asc(workspaces.createdAt), asc(projects.sortOrder), asc(projects.createdAt));
  }

  private async validateProjects(userId: string, input: Pick<GrantInput, "projectScope" | "projects">) {
    if (input.projectScope === "all") return [];
    if (input.projects.length === 0) throw badRequest("Pick at least one project");
    const allowed = new Set((await this.userProjects(userId)).map((p) => p.id));
    const seen = new Map<string, GrantLevel>();
    for (const p of input.projects) {
      if (!allowed.has(p.projectId)) throw forbidden("A grant can only cover projects you are a member of");
      seen.set(p.projectId, p.level);
    }
    return [...seen].map(([projectId, level]) => ({ projectId, level }));
  }

  private async newGrantId(tx: Tx) {
    for (let i = 0; i < 20; i++) {
      const id = `g_${shortId(2)}`;
      const [taken] = await tx.select({ id: agentGrants.id }).from(agentGrants).where(eq(agentGrants.id, id));
      if (!taken) return id;
    }
    // 65k ids are plenty for one person; widen only if the short space is crowded.
    return `g_${shortId(4)}`;
  }

  async createGrant(
    tx: Tx,
    userId: string,
    input: GrantInput,
    source: { kind: "oauth" | "pat" | "builtin"; clientId: string | null; clientName: string },
  ): Promise<GrantRow> {
    const listed = await this.validateProjects(userId, input);
    const id = await this.newGrantId(tx);
    const [grant] = await tx
      .insert(agentGrants)
      .values({
        id,
        userId,
        kind: source.kind,
        clientId: source.clientId,
        clientName: source.clientName,
        agentName: input.agentName,
        projectScope: input.projectScope,
        allLevel: input.allLevel,
        resourceTypes: [...new Set(input.resourceTypes)],
        expiresAt: expiryToDate(input.expiry),
      })
      .returning();
    if (listed.length) await tx.insert(agentGrantProjects).values(listed.map((p) => ({ grantId: id, ...p })));
    return grant!;
  }

  private async ownGrant(user: UserActor, id: string): Promise<GrantRow> {
    const [grant] = await this.dbs.db.select().from(agentGrants).where(eq(agentGrants.id, id));
    if (!grant || grant.userId !== user.userId) throw notFound("Agent");
    return grant;
  }

  private async toAgentGrants(rows: GrantRow[]): Promise<AgentGrant[]> {
    if (rows.length === 0) return [];
    const listed = await this.dbs.db
      .select({ grantId: agentGrantProjects.grantId, projectId: projects.id, key: projects.key, name: projects.name, level: agentGrantProjects.level })
      .from(agentGrantProjects)
      .innerJoin(projects, eq(projects.id, agentGrantProjects.projectId))
      .where(and(inArray(agentGrantProjects.grantId, rows.map((r) => r.id)), isNull(projects.deletedAt)))
      .orderBy(asc(projects.key));
    const byUser = new Map<string, Awaited<ReturnType<AgentService["userProjects"]>>>();
    const out: AgentGrant[] = [];
    for (const g of rows) {
      let grantProjects: AgentGrant["projects"];
      if (g.projectScope === "all") {
        if (!byUser.has(g.userId)) byUser.set(g.userId, await this.userProjects(g.userId));
        grantProjects = byUser.get(g.userId)!.map((p) => ({ projectId: p.id, key: p.key, name: p.name, level: g.allLevel }));
      } else {
        grantProjects = listed.filter((p) => p.grantId === g.id).map(({ grantId: _, ...p }) => p);
      }
      out.push({
        id: g.id,
        kind: g.kind,
        clientName: g.clientName,
        clientVerified: g.kind !== "oauth" || (await this.clientVerified(g.clientId)),
        agentName: g.agentName,
        projectScope: g.projectScope,
        allLevel: g.allLevel,
        projects: grantProjects,
        resourceTypes: g.resourceTypes,
        expiresAt: g.expiresAt?.toISOString() ?? null,
        revokedAt: g.revokedAt?.toISOString() ?? null,
        lastUsedAt: g.lastUsedAt?.toISOString() ?? null,
        lastIp: g.lastIp,
        createdAt: g.createdAt.toISOString(),
        status: grantStatus(g),
      });
    }
    return out;
  }

  private async clientVerified(clientId: string | null) {
    if (!clientId) return false;
    const [row] = await this.dbs.db.select({ verified: oauthClients.verified }).from(oauthClients).where(eq(oauthClients.clientId, clientId));
    return row?.verified ?? false;
  }

  async list(actor: Actor): Promise<AgentGrant[]> {
    const user = this.access.requireUser(actor);
    const rows = await this.dbs.db
      .select()
      .from(agentGrants)
      .where(eq(agentGrants.userId, user.userId))
      .orderBy(desc(agentGrants.createdAt));
    const grants = await this.toAgentGrants(rows);
    const order = { active: 0, expired: 1, revoked: 2 };
    return grants.sort((a, b) => order[a.status] - order[b.status]);
  }

  async get(actor: Actor, id: string): Promise<AgentGrant> {
    const grant = await this.ownGrant(this.access.requireUser(actor), id);
    return (await this.toAgentGrants([grant]))[0]!;
  }

  /** Tokens carry only the grant id, so these edits apply on the agent's next call. */
  async update(actor: Actor, id: string, patch: Partial<GrantInput>): Promise<AgentGrant> {
    const user = this.access.requireUser(actor);
    const grant = await this.ownGrant(user, id);
    if (grant.revokedAt) throw conflict("This agent was revoked. Connect it again to grant new access.");
    const projectScope = patch.projectScope ?? grant.projectScope;
    const listed =
      patch.projects !== undefined || patch.projectScope === "listed"
        ? await this.validateProjects(user.userId, {
            projectScope,
            projects: patch.projects ?? (await this.dbs.db.select().from(agentGrantProjects).where(eq(agentGrantProjects.grantId, id))),
          })
        : null;
    await this.dbs.db.transaction(async (tx) => {
      await tx
        .update(agentGrants)
        .set({
          ...(patch.agentName !== undefined ? { agentName: patch.agentName } : {}),
          ...(patch.projectScope !== undefined ? { projectScope: patch.projectScope } : {}),
          ...(patch.allLevel !== undefined ? { allLevel: patch.allLevel } : {}),
          ...(patch.resourceTypes !== undefined ? { resourceTypes: [...new Set(patch.resourceTypes)] } : {}),
          ...(patch.expiry !== undefined ? { expiresAt: expiryToDate(patch.expiry) } : {}),
        })
        .where(eq(agentGrants.id, id));
      if (listed) {
        await tx.delete(agentGrantProjects).where(eq(agentGrantProjects.grantId, id));
        if (listed.length) await tx.insert(agentGrantProjects).values(listed.map((p) => ({ grantId: id, ...p })));
      }
      if (patch.expiry !== undefined) {
        // Refresh tokens never outlive their grant.
        const expiresAt = expiryToDate(patch.expiry);
        await tx
          .update(agentTokens)
          .set({ expiresAt })
          .where(and(eq(agentTokens.grantId, id), inArray(agentTokens.type, ["refresh", "pat"]), isNull(agentTokens.revokedAt)));
      }
    });
    return this.get(actor, id);
  }

  async revoke(actor: Actor, id: string) {
    const grant = await this.ownGrant(this.access.requireUser(actor), id);
    await this.dbs.db.transaction(async (tx) => {
      const now = new Date();
      if (!grant.revokedAt) await tx.update(agentGrants).set({ revokedAt: now }).where(eq(agentGrants.id, id));
      await this.revokeTokens(tx, id, now);
    });
  }

  async revokeTokens(tx: Tx, grantId: string, now = new Date()) {
    await tx
      .update(agentTokens)
      .set({ revokedAt: now })
      .where(and(eq(agentTokens.grantId, grantId), isNull(agentTokens.revokedAt)));
  }

  /** Personal access token on the same grant table, for clients without OAuth. Shown once. */
  async createToken(actor: Actor, input: GrantInput): Promise<{ grant: AgentGrant; token: string }> {
    const user = this.access.requireUser(actor);
    const token = randomToken(32, PAT_PREFIX);
    const grant = await this.dbs.db.transaction(async (tx) => {
      const grant = await this.createGrant(tx, user.userId, input, { kind: "pat", clientId: null, clientName: "Personal access token" });
      await tx.insert(agentTokens).values({ grantId: grant.id, type: "pat", tokenHash: sha256(token), expiresAt: grant.expiresAt });
      return grant;
    });
    return { grant: (await this.toAgentGrants([grant]))[0]!, token };
  }

  // ── Bearer authentication ───────────────────────────────────────────

  /**
   * Resolves an access token or PAT to an agent actor. The grant is re-read on every call,
   * so privilege edits and revocations apply immediately.
   */
  async authenticate(token: string, ip: string | null): Promise<AgentActor | null> {
    if (!token) return null;
    const now = new Date();
    const [row] = await this.dbs.db
      .select({ grant: agentGrants })
      .from(agentTokens)
      .innerJoin(agentGrants, eq(agentGrants.id, agentTokens.grantId))
      .innerJoin(users, eq(users.id, agentGrants.userId))
      .where(
        and(
          eq(agentTokens.tokenHash, sha256(token)),
          inArray(agentTokens.type, ["access", "pat"]),
          isNull(agentTokens.revokedAt),
          or(isNull(agentTokens.expiresAt), gt(agentTokens.expiresAt, now)),
          isNull(agentGrants.revokedAt),
          or(isNull(agentGrants.expiresAt), gt(agentGrants.expiresAt, now)),
        ),
      );
    if (!row) return null;
    const grant = row.grant;
    if (!grant.lastUsedAt || now.getTime() - grant.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS || grant.lastIp !== ip) {
      await this.dbs.db.update(agentGrants).set({ lastUsedAt: now, lastIp: ip }).where(eq(agentGrants.id, grant.id));
    }
    return { type: "agent", userId: grant.userId, grant: await this.loadGrant(grant), name: grant.agentName, sessionId: null };
  }

  async loadGrant(grant: GrantRow): Promise<LoadedGrant> {
    const rows =
      grant.projectScope === "all"
        ? []
        : await this.dbs.db.select().from(agentGrantProjects).where(eq(agentGrantProjects.grantId, grant.id));
    return {
      id: grant.id,
      userId: grant.userId,
      agentName: grant.agentName,
      projectScope: grant.projectScope,
      allLevel: grant.allLevel,
      projects: new Map(rows.map((r) => [r.projectId, r.level])),
      resourceTypes: grant.resourceTypes,
    };
  }

  /** Projects an agent can see, with its level on each. Bounded by the user's memberships. */
  async agentProjects(actor: AgentActor): Promise<GrantProjectInfo[]> {
    const all = await this.userProjects(actor.userId);
    const out: GrantProjectInfo[] = [];
    for (const p of all) {
      const level = this.access.grantLevel(actor, p.id);
      if (level) out.push({ id: p.id, key: p.key, name: p.name, workspaceId: p.workspaceId, workspaceName: p.workspaceName, workspaceSlug: p.workspaceSlug, level });
    }
    return out;
  }

  // ── Sessions ────────────────────────────────────────────────────────

  /** One row per MCP session; every write in it carries this short id. */
  async startSession(grantId: string): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const id = shortId(2);
      const inserted = await this.dbs.db.insert(agentSessions).values({ id, grantId }).onConflictDoNothing().returning({ id: agentSessions.id });
      if (inserted.length) return id;
    }
    const id = shortId(4);
    await this.dbs.db.insert(agentSessions).values({ id, grantId });
    return id;
  }

  async touchSession(sessionId: string, lastTaskKey?: string) {
    await this.dbs.db
      .update(agentSessions)
      .set({ lastActiveAt: new Date(), ...(lastTaskKey ? { lastTaskKey } : {}) })
      .where(eq(agentSessions.id, sessionId));
  }

  async sessions(actor: Actor, grantId: string): Promise<AgentSession[]> {
    const grant = await this.ownGrant(this.access.requireUser(actor), grantId);
    const rows = await this.dbs.db
      .select()
      .from(agentSessions)
      .where(and(eq(agentSessions.grantId, grantId), gt(agentSessions.writes, 0)))
      .orderBy(desc(agentSessions.lastActiveAt))
      .limit(50);
    if (rows.length === 0) return [];
    const entries = await this.dbs.db
      .select()
      .from(auditLog)
      .where(and(inArray(auditLog.sessionId, rows.map((r) => r.id)), eq(auditLog.actorType, "agent"), eq(auditLog.actorId, grantId)))
      .orderBy(desc(auditLog.createdAt));
    return rows.map((s) => ({
      id: s.id,
      grantId: s.grantId,
      agentName: grant.agentName,
      writes: s.writes,
      startedAt: s.startedAt.toISOString(),
      lastActiveAt: s.lastActiveAt.toISOString(),
      revertedAt: s.revertedAt?.toISOString() ?? null,
      entries: entries.filter((e) => e.sessionId === s.id && !e.action.endsWith(".read")).map(toAuditEntry),
    }));
  }

  /** Sessions active in the last 10 minutes, for the «Claude Code is on GAT-109» banner. */
  async activeSessions(actor: Actor) {
    const user = this.access.requireUser(actor);
    const rows = await this.dbs.db
      .select({ session: agentSessions, agentName: agentGrants.agentName })
      .from(agentSessions)
      .innerJoin(agentGrants, eq(agentGrants.id, agentSessions.grantId))
      .where(
        and(
          eq(agentGrants.userId, user.userId),
          isNull(agentGrants.revokedAt),
          isNull(agentSessions.revertedAt),
          gt(agentSessions.lastActiveAt, new Date(Date.now() - ACTIVE_WINDOW_MS)),
        ),
      )
      .orderBy(desc(agentSessions.lastActiveAt));
    return rows.map((r) => ({
      sessionId: r.session.id,
      agentName: r.agentName,
      grantId: r.session.grantId,
      writes: r.session.writes,
      lastTaskKey: r.session.lastTaskKey,
      lastActiveAt: r.session.lastActiveAt.toISOString(),
    }));
  }

  // ── Revert ──────────────────────────────────────────────────────────

  /**
   * Undo every write of one agent run, newest first: creates are soft deleted, updates get their
   * `before` written back, deletes are restored. Entries whose entity someone else touched later
   * are skipped so a revert never clobbers newer work. Each undo goes through the normal service as
   * the signed-in user, so it is authorized, audited and revisioned like a manual edit.
   */
  async revertSession(actor: Actor, sessionId: string): Promise<{ reverted: number; skipped: number }> {
    const user = this.access.requireUser(actor);
    const [session] = await this.dbs.db.select().from(agentSessions).where(eq(agentSessions.id, sessionId));
    if (!session) throw notFound("Session");
    await this.ownGrant(user, session.grantId);
    if (session.revertedAt) throw conflict(`Session ${sessionId} was already reverted`);

    const startedAt = new Date();
    const entries = await this.dbs.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.sessionId, sessionId), isNull(auditLog.revertedAt)))
      .orderBy(desc(auditLog.createdAt));

    let reverted = 0;
    let skipped = 0;
    for (const entry of entries) {
      if (entry.action.endsWith(".read")) continue;
      if (await this.changedLaterByOthers(entry, startedAt)) {
        skipped++;
        continue;
      }
      let done = false;
      try {
        done = await this.undo(user, entry);
      } catch {
        done = false;
      }
      if (done) {
        await this.dbs.db.update(auditLog).set({ revertedAt: new Date() }).where(eq(auditLog.id, entry.id));
        reverted++;
      } else {
        skipped++;
      }
    }
    await this.dbs.db.update(agentSessions).set({ revertedAt: new Date() }).where(eq(agentSessions.id, sessionId));
    return { reverted, skipped };
  }

  /** Rows written by this revert itself (after `revertStart`) don't count as someone else's change. */
  private async changedLaterByOthers(entry: AuditRow, revertStart: Date) {
    const [later] = await this.dbs.db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, entry.entityType),
          eq(auditLog.entityId, entry.entityId),
          gt(auditLog.createdAt, entry.createdAt),
          lt(auditLog.createdAt, revertStart),
          or(isNull(auditLog.sessionId), ne(auditLog.sessionId, entry.sessionId!)),
          isNull(auditLog.revertedAt),
          sql`${auditLog.action} not like '%.read'`,
        ),
      )
      .limit(1);
    return Boolean(later);
  }

  private async isDeleted(type: TrashType, id: string) {
    const table = SOFT_TABLES[type] as unknown as typeof tasks;
    const [row] = await this.dbs.db.select({ deletedAt: table.deletedAt }).from(table).where(eq(table.id, id));
    if (!row) return null;
    return row.deletedAt !== null;
  }

  /** Returns false when the entry can't be undone (unknown action, or the entity is gone). */
  private async undo(user: UserActor, entry: AuditRow): Promise<boolean> {
    const type = entry.entityType;
    const verb = entry.action.split(".").pop() ?? "";
    const id = entry.entityId;
    const before = rec(entry.before);
    const after = rec(entry.after);
    const summary = `Reverted session ${entry.sessionId}`;

    if (type === "task" && (verb === "link_doc" || verb === "unlink_doc")) {
      const docId = (after.docId ?? before.docId) as string | undefined;
      if (!docId) return false;
      await this.tasks.linkDoc(user, id, docId, verb === "unlink_doc");
      return true;
    }
    if (type === "doc" && (verb === "save" || verb === "restore") && typeof before.content === "string") {
      await this.docs.save(user, { id, title: before.title as string | undefined, content: before.content, checkpoint: true, summary });
      return true;
    }
    if (type === "doc" && verb === "move" && "parentId" in before) {
      await this.docs.move(user, { id, parentId: (before.parentId as string | null) ?? null, sortOrder: Number(before.sortOrder ?? 0) });
      return true;
    }
    if (type === "task" && verb === "update") {
      const patch = pick(before, TASK_PATCH_KEYS);
      // Audit rows store the assignee as the column pair; the task patch takes "user:<id>" | "agent:<id>" | null.
      if ("assigneeUserId" in before || "assigneeGrantId" in before) {
        patch.assignee = before.assigneeUserId ? `user:${before.assigneeUserId}` : before.assigneeGrantId ? `agent:${before.assigneeGrantId}` : null;
      }
      if (Object.keys(patch).length === 0) return false;
      await this.tasks.update(user, id, patch);
      return true;
    }
    if (type === "lead" && (verb === "update" || verb === "stage")) {
      const patch = pick(before, LEAD_PATCH_KEYS);
      if (patch.contact === null) delete patch.contact;
      if (Object.keys(patch).length === 0) return false;
      await this.crm.update(user, id, patch, { summary, forceRevision: true });
      return true;
    }
    if (!isTrashType(type)) return false;
    const deleted = await this.isDeleted(type, id);
    if (deleted === null) return false;

    if (verb === "create" || verb === "restore") {
      if (deleted) return true;
      if (type === "task") await this.tasks.delete(user, id);
      else if (type === "doc") await this.docs.delete(user, id);
      else if (type === "comment") await this.tasks.deleteComment(user, id);
      else if (type === "lead") await this.crm.delete(user, id);
      else return false;
      return true;
    }
    if (verb === "delete") {
      if (!deleted) return true;
      await this.trash.restore(user, type, id);
      return true;
    }
    return false;
  }
}

const TASK_PATCH_KEYS = ["title", "description", "type", "status", "priority", "assignee", "labelIds", "epicId", "dueDate", "sortOrder"] as const;
const LEAD_PATCH_KEYS = ["stage", "source", "notes", "lastContactAt", "lastContactNote", "sortOrder", "company", "contact"] as const;

function pick(values: Record<string, unknown>, keys: readonly string[]): Record<string, any> {
  return Object.fromEntries(Object.entries(values).filter(([k]) => keys.includes(k)));
}
