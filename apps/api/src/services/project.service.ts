import { type Label, type LabelColor, PROJECT_KEY_RE, type Project, type Repo } from "@mado/contract";
import { labels, projects, repos, taskLabels, tasks } from "@mado/db";
import { Injectable } from "@nestjs/common";
import { and, asc, count, eq, inArray, isNull, max, notInArray } from "drizzle-orm";
import { config } from "../config";
import { DbService } from "../db";
import { type Actor, actorId } from "../lib/actor";
import { encrypt, randomToken } from "../lib/crypto";
import { badRequest, conflict, notFound } from "../lib/errors";
import { AccessService } from "./access.service";
import { AuditService } from "./audit.service";

type ProjectRow = typeof projects.$inferSelect;
type LabelRow = typeof labels.$inferSelect;
type RepoRow = typeof repos.$inferSelect;

const webhookUrl = (provider: "github" | "gitlab") => `${config.publicUrl}/webhooks/${provider}`;

function toRepo(r: RepoRow, secret?: string): Repo {
  return {
    id: r.id,
    provider: r.provider,
    fullName: r.fullName,
    webhookUrl: webhookUrl(r.provider),
    lastEventAt: r.lastEventAt?.toISOString() ?? null,
    ...(secret ? { secret } : {}),
  };
}

@Injectable()
export class ProjectService {
  constructor(
    private readonly dbs: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.dbs.db;
  }

  private async toProject(p: ProjectRow): Promise<Project> {
    const [open] = await this.db
      .select({ n: count() })
      .from(tasks)
      .where(and(eq(tasks.projectId, p.id), isNull(tasks.deletedAt), notInArray(tasks.status, ["done", "canceled"])));
    return { id: p.id, workspaceId: p.workspaceId, key: p.key, name: p.name, description: p.description, openTaskCount: open?.n ?? 0, nextNumber: p.nextNumber };
  }

  private async keyTaken(key: string) {
    const [row] = await this.db.select({ id: projects.id }).from(projects).where(eq(projects.key, key));
    return !!row;
  }

  async create(actor: Actor, input: { workspaceId: string; name: string; key: string }) {
    this.access.requireUser(actor);
    await this.access.requireWorkspace(actor, input.workspaceId);
    const key = input.key.toUpperCase();
    if (!PROJECT_KEY_RE.test(key)) throw badRequest("Keys are 2 to 5 capital letters or digits, starting with a letter");
    if (await this.keyTaken(key)) throw conflict(`Key ${key} is already used`);
    const row = await this.db.transaction(async (tx) => {
      const [last] = await tx.select({ v: max(projects.sortOrder) }).from(projects).where(eq(projects.workspaceId, input.workspaceId));
      const [p] = await tx
        .insert(projects)
        .values({ workspaceId: input.workspaceId, name: input.name, key, sortOrder: (last?.v ?? 0) + 1 })
        .returning();
      await this.audit.record(tx, actor, {
        workspaceId: input.workspaceId,
        projectId: p!.id,
        action: "project.create",
        entityType: "project",
        entityId: p!.id,
        entityLabel: `${p!.name} ${p!.key}`,
        after: { name: p!.name, key },
      });
      return p!;
    });
    return this.toProject(row);
  }

  async update(actor: Actor, input: { id: string; name?: string; description?: string }) {
    this.access.requireUser(actor);
    const before = await this.access.requireProject(actor, input.id, "write", "tasks");
    const set: Partial<typeof projects.$inferInsert> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.description !== undefined) set.description = input.description;
    if (Object.keys(set).length === 0) return this.toProject(before);
    const row = await this.db.transaction(async (tx) => {
      const [p] = await tx.update(projects).set(set).where(eq(projects.id, input.id)).returning();
      await this.audit.record(tx, actor, {
        workspaceId: before.workspaceId,
        projectId: before.id,
        action: "project.update",
        entityType: "project",
        entityId: before.id,
        entityLabel: `${p!.name} ${p!.key}`,
        before: { name: before.name, description: before.description },
        after: set,
      });
      return p!;
    });
    return this.toProject(row);
  }

  async delete(actor: Actor, id: string) {
    const project = await this.access.requireProject(actor, id, "read", "tasks");
    await this.access.requireOwner(actor, project.workspaceId);
    await this.db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({ deletedAt: new Date(), deletedByType: actor.type, deletedById: actorId(actor) })
        .where(eq(projects.id, id));
      await this.audit.record(tx, actor, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        action: "project.delete",
        entityType: "project",
        entityId: project.id,
        entityLabel: `${project.name} ${project.key}`,
      });
    });
  }

  async keyAvailable(actor: Actor, key: string) {
    this.access.requireAccount(actor);
    const k = key.toUpperCase();
    return { available: PROJECT_KEY_RE.test(k) && !(await this.keyTaken(k)) };
  }

  // ── Labels ────────────────────────────────────────────────────────────

  private async toLabels(rows: LabelRow[]): Promise<Label[]> {
    if (rows.length === 0) return [];
    const counts = await this.db
      .select({ labelId: taskLabels.labelId, n: count() })
      .from(taskLabels)
      .innerJoin(tasks, and(eq(tasks.id, taskLabels.taskId), isNull(tasks.deletedAt)))
      .where(inArray(taskLabels.labelId, rows.map((r) => r.id)))
      .groupBy(taskLabels.labelId);
    const by = new Map(counts.map((c) => [c.labelId, c.n]));
    return rows.map((l) => ({ id: l.id, projectId: l.projectId, name: l.name, color: l.color as LabelColor, taskCount: by.get(l.id) ?? 0 }));
  }

  private async findLabel(id: string) {
    const [row] = await this.db.select().from(labels).where(and(eq(labels.id, id), isNull(labels.deletedAt)));
    if (!row) throw notFound("Label");
    return row;
  }

  async labels(actor: Actor, projectId: string) {
    await this.access.requireProject(actor, projectId, "read", "tasks");
    const rows = await this.db
      .select()
      .from(labels)
      .where(and(eq(labels.projectId, projectId), isNull(labels.deletedAt)))
      .orderBy(asc(labels.name));
    return this.toLabels(rows);
  }

  async createLabel(actor: Actor, input: { projectId: string; name: string; color: LabelColor }) {
    const project = await this.access.requireProject(actor, input.projectId, "write", "tasks");
    const [dupe] = await this.db
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.projectId, project.id), eq(labels.name, input.name), isNull(labels.deletedAt)));
    if (dupe) throw conflict(`Label ${input.name} already exists`);
    const row = await this.db.transaction(async (tx) => {
      const [l] = await tx.insert(labels).values({ projectId: project.id, name: input.name, color: input.color }).returning();
      await this.audit.record(tx, actor, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        action: "label.create",
        entityType: "label",
        entityId: l!.id,
        entityLabel: l!.name,
        after: { name: l!.name, color: l!.color },
      });
      return l!;
    });
    return (await this.toLabels([row]))[0]!;
  }

  async updateLabel(actor: Actor, input: { id: string; name?: string; color?: LabelColor }) {
    const before = await this.findLabel(input.id);
    const project = await this.access.requireProject(actor, before.projectId, "write", "tasks");
    const set: Partial<typeof labels.$inferInsert> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.color !== undefined) set.color = input.color;
    if (Object.keys(set).length === 0) return (await this.toLabels([before]))[0]!;
    const row = await this.db.transaction(async (tx) => {
      const [l] = await tx.update(labels).set(set).where(eq(labels.id, input.id)).returning();
      await this.audit.record(tx, actor, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        action: "label.update",
        entityType: "label",
        entityId: l!.id,
        entityLabel: l!.name,
        before: { name: before.name, color: before.color },
        after: set,
      });
      return l!;
    });
    return (await this.toLabels([row]))[0]!;
  }

  async deleteLabel(actor: Actor, id: string) {
    const label = await this.findLabel(id);
    const project = await this.access.requireProject(actor, label.projectId, "delete", "tasks");
    await this.db.transaction(async (tx) => {
      await tx
        .update(labels)
        .set({ deletedAt: new Date(), deletedByType: actor.type, deletedById: actorId(actor) })
        .where(eq(labels.id, id));
      await this.audit.record(tx, actor, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        action: "label.delete",
        entityType: "label",
        entityId: id,
        entityLabel: label.name,
      });
    });
  }

  // ── Repos ─────────────────────────────────────────────────────────────

  async repos(actor: Actor, projectId: string) {
    this.access.requireUser(actor);
    await this.access.requireProject(actor, projectId, "read", "tasks");
    const rows = await this.db
      .select()
      .from(repos)
      .where(and(eq(repos.projectId, projectId), isNull(repos.deletedAt)))
      .orderBy(asc(repos.createdAt));
    return rows.map((r) => toRepo(r));
  }

  /** The webhook secret is shown once; afterwards only its encrypted form exists. */
  async addRepo(actor: Actor, input: { projectId: string; provider: "github" | "gitlab"; fullName: string }) {
    const project = await this.access.requireProject(actor, input.projectId, "write", "tasks");
    await this.access.requireOwner(actor, project.workspaceId);
    const fullName = input.fullName.replace(/^https?:\/\/[^/]+\//, "").replace(/\.git$/, "").replace(/\/$/, "");
    if (!/^[\w.-]+(\/[\w.-]+)+$/.test(fullName)) throw badRequest("Use owner/repo (or group/project for GitLab)");
    const [existing] = await this.db.select().from(repos).where(and(eq(repos.provider, input.provider), eq(repos.fullName, fullName)));
    if (existing && !existing.deletedAt) throw conflict(`${fullName} is already linked`);
    const secret = randomToken(32);
    const row = await this.db.transaction(async (tx) => {
      // The unique index includes removed repos, so re-adding one revives the row with a fresh secret.
      const [r] = existing
        ? await tx
            .update(repos)
            .set({ projectId: project.id, secretEnc: encrypt(secret), deletedAt: null, deletedByType: null, deletedById: null, lastEventAt: null })
            .where(eq(repos.id, existing.id))
            .returning()
        : await tx.insert(repos).values({ projectId: project.id, provider: input.provider, fullName, secretEnc: encrypt(secret) }).returning();
      await this.audit.record(tx, actor, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        action: "repo.create",
        entityType: "repo",
        entityId: r!.id,
        entityLabel: fullName,
        after: { provider: input.provider, fullName },
      });
      return r!;
    });
    return toRepo(row, secret);
  }

  async removeRepo(actor: Actor, id: string) {
    const [repo] = await this.db.select().from(repos).where(and(eq(repos.id, id), isNull(repos.deletedAt)));
    if (!repo) throw notFound("Repository");
    const project = await this.access.requireProject(actor, repo.projectId, "write", "tasks");
    await this.access.requireOwner(actor, project.workspaceId);
    await this.db.transaction(async (tx) => {
      await tx
        .update(repos)
        .set({ deletedAt: new Date(), deletedByType: actor.type, deletedById: actorId(actor) })
        .where(eq(repos.id, id));
      await this.audit.record(tx, actor, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        action: "repo.delete",
        entityType: "repo",
        entityId: id,
        entityLabel: repo.fullName,
      });
    });
  }
}
