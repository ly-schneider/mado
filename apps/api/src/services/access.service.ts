import { type GrantLevel, levelAllows, type ResourceType } from "@mado/contract";
import { docs, memberships, projects } from "@mado/db";
import { Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { DbService } from "../db";
import type { Actor } from "../lib/actor";
import { AppError, forbidden, insufficientScope, notFound } from "../lib/errors";

type ProjectRow = typeof projects.$inferSelect;
type DocRow = typeof docs.$inferSelect;

/**
 * All authorization lives here. Users are bounded by workspace membership; agents are bounded by
 * the granting user's membership AND their grant, which is re-read on every call.
 */
@Injectable()
export class AccessService {
  constructor(private readonly dbs: DbService) {}

  requireUser(actor: Actor): Extract<Actor, { type: "user" }> {
    if (actor.type !== "user") throw forbidden("Only a signed-in user can do this");
    return actor;
  }

  /** Users and agents (acting for a user). Guests are rejected. */
  requireAccount(actor: Actor): Extract<Actor, { type: "user" | "agent" }> {
    if (actor.type !== "user" && actor.type !== "agent") throw new AppError("UNAUTHORIZED", "Sign in required");
    return actor;
  }

  async role(userId: string, workspaceId: string) {
    const [m] = await this.dbs.db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)));
    return m?.role ?? null;
  }

  async requireWorkspace(actor: Actor, workspaceId: string) {
    if (actor.type === "guest") {
      if (actor.workspaceId !== workspaceId) throw forbidden();
      return null;
    }
    const account = this.requireAccount(actor);
    const role = await this.role(account.userId, workspaceId);
    if (!role) throw notFound("Workspace");
    return role;
  }

  async requireOwner(actor: Actor, workspaceId: string) {
    const user = this.requireUser(actor);
    const role = await this.role(user.userId, workspaceId);
    if (role !== "owner") throw forbidden("Only the workspace owner can do this");
    return user;
  }

  /** Effective agent level for a project, or null if the grant doesn't cover it. */
  grantLevel(actor: Extract<Actor, { type: "agent" }>, projectId: string): GrantLevel | null {
    if (actor.grant.projectScope === "all") return actor.grant.allLevel;
    return actor.grant.projects.get(projectId) ?? null;
  }

  async requireProject(
    actor: Actor,
    projectId: string,
    level: GrantLevel,
    resource: ResourceType,
    opts: { includeDeleted?: boolean } = {},
  ): Promise<ProjectRow> {
    const [project] = await this.dbs.db.select().from(projects).where(eq(projects.id, projectId));
    if (!project || (project.deletedAt && !opts.includeDeleted)) throw notFound("Project");
    if (actor.type === "guest") throw forbidden();
    if (actor.type === "system") return project;
    const role = await this.role(actor.userId, project.workspaceId);
    if (!role) throw notFound("Project");
    if (actor.type === "agent") {
      const have = this.grantLevel(actor, projectId);
      if (!have || !levelAllows(have, level) || !actor.grant.resourceTypes.includes(resource)) {
        throw insufficientScope({ project: project.key, level, resource });
      }
    }
    return project;
  }

  async requireProjectByKey(actor: Actor, key: string, level: GrantLevel, resource: ResourceType) {
    const [project] = await this.dbs.db.select({ id: projects.id }).from(projects).where(eq(projects.key, key.toUpperCase()));
    if (!project) throw notFound("Project");
    return this.requireProject(actor, project.id, level, resource);
  }

  /** Project IDs this actor can read in a workspace (or across all workspaces). */
  async readableProjectIds(actor: Actor, workspaceId?: string, resource: ResourceType = "tasks"): Promise<string[]> {
    if (actor.type === "guest" || actor.type === "system") return [];
    const rows = await this.dbs.db
      .select({ id: projects.id })
      .from(projects)
      .innerJoin(memberships, and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, actor.userId)))
      .where(and(isNull(projects.deletedAt), workspaceId ? eq(projects.workspaceId, workspaceId) : undefined));
    const ids = rows.map((r) => r.id);
    if (actor.type === "user") return ids;
    if (!actor.grant.resourceTypes.includes(resource)) return [];
    return ids.filter((id) => this.grantLevel(actor, id) !== null);
  }

  /** Workspace IDs the actor belongs to. */
  async workspaceIds(actor: Actor): Promise<string[]> {
    if (actor.type === "guest") return [actor.workspaceId];
    if (actor.type === "system") return [];
    const rows = await this.dbs.db
      .select({ id: memberships.workspaceId })
      .from(memberships)
      .where(eq(memberships.userId, actor.userId));
    return rows.map((r) => r.id);
  }

  /**
   * Docs belong to a project (checked against the grant) or to the workspace. Workspace-level
   * pages are only visible to agents whose grant covers all projects.
   * Guests may only touch the subtree under their share link.
   */
  async requireDoc(actor: Actor, docId: string, level: GrantLevel, opts: { includeDeleted?: boolean } = {}): Promise<DocRow> {
    const [doc] = await this.dbs.db.select().from(docs).where(eq(docs.id, docId));
    if (!doc || (doc.deletedAt && !opts.includeDeleted)) throw notFound("Page");
    if (actor.type === "guest") {
      if (doc.workspaceId !== actor.workspaceId || !(await this.isInSubtree(docId, actor.rootDocId))) throw notFound("Page");
      if (level !== "read" && !actor.canEdit) throw forbidden("This link is view only");
      return doc;
    }
    if (doc.projectId) {
      await this.requireProject(actor, doc.projectId, level, "docs", opts);
      return doc;
    }
    await this.requireWorkspace(actor, doc.workspaceId);
    if (actor.type === "agent") {
      if (actor.grant.projectScope !== "all" || !levelAllows(actor.grant.allLevel, level) || !actor.grant.resourceTypes.includes("docs")) {
        throw insufficientScope({ project: "workspace pages", level, resource: "docs" });
      }
    }
    return doc;
  }

  async isInSubtree(docId: string, rootId: string): Promise<boolean> {
    let current: string | null = docId;
    for (let depth = 0; current && depth < 64; depth++) {
      if (current === rootId) return true;
      const [row] = await this.dbs.db.select({ parentId: docs.parentId }).from(docs).where(eq(docs.id, current));
      current = row?.parentId ?? null;
    }
    return false;
  }

  async subtreeIds(rootId: string): Promise<string[]> {
    const ids = [rootId];
    let frontier = [rootId];
    while (frontier.length) {
      const rows = await this.dbs.db
        .select({ id: docs.id })
        .from(docs)
        .where(and(inArray(docs.parentId, frontier), isNull(docs.deletedAt)));
      frontier = rows.map((r) => r.id);
      ids.push(...frontier);
    }
    return ids;
  }
}
