import {
  type ActivityEntry,
  type Assignee,
  type Actor as ActorView,
  type Comment,
  type GitLink,
  type LabelColor,
  type LinkedDoc,
  STATUS_LABEL,
  type TaskDetail,
  type TaskDraft,
  type TaskStatus,
  type TaskSummary,
  type TaskType,
  type Priority,
  PRIORITIES,
  TASK_TYPES,
} from "@mado/contract";
import {
  agentGrantProjects,
  agentGrants,
  agentSessions,
  auditLog,
  comments,
  type Db,
  docs,
  gitLinks,
  labels,
  memberships,
  projects,
  shareLinks,
  taskDocs,
  taskLabels,
  tasks,
  type Tx,
  users,
} from "@mado/db";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, exists, inArray, isNull, min, ne, notInArray, or, type SQL, sql } from "drizzle-orm";
import { DbService } from "../db";
import { type Actor, actorId, actorSession, initials } from "../lib/actor";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { AccessService } from "./access.service";
import { AiService } from "./ai.service";
import { AuditService, diffStats } from "./audit.service";
import { describeAudit } from "./inbox.service";
import { RefsService } from "./refs.service";

type TaskRow = typeof tasks.$inferSelect;
type Patch = {
  title?: string;
  description?: string;
  type?: TaskType;
  status?: TaskStatus;
  priority?: Priority;
  assignee?: string | null;
  labelIds?: string[];
  epicId?: string | null;
  dueDate?: string | null;
  sortOrder?: number;
};

const CLOSED: TaskStatus[] = ["done", "canceled"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SYSTEM_NAMES: Record<string, string> = { github: "GitHub", gitlab: "GitLab" };

/** Display actors for stored (type, id) pairs: users get initials, agents render the glyph. */
export async function resolveActors(db: Db, refs: { type: string; id: string }[]): Promise<Map<string, ActorView>> {
  const out = new Map<string, ActorView>();
  const userIds = [...new Set(refs.filter((r) => r.type === "user" && UUID_RE.test(r.id)).map((r) => r.id))];
  const grantIds = [...new Set(refs.filter((r) => r.type === "agent").map((r) => r.id))];
  const linkIds = [...new Set(refs.filter((r) => r.type === "guest" && UUID_RE.test(r.id)).map((r) => r.id))];
  if (userIds.length) {
    for (const u of await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds))) {
      out.set(`user:${u.id}`, { type: "user", id: u.id, name: u.name, initials: initials(u.name) });
    }
  }
  if (grantIds.length) {
    for (const g of await db.select({ id: agentGrants.id, name: agentGrants.agentName }).from(agentGrants).where(inArray(agentGrants.id, grantIds))) {
      out.set(`agent:${g.id}`, { type: "agent", id: g.id, name: g.name, initials: null });
    }
  }
  if (linkIds.length) {
    for (const l of await db.select({ id: shareLinks.id, name: shareLinks.name }).from(shareLinks).where(inArray(shareLinks.id, linkIds))) {
      out.set(`guest:${l.id}`, { type: "guest", id: l.id, name: `Guest via “${l.name}”`, initials: "GU" });
    }
  }
  for (const r of refs) {
    const k = `${r.type}:${r.id}`;
    if (out.has(k)) continue;
    if (r.type === "system") out.set(k, { type: "system", id: r.id, name: SYSTEM_NAMES[r.id] ?? "mado", initials: null });
    else out.set(k, { type: r.type as ActorView["type"], id: r.id, name: "Unknown", initials: r.type === "agent" ? null : "?" });
  }
  return out;
}

export function storedActor(type: string, id: string, name: string): ActorView {
  return { type: type as ActorView["type"], id, name, initials: type === "user" || type === "guest" ? initials(name) : null };
}

/** id → "Parent / Child" path of the page's ancestors (empty for root pages). */
export async function docPaths(db: Db, workspaceId: string): Promise<(id: string) => string> {
  const rows = await db.select({ id: docs.id, parentId: docs.parentId, title: docs.title }).from(docs).where(eq(docs.workspaceId, workspaceId));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return (id) => {
    const parts: string[] = [];
    let cur = byId.get(id)?.parentId ?? null;
    for (let depth = 0; cur && depth < 64; depth++) {
      const row = byId.get(cur);
      if (!row) break;
      parts.unshift(row.title);
      cur = row.parentId;
    }
    return parts.join(" / ");
  };
}

export function parseAssignee(value: string | null | undefined): { userId: string | null; grantId: string | null } {
  if (!value || value === "none") return { userId: null, grantId: null };
  const [type, ...rest] = value.split(":");
  const id = rest.join(":");
  if (type === "user" && id) return { userId: id, grantId: null };
  if (type === "agent" && id) return { userId: null, grantId: id };
  throw badRequest(`Invalid assignee ${value}`);
}

const assigneeString = (t: Pick<TaskRow, "assigneeUserId" | "assigneeGrantId">) =>
  t.assigneeUserId ? `user:${t.assigneeUserId}` : t.assigneeGrantId ? `agent:${t.assigneeGrantId}` : null;

@Injectable()
export class TaskService {
  constructor(
    private readonly dbs: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly refs: RefsService,
    private readonly ai: AiService,
  ) {}

  private get db() {
    return this.dbs.db;
  }

  async toSummaries(rows: TaskRow[]): Promise<TaskSummary[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const epicIds = [...new Set(rows.map((r) => r.epicId).filter((x): x is string => !!x))];
    const userIds = [...new Set(rows.map((r) => r.assigneeUserId).filter((x): x is string => !!x))];
    const grantIds = [...new Set(rows.map((r) => r.assigneeGrantId).filter((x): x is string => !!x))];

    const [labelRows, epicRows, userRows, grantRows, prRows] = await Promise.all([
      this.db
        .select({ taskId: taskLabels.taskId, id: labels.id, name: labels.name, color: labels.color })
        .from(taskLabels)
        .innerJoin(labels, and(eq(labels.id, taskLabels.labelId), isNull(labels.deletedAt)))
        .where(inArray(taskLabels.taskId, ids))
        .orderBy(asc(labels.name)),
      epicIds.length
        ? this.db.select({ id: tasks.id, key: tasks.key, title: tasks.title }).from(tasks).where(and(inArray(tasks.id, epicIds), isNull(tasks.deletedAt)))
        : [],
      userIds.length ? this.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [],
      grantIds.length ? this.db.select({ id: agentGrants.id, name: agentGrants.agentName }).from(agentGrants).where(inArray(agentGrants.id, grantIds)) : [],
      this.db
        .select({ taskId: gitLinks.taskId, externalId: gitLinks.externalId })
        .from(gitLinks)
        .where(and(inArray(gitLinks.taskId, ids), eq(gitLinks.kind, "pr")))
        .orderBy(desc(gitLinks.createdAt)),
    ]);

    const labelsBy = new Map<string, TaskSummary["labels"]>();
    for (const l of labelRows) {
      const list = labelsBy.get(l.taskId) ?? [];
      list.push({ id: l.id, name: l.name, color: l.color as LabelColor });
      labelsBy.set(l.taskId, list);
    }
    const epics = new Map(epicRows.map((e) => [e.id, e]));
    const usersBy = new Map(userRows.map((u) => [u.id, u.name]));
    const grantsBy = new Map(grantRows.map((g) => [g.id, g.name]));
    const prBy = new Map<string, string>();
    for (const p of prRows) if (!prBy.has(p.taskId)) prBy.set(p.taskId, p.externalId.replace(/^#/, ""));

    return rows.map((t) => {
      let assignee: Assignee | null = null;
      if (t.assigneeUserId) {
        const name = usersBy.get(t.assigneeUserId) ?? "Unknown";
        assignee = { type: "user", id: t.assigneeUserId, name, initials: initials(name) };
      } else if (t.assigneeGrantId) {
        assignee = { type: "agent", id: t.assigneeGrantId, name: grantsBy.get(t.assigneeGrantId) ?? "Agent", initials: null };
      }
      const epic = t.epicId ? epics.get(t.epicId) : undefined;
      return {
        id: t.id,
        key: t.key,
        projectId: t.projectId,
        type: t.type,
        title: t.title,
        status: t.status,
        priority: t.priority,
        assignee,
        labels: labelsBy.get(t.id) ?? [],
        epic: epic ? { id: epic.id, key: epic.key, title: epic.title } : null,
        dueDate: t.dueDate,
        prNumber: prBy.get(t.id) ?? null,
        sortOrder: t.sortOrder,
        updatedAt: t.updatedAt.toISOString(),
        createdAt: t.createdAt.toISOString(),
      };
    });
  }

  private async summary(id: string) {
    const [row] = await this.db.select().from(tasks).where(eq(tasks.id, id));
    return (await this.toSummaries([row!]))[0]!;
  }

  private async findTask(id: string, opts: { includeDeleted?: boolean } = {}) {
    const [row] = await this.db.select().from(tasks).where(eq(tasks.id, id));
    if (!row || (row.deletedAt && !opts.includeDeleted)) throw notFound("Task");
    return row;
  }

  async list(
    actor: Actor,
    projectId: string,
    filter: { labelIds?: string[]; epicIds?: string[]; assignee?: string[]; statuses?: TaskStatus[]; types?: TaskType[] } = {},
  ) {
    await this.access.requireProject(actor, projectId, "read", "tasks");
    const where: (SQL | undefined)[] = [eq(tasks.projectId, projectId), isNull(tasks.deletedAt)];
    if (filter.statuses?.length) where.push(inArray(tasks.status, filter.statuses));
    if (filter.types?.length) where.push(inArray(tasks.type, filter.types));
    if (filter.epicIds?.length) where.push(inArray(tasks.epicId, filter.epicIds));
    if (filter.labelIds?.length) {
      where.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(taskLabels)
            .where(and(eq(taskLabels.taskId, tasks.id), inArray(taskLabels.labelId, filter.labelIds))),
        ),
      );
    }
    if (filter.assignee?.length) {
      const parts: SQL[] = [];
      for (const a of filter.assignee) {
        if (a === "none") parts.push(and(isNull(tasks.assigneeUserId), isNull(tasks.assigneeGrantId))!);
        else {
          const p = parseAssignee(a);
          if (p.userId) parts.push(eq(tasks.assigneeUserId, p.userId));
          if (p.grantId) parts.push(eq(tasks.assigneeGrantId, p.grantId));
        }
      }
      where.push(or(...parts));
    }
    const rows = await this.db
      .select()
      .from(tasks)
      .where(and(...where))
      .orderBy(asc(tasks.sortOrder), desc(tasks.createdAt));
    return this.toSummaries(rows);
  }

  async mine(actor: Actor, tab: "assigned" | "created" | "agents") {
    const account = this.access.requireAccount(actor);
    const readable = await this.access.readableProjectIds(actor);
    if (readable.length === 0) return [];
    let who: SQL | undefined;
    if (tab === "assigned") {
      who = actor.type === "agent" ? eq(tasks.assigneeGrantId, actor.grant.id) : eq(tasks.assigneeUserId, account.userId);
    } else if (tab === "created") {
      who = and(eq(tasks.createdByType, actor.type), eq(tasks.createdById, actorId(actor)));
    } else {
      const grants = await this.db.select({ id: agentGrants.id }).from(agentGrants).where(eq(agentGrants.userId, account.userId));
      const ids = grants.map((g) => g.id);
      if (ids.length === 0) return [];
      who = or(inArray(tasks.assigneeGrantId, ids), and(eq(tasks.createdByType, "agent"), inArray(tasks.createdById, ids)));
    }
    const rows = await this.db
      .select()
      .from(tasks)
      .where(and(who, inArray(tasks.projectId, readable), isNull(tasks.deletedAt), notInArray(tasks.status, CLOSED), ne(tasks.type, "epic")))
      .orderBy(asc(tasks.sortOrder), desc(tasks.createdAt))
      .limit(500);
    return this.toSummaries(rows);
  }

  async epics(actor: Actor, projectId: string) {
    return this.list(actor, projectId, { types: ["epic"] });
  }

  async get(actor: Actor, key: string): Promise<TaskDetail> {
    // The UI pads numbers (MAD-099); stored keys don't.
    const normalized = key.trim().toUpperCase().replace(/-0+(\d)/, "-$1");
    const [row] = await this.db.select().from(tasks).where(and(eq(tasks.key, normalized), isNull(tasks.deletedAt)));
    if (!row) throw notFound("Task");
    const project = await this.access.requireProject(actor, row.projectId, "read", "tasks");

    const [summary] = await this.toSummaries([row]);
    const [linkRows, gitRows, commentRows, auditRows, childRows, pathOf] = await Promise.all([
      this.db
        .select({ id: docs.id, title: docs.title, lastReadByAgentAt: taskDocs.lastReadByAgentAt })
        .from(taskDocs)
        .innerJoin(docs, and(eq(docs.id, taskDocs.docId), isNull(docs.deletedAt)))
        .where(eq(taskDocs.taskId, row.id))
        .orderBy(asc(taskDocs.createdAt)),
      this.db.select().from(gitLinks).where(eq(gitLinks.taskId, row.id)).orderBy(desc(sql`coalesce(${gitLinks.authoredAt}, ${gitLinks.createdAt})`)),
      this.db
        .select()
        .from(comments)
        .where(and(eq(comments.taskId, row.id), isNull(comments.deletedAt)))
        .orderBy(asc(comments.createdAt)),
      this.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityType, "task"), eq(auditLog.entityId, row.id)))
        .orderBy(asc(auditLog.createdAt))
        .limit(200),
      row.type === "epic"
        ? this.db
            .select()
            .from(tasks)
            .where(and(eq(tasks.epicId, row.id), isNull(tasks.deletedAt)))
            .orderBy(asc(tasks.sortOrder), desc(tasks.createdAt))
        : Promise.resolve([] as TaskRow[]),
      docPaths(this.db, project.workspaceId),
    ]);

    const actors = await resolveActors(this.db, [
      { type: row.createdByType, id: row.createdById },
      ...commentRows.map((c) => ({ type: c.actorType, id: c.actorId })),
    ]);

    const linkedDocs: LinkedDoc[] = linkRows.map((d) => ({
      id: d.id,
      title: d.title,
      path: pathOf(d.id),
      lastReadByAgentAt: d.lastReadByAgentAt?.toISOString() ?? null,
    }));
    const git: GitLink[] = gitRows.map((g) => ({
      id: g.id,
      provider: g.provider,
      kind: g.kind,
      externalId: g.externalId,
      title: g.title,
      url: g.url,
      state: g.state,
      repo: g.repo,
      at: (g.authoredAt ?? g.createdAt).toISOString(),
    }));
    const commentList: Comment[] = commentRows.map((c) => ({
      id: c.id,
      body: c.body,
      actor: actors.get(`${c.actorType}:${c.actorId}`)!,
      sessionId: c.sessionId,
      createdAt: c.createdAt.toISOString(),
    }));
    const activity: ActivityEntry[] = auditRows.map((a) => ({
      id: a.id,
      actor: storedActor(a.actorType, a.actorId, a.actorName),
      action: a.action,
      text: describeAudit(a, { withLabel: false }),
      via: activityVia(a),
      sessionId: a.sessionId,
      createdAt: a.createdAt.toISOString(),
    }));
    const branch = row.branch ?? gitRows.find((g) => g.kind === "branch")?.externalId ?? null;

    return {
      ...summary!,
      description: row.description,
      project: { id: project.id, key: project.key, name: project.name },
      createdBy: actors.get(`${row.createdByType}:${row.createdById}`)!,
      branch,
      linkedDocs,
      git,
      comments: commentList,
      activity,
      children: await this.toSummaries(childRows),
      agentAccess: row.assigneeGrantId ? await this.agentAccess(row.assigneeGrantId, project) : null,
    };
  }

  private async agentAccess(grantId: string, project: typeof projects.$inferSelect): Promise<TaskDetail["agentAccess"]> {
    const [grant] = await this.db.select().from(agentGrants).where(eq(agentGrants.id, grantId));
    if (!grant) return null;
    let names: string[];
    let level = grant.allLevel;
    if (grant.projectScope === "all") {
      const rows = await this.db
        .select({ name: projects.name })
        .from(projects)
        .where(and(eq(projects.workspaceId, project.workspaceId), isNull(projects.deletedAt)))
        .orderBy(asc(projects.sortOrder));
      names = rows.map((r) => r.name);
    } else {
      const rows = await this.db
        .select({ name: projects.name, projectId: projects.id, level: agentGrantProjects.level })
        .from(agentGrantProjects)
        .innerJoin(projects, eq(projects.id, agentGrantProjects.projectId))
        .where(and(eq(agentGrantProjects.grantId, grantId), isNull(projects.deletedAt)));
      names = rows.map((r) => r.name);
      level = rows.find((r) => r.projectId === project.id)?.level ?? "read";
    }
    const [session] = await this.db
      .select({ id: agentSessions.id })
      .from(agentSessions)
      .where(and(eq(agentSessions.grantId, grantId), isNull(agentSessions.revertedAt)))
      .orderBy(desc(agentSessions.lastActiveAt))
      .limit(1);
    return { grantId, agentName: grant.agentName, projects: names, level, sessionId: session?.id ?? null };
  }

  // ── Validation ────────────────────────────────────────────────────────

  private async validLabelIds(projectId: string, ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ id: labels.id })
      .from(labels)
      .where(and(inArray(labels.id, ids), eq(labels.projectId, projectId), isNull(labels.deletedAt)));
    if (rows.length !== new Set(ids).size) throw badRequest("Unknown label for this project");
    return rows.map((r) => r.id);
  }

  private async epicLabelIds(projectId: string, epicId: string) {
    const [epic] = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, epicId), eq(tasks.projectId, projectId), eq(tasks.type, "epic"), isNull(tasks.deletedAt)));
    if (!epic) throw badRequest("Epic not found in this project");
    const rows = await this.db
      .select({ id: taskLabels.labelId })
      .from(taskLabels)
      .innerJoin(labels, and(eq(labels.id, taskLabels.labelId), isNull(labels.deletedAt)))
      .where(eq(taskLabels.taskId, epicId));
    return rows.map((r) => r.id);
  }

  /** Returns the parsed assignee plus a display name for audit entries. */
  private async validAssignee(workspaceId: string, value: string | null | undefined) {
    const parsed = parseAssignee(value);
    if (parsed.userId) {
      const [m] = await this.db
        .select({ name: users.name })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, parsed.userId)));
      if (!m) throw badRequest("Assignee is not a member of this workspace");
      return { ...parsed, name: m.name };
    }
    if (parsed.grantId) {
      const [g] = await this.db
        .select({ name: agentGrants.agentName, userId: agentGrants.userId, revokedAt: agentGrants.revokedAt })
        .from(agentGrants)
        .where(eq(agentGrants.id, parsed.grantId));
      if (!g || g.revokedAt || !(await this.access.role(g.userId, workspaceId))) throw badRequest("Agent can't be assigned here");
      return { ...parsed, name: g.name };
    }
    return { ...parsed, name: null };
  }

  private snapshot(t: TaskRow, labelIds: string[]) {
    return {
      key: t.key,
      title: t.title,
      description: t.description,
      type: t.type,
      status: t.status,
      priority: t.priority,
      assignee: assigneeString(t),
      labelIds: [...labelIds].sort(),
      epicId: t.epicId,
      dueDate: t.dueDate,
    };
  }

  private async labelIdsOf(taskId: string, db: Db | Tx = this.db) {
    const rows = await db.select({ id: taskLabels.labelId }).from(taskLabels).where(eq(taskLabels.taskId, taskId));
    return rows.map((r) => r.id);
  }

  /** Refs come from the description and every live comment, since both can mention KEY-123 and [[Page]]. */
  private async rebuildRefs(tx: Tx, task: TaskRow, workspaceId: string) {
    const bodies = await tx
      .select({ body: comments.body })
      .from(comments)
      .where(and(eq(comments.taskId, task.id), isNull(comments.deletedAt)));
    await this.refs.rebuild(tx, { type: "task", id: task.id, workspaceId }, [task.description, ...bodies.map((b) => b.body)].join("\n"));
  }

  private async watchers(task: TaskRow, tx: Tx) {
    const ids = new Set<string>();
    if (task.createdByType === "user") ids.add(task.createdById);
    if (task.assigneeUserId) ids.add(task.assigneeUserId);
    const commenters = await tx
      .selectDistinct({ id: comments.actorId })
      .from(comments)
      .where(and(eq(comments.taskId, task.id), eq(comments.actorType, "user"), isNull(comments.deletedAt)));
    for (const c of commenters) ids.add(c.id);
    return [...ids];
  }

  // ── Writes ────────────────────────────────────────────────────────────

  async create(actor: Actor, input: Patch & { projectId: string; title: string; docIds?: string[]; clientId?: string }) {
    const project = await this.access.requireProject(actor, input.projectId, "write", "tasks");
    if (input.clientId) {
      const [taken] = await this.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, input.clientId));
      if (taken) throw conflict("A task with this id already exists");
    }
    let labelIds = await this.validLabelIds(project.id, input.labelIds ?? []);
    if (input.epicId) {
      if (input.type === "epic") throw badRequest("An epic can't belong to another epic");
      labelIds = [...new Set([...labelIds, ...(await this.epicLabelIds(project.id, input.epicId))])];
    }
    const assignee = await this.validAssignee(project.workspaceId, input.assignee);
    const docIds = [...new Set(input.docIds ?? [])];
    for (const docId of docIds) {
      const doc = await this.access.requireDoc(actor, docId, "read");
      if (doc.workspaceId !== project.workspaceId) throw badRequest("Linked page belongs to another workspace");
    }
    let sortOrder = input.sortOrder;
    if (sortOrder === undefined) {
      const [m] = await this.db.select({ v: min(tasks.sortOrder) }).from(tasks).where(eq(tasks.projectId, project.id));
      sortOrder = (m?.v ?? 1) - 1;
    }
    const status = input.status ?? "todo";

    const id = await this.dbs.db.transaction(async (tx) => {
      const [seq] = await tx
        .update(projects)
        .set({ nextNumber: sql`${projects.nextNumber} + 1` })
        .where(eq(projects.id, project.id))
        .returning({ next: projects.nextNumber });
      const number = seq!.next - 1;
      const [row] = await tx
        .insert(tasks)
        .values({
          ...(input.clientId ? { id: input.clientId } : {}),
          projectId: project.id,
          number,
          key: `${project.key}-${number}`,
          type: input.type ?? "task",
          title: input.title,
          description: input.description ?? "",
          status,
          priority: input.priority ?? "none",
          assigneeUserId: assignee.userId,
          assigneeGrantId: assignee.grantId,
          epicId: input.epicId ?? null,
          dueDate: input.dueDate ?? null,
          sortOrder,
          createdByType: actor.type,
          createdById: actorId(actor),
          completedAt: CLOSED.includes(status) ? new Date() : null,
        })
        .returning();
      const task = row!;
      if (labelIds.length) await tx.insert(taskLabels).values(labelIds.map((labelId) => ({ taskId: task.id, labelId })));
      if (docIds.length) await tx.insert(taskDocs).values(docIds.map((docId) => ({ taskId: task.id, docId })));
      await this.rebuildRefs(tx, task, project.workspaceId);
      const snap = this.snapshot(task, labelIds);
      await this.audit.revision(tx, actor, { entityType: "task", entityId: task.id, snapshot: snap, added: diffStats("", task.description).added, summary: "Created" });
      await this.audit.record(tx, actor, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        action: "task.create",
        entityType: "task",
        entityId: task.id,
        entityLabel: `${task.key} ${task.title}`,
        after: { ...snap, assigneeName: assignee.name, docIds },
      });
      if (assignee.userId) {
        await this.audit.notify(tx, actor, {
          userId: assignee.userId,
          workspaceId: project.workspaceId,
          kind: "assigned",
          entityType: "task",
          entityId: task.id,
          title: `${task.key} ${task.title}`,
          body: `${actor.name} assigned you`,
        });
      }
      return task.id;
    });
    return this.summary(id);
  }

  async update(actor: Actor, id: string, patch: Patch, opts: { summary?: string } = {}) {
    const before = await this.findTask(id);
    const project = await this.access.requireProject(actor, before.projectId, "write", "tasks");
    const beforeLabels = await this.labelIdsOf(id);

    let labelIds = patch.labelIds !== undefined ? await this.validLabelIds(project.id, patch.labelIds) : beforeLabels;
    const type = patch.type ?? before.type;
    if (patch.epicId !== undefined && patch.epicId !== null && patch.epicId !== before.epicId) {
      if (patch.epicId === id || type === "epic") throw badRequest("An epic can't belong to another epic");
      labelIds = [...new Set([...labelIds, ...(await this.epicLabelIds(project.id, patch.epicId))])];
    }
    const assigneeChanged = patch.assignee !== undefined && patch.assignee !== assigneeString(before);
    const assignee = assigneeChanged ? await this.validAssignee(project.workspaceId, patch.assignee) : null;
    const statusChanged = patch.status !== undefined && patch.status !== before.status;

    const set: Partial<typeof tasks.$inferInsert> = {};
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.type !== undefined) set.type = patch.type;
    if (patch.priority !== undefined) set.priority = patch.priority;
    if (patch.epicId !== undefined) set.epicId = patch.epicId;
    if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
    if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;
    if (statusChanged) {
      set.status = patch.status;
      set.completedAt = CLOSED.includes(patch.status!) ? new Date() : null;
    }
    if (assignee) {
      set.assigneeUserId = assignee.userId;
      set.assigneeGrantId = assignee.grantId;
    }
    const labelsChanged = [...labelIds].sort().join() !== [...beforeLabels].sort().join();

    await this.dbs.db.transaction(async (tx) => {
      const [after] = Object.keys(set).length
        ? await tx.update(tasks).set(set).where(eq(tasks.id, id)).returning()
        : await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, id)).returning();
      if (labelsChanged) {
        await tx.delete(taskLabels).where(eq(taskLabels.taskId, id));
        if (labelIds.length) await tx.insert(taskLabels).values(labelIds.map((labelId) => ({ taskId: id, labelId })));
      }
      if (patch.description !== undefined && patch.description !== before.description) await this.rebuildRefs(tx, after!, project.workspaceId);

      const a = this.snapshot(after!, labelIds);
      const b = this.snapshot(before, beforeLabels);
      const changedKeys = (Object.keys(a) as (keyof typeof a)[]).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      // Pure reorders don't deserve a revision or an audit entry; they'd drown the history.
      if (changedKeys.length === 0) return;
      // Keyed by column names so an agent-session revert can write `before` straight back.
      const pick = (snap: typeof a, row: TaskRow) =>
        Object.fromEntries(
          changedKeys.flatMap((k): [string, unknown][] =>
            k === "assignee"
              ? [
                  ["assigneeUserId", row.assigneeUserId],
                  ["assigneeGrantId", row.assigneeGrantId],
                ]
              : [[k, snap[k]]],
          ),
        );
      const stats = diffStats(before.description, after!.description);
      await this.audit.revision(tx, actor, { entityType: "task", entityId: id, snapshot: a, ...stats, summary: opts.summary ?? null });
      await this.audit.record(tx, actor, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        action: "task.update",
        entityType: "task",
        entityId: id,
        entityLabel: `${after!.key} ${after!.title}`,
        before: pick(b, before),
        after: { ...pick(a, after!), ...(assignee ? { assigneeName: assignee.name } : {}) },
      });

      const label = `${after!.key} ${after!.title}`;
      if (assignee?.userId) {
        await this.audit.notify(tx, actor, {
          userId: assignee.userId,
          workspaceId: project.workspaceId,
          kind: "assigned",
          entityType: "task",
          entityId: id,
          title: label,
          body: `${actor.name} assigned you`,
        });
      }
      if (statusChanged) {
        for (const userId of await this.watchers(after!, tx)) {
          if (userId === assignee?.userId) continue;
          await this.audit.notify(tx, actor, {
            userId,
            workspaceId: project.workspaceId,
            kind: "status",
            entityType: "task",
            entityId: id,
            title: label,
            body: `${STATUS_LABEL[before.status]} → ${STATUS_LABEL[after!.status]}`,
          });
        }
      }
    });
    return this.summary(id);
  }

  async delete(actor: Actor, id: string) {
    const task = await this.findTask(id);
    const project = await this.access.requireProject(actor, task.projectId, "delete", "tasks");
    await this.dbs.db.transaction(async (tx) => {
      await tx
        .update(tasks)
        .set({ deletedAt: new Date(), deletedByType: actor.type, deletedById: actorId(actor) })
        .where(eq(tasks.id, id));
      await this.audit.record(tx, actor, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        action: "task.delete",
        entityType: "task",
        entityId: id,
        entityLabel: `${task.key} ${task.title}`,
        before: { key: task.key, title: task.title },
      });
    });
  }

  async linkDoc(actor: Actor, taskId: string, docId: string, on: boolean) {
    const task = await this.findTask(taskId);
    const project = await this.access.requireProject(actor, task.projectId, "write", "tasks");
    const doc = await this.access.requireDoc(actor, docId, "read", { includeDeleted: !on });
    if (doc.workspaceId !== project.workspaceId) throw badRequest("Page belongs to another workspace");
    await this.dbs.db.transaction(async (tx) => {
      if (on) {
        const inserted = await tx.insert(taskDocs).values({ taskId, docId }).onConflictDoNothing().returning();
        if (inserted.length === 0) return;
      } else {
        const removed = await tx.delete(taskDocs).where(and(eq(taskDocs.taskId, taskId), eq(taskDocs.docId, docId))).returning();
        if (removed.length === 0) return;
      }
      await this.audit.record(tx, actor, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        action: on ? "task.link_doc" : "task.unlink_doc",
        entityType: "task",
        entityId: taskId,
        entityLabel: `${task.key} ${task.title}`,
        ...(on ? { after: { docId, title: doc.title } } : { before: { docId, title: doc.title } }),
      });
    });
  }

  async comment(actor: Actor, taskId: string, body: string): Promise<Comment> {
    const task = await this.findTask(taskId);
    const project = await this.access.requireProject(actor, task.projectId, "write", "comments");
    const row = await this.dbs.db.transaction(async (tx) => {
      const [c] = await tx
        .insert(comments)
        .values({ taskId, body, actorType: actor.type, actorId: actorId(actor), sessionId: actorSession(actor) })
        .returning();
      await this.rebuildRefs(tx, task, project.workspaceId);
      const label = `${task.key} ${task.title}`;
      await this.audit.record(tx, actor, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        action: "comment.create",
        entityType: "comment",
        entityId: c!.id,
        entityLabel: label,
        after: { taskId, body },
      });
      for (const userId of await this.watchers(task, tx)) {
        await this.audit.notify(tx, actor, {
          userId,
          workspaceId: project.workspaceId,
          kind: "commented",
          entityType: "task",
          entityId: taskId,
          title: label,
          body: body.slice(0, 280),
        });
      }
      return c!;
    });
    const actors = await resolveActors(this.db, [{ type: row.actorType, id: row.actorId }]);
    return {
      id: row.id,
      body: row.body,
      actor: actors.get(`${row.actorType}:${row.actorId}`)!,
      sessionId: row.sessionId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async deleteComment(actor: Actor, id: string) {
    const [c] = await this.db.select().from(comments).where(and(eq(comments.id, id), isNull(comments.deletedAt)));
    if (!c) throw notFound("Comment");
    const task = await this.findTask(c.taskId);
    const own = c.actorType === actor.type && c.actorId === actorId(actor);
    // Agents need the delete level even on their own comments; users may remove their own or, as owner, anyone's.
    const project = await this.access.requireProject(actor, task.projectId, actor.type === "agent" ? "delete" : "write", "comments");
    if (actor.type === "user" && !own && (await this.access.role(actor.userId, project.workspaceId)) !== "owner") {
      throw forbidden("Only the author or the workspace owner can delete this comment");
    }
    await this.dbs.db.transaction(async (tx) => {
      await tx
        .update(comments)
        .set({ deletedAt: new Date(), deletedByType: actor.type, deletedById: actorId(actor) })
        .where(eq(comments.id, id));
      await this.rebuildRefs(tx, task, project.workspaceId);
      await this.audit.record(tx, actor, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        action: "comment.delete",
        entityType: "comment",
        entityId: id,
        entityLabel: `${task.key} ${task.title}`,
        before: { taskId: task.id, body: c.body },
      });
    });
  }

  async draft(actor: Actor, projectId: string, sentence: string): Promise<TaskDraft> {
    const project = await this.access.requireProject(actor, projectId, "write", "tasks");
    const [epicRows, labelRows, docRows, pathOf] = await Promise.all([
      this.db
        .select({ id: tasks.id, key: tasks.key, title: tasks.title })
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), eq(tasks.type, "epic"), isNull(tasks.deletedAt), notInArray(tasks.status, CLOSED))),
      this.db.select({ id: labels.id, name: labels.name }).from(labels).where(and(eq(labels.projectId, projectId), isNull(labels.deletedAt))),
      this.db
        .select({ id: docs.id, title: docs.title })
        .from(docs)
        .where(
          and(
            eq(docs.workspaceId, project.workspaceId),
            isNull(docs.deletedAt),
            or(eq(docs.projectId, projectId), isNull(docs.projectId)),
          ),
        )
        .limit(300),
      docPaths(this.db, project.workspaceId),
    ]);

    const system = [
      `You turn one sentence into a task for the software project "${project.name}" (key ${project.key}).`,
      "Return JSON with: title (imperative, max 80 chars), description (Markdown, 1-3 short paragraphs, the why and the context),",
      "acceptanceCriteria (2-5 short checkable strings), type (task | bug | epic), priority (urgent | high | medium | low | none),",
      "epicId (one of the given epic ids or null), labelIds (subset of the given label ids), docIds (subset of the given page ids that an engineer should read first).",
      "Only use ids from the lists. Write in the language of the sentence.",
    ].join(" ");
    const user = JSON.stringify({
      sentence,
      epics: epicRows,
      labels: labelRows,
      pages: docRows.map((d) => ({ id: d.id, title: [pathOf(d.id), d.title].filter(Boolean).join(" / ") })),
    });
    const { data, model } = await this.ai.json<Partial<TaskDraft>>("taskDraft", system, user);

    const epicIds = new Set(epicRows.map((e) => e.id));
    const labelIdSet = new Set(labelRows.map((l) => l.id));
    const docIdSet = new Set(docRows.map((d) => d.id));
    const epicId = typeof data.epicId === "string" && epicIds.has(data.epicId) ? data.epicId : null;
    let labelIds = (Array.isArray(data.labelIds) ? data.labelIds : []).filter((id) => labelIdSet.has(id));
    if (epicId) labelIds = [...new Set([...labelIds, ...(await this.epicLabelIds(projectId, epicId))])];
    return {
      title: String(data.title ?? sentence).slice(0, 300),
      description: String(data.description ?? ""),
      acceptanceCriteria: Array.isArray(data.acceptanceCriteria) ? data.acceptanceCriteria.map(String).slice(0, 10) : [],
      type: TASK_TYPES.includes(data.type as TaskType) ? (data.type as TaskType) : "task",
      priority: PRIORITIES.includes(data.priority as Priority) ? (data.priority as Priority) : "none",
      epicId,
      labelIds,
      docIds: [...new Set((Array.isArray(data.docIds) ? data.docIds : []).filter((id) => docIdSet.has(id)))],
      model,
    };
  }
}

function activityVia(a: typeof auditLog.$inferSelect): string | null {
  if (a.actorType === "system") return a.actorName;
  if (a.action.startsWith("git.") || a.action === "task.git_link") {
    const provider = (a.after as { provider?: string } | null)?.provider;
    return provider === "gitlab" ? "GitLab" : "GitHub";
  }
  if (a.actorType === "agent") return a.sessionId ? `MCP · session ${a.sessionId}` : "MCP";
  if (a.actorType === "guest") return "Share link";
  return null;
}
