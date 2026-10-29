import type { Invite, InvitePreview, Member, Project, Workspace } from "@mado/contract";
import { invites, memberships, projects, tasks, users, workspaces } from "@mado/db";
import { Injectable } from "@nestjs/common";
import { and, asc, count, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { config } from "../config";
import { DbService } from "../db";
import { type Actor, actorId, initials } from "../lib/actor";
import { randomToken, sha256 } from "../lib/crypto";
import { AppError, badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { AccessService } from "./access.service";
import { AuditService } from "./audit.service";
import { AuthService } from "./auth.service";

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-") || "workspace"
  );
}

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly dbs: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  async projectsFor(workspaceIds: string[]): Promise<Project[]> {
    if (workspaceIds.length === 0) return [];
    const rows = await this.dbs.db
      .select()
      .from(projects)
      .where(and(inArray(projects.workspaceId, workspaceIds), isNull(projects.deletedAt)))
      .orderBy(asc(projects.sortOrder), asc(projects.createdAt));
    const open = await this.dbs.db
      .select({ projectId: tasks.projectId, n: count() })
      .from(tasks)
      .where(
        and(
          inArray(
            tasks.projectId,
            rows.map((r) => r.id),
          ),
          isNull(tasks.deletedAt),
          notInArray(tasks.status, ["done", "canceled"]),
        ),
      )
      .groupBy(tasks.projectId);
    const openBy = new Map(open.map((o) => [o.projectId, o.n]));
    return rows.map((p) => ({
      id: p.id,
      workspaceId: p.workspaceId,
      key: p.key,
      name: p.name,
      description: p.description,
      openTaskCount: openBy.get(p.id) ?? 0,
      nextNumber: p.nextNumber,
    }));
  }

  async list(actor: Actor): Promise<Workspace[]> {
    const account = this.access.requireAccount(actor);
    const rows = await this.dbs.db
      .select({ ws: workspaces, role: memberships.role })
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(and(eq(memberships.userId, account.userId), isNull(workspaces.deletedAt)))
      .orderBy(asc(workspaces.createdAt));
    const allProjects = await this.projectsFor(rows.map((r) => r.ws.id));
    const readable = new Set(await this.access.readableProjectIds(actor));
    return rows.map((r) => ({
      id: r.ws.id,
      name: r.ws.name,
      slug: r.ws.slug,
      role: r.role,
      projects: allProjects.filter((p) => p.workspaceId === r.ws.id && readable.has(p.id)),
    }));
  }

  async create(actor: Actor, input: { name: string; project: { name: string; key: string } }) {
    const user = this.access.requireUser(actor);
    const [taken] = await this.dbs.db.select({ id: projects.id }).from(projects).where(eq(projects.key, input.project.key));
    if (taken) throw conflict(`Key ${input.project.key} is already used`);
    let slug = slugify(input.name);
    const [slugTaken] = await this.dbs.db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug));
    if (slugTaken) slug = `${slug}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    const id = await this.dbs.db.transaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: input.name, slug }).returning();
      await tx.insert(memberships).values({ workspaceId: ws!.id, userId: user.userId, role: "owner" });
      const [project] = await tx
        .insert(projects)
        .values({ workspaceId: ws!.id, name: input.project.name, key: input.project.key })
        .returning();
      await this.audit.record(tx, actor, {
        workspaceId: ws!.id,
        action: "workspace.create",
        entityType: "workspace",
        entityId: ws!.id,
        entityLabel: ws!.name,
        after: { name: ws!.name, project: project!.key },
      });
      return ws!.id;
    });
    const list = await this.list(actor);
    return list.find((w) => w.id === id)!;
  }

  async update(actor: Actor, id: string, name: string) {
    await this.access.requireOwner(actor, id);
    await this.dbs.db.transaction(async (tx) => {
      const [before] = await tx.select().from(workspaces).where(eq(workspaces.id, id));
      await tx.update(workspaces).set({ name }).where(eq(workspaces.id, id));
      await this.audit.record(tx, actor, {
        workspaceId: id,
        action: "workspace.update",
        entityType: "workspace",
        entityId: id,
        entityLabel: name,
        before: { name: before?.name },
        after: { name },
      });
    });
    return (await this.list(actor)).find((w) => w.id === id)!;
  }

  async delete(actor: Actor, id: string, confirmName: string) {
    await this.access.requireOwner(actor, id);
    const [ws] = await this.dbs.db.select().from(workspaces).where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt)));
    if (!ws) throw notFound("Workspace");
    if (confirmName.trim() !== ws.name) throw badRequest("Type the workspace name to confirm");
    await this.dbs.db.transaction(async (tx) => {
      await tx.update(workspaces).set({ deletedAt: new Date(), deletedByType: actor.type, deletedById: actorId(actor) }).where(eq(workspaces.id, id));
      await this.audit.record(tx, actor, {
        workspaceId: id,
        action: "workspace.delete",
        entityType: "workspace",
        entityId: id,
        entityLabel: ws.name,
        before: { name: ws.name },
      });
    });
  }

  async members(actor: Actor, workspaceId: string): Promise<Member[]> {
    await this.access.requireWorkspace(actor, workspaceId);
    const rows = await this.dbs.db
      .select({ m: memberships, u: users })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.workspaceId, workspaceId))
      .orderBy(asc(memberships.createdAt));
    return rows.map(({ m, u }) => ({
      userId: u.id,
      name: u.name,
      email: u.email,
      initials: initials(u.name),
      role: m.role,
      joinedAt: m.createdAt.toISOString(),
    }));
  }

  async removeMember(actor: Actor, workspaceId: string, userId: string) {
    const owner = await this.access.requireOwner(actor, workspaceId);
    if (owner.userId === userId) throw badRequest("You can't remove yourself as owner");
    await this.dbs.db.transaction(async (tx) => {
      const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId));
      const removed = await tx
        .delete(memberships)
        .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
        .returning();
      if (removed.length === 0) throw notFound("Member");
      await this.audit.record(tx, actor, {
        workspaceId,
        action: "member.remove",
        entityType: "member",
        entityId: userId,
        entityLabel: u?.name ?? userId,
        before: { role: removed[0]!.role },
      });
    });
  }

  private inviteUrl(token: string) {
    return `${config.publicUrl}/invite/${token}`;
  }

  async invites(actor: Actor, workspaceId: string): Promise<Invite[]> {
    await this.access.requireOwner(actor, workspaceId);
    const rows = await this.dbs.db.select().from(invites).where(eq(invites.workspaceId, workspaceId)).orderBy(asc(invites.createdAt));
    return rows.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      createdAt: i.createdAt.toISOString(),
      expiresAt: i.expiresAt.toISOString(),
      acceptedAt: i.acceptedAt?.toISOString() ?? null,
      revokedAt: i.revokedAt?.toISOString() ?? null,
    }));
  }

  async createInvite(actor: Actor, input: { workspaceId: string; email?: string; role: "owner" | "member" }): Promise<Invite> {
    const user = await this.access.requireOwner(actor, input.workspaceId);
    const token = randomToken(24);
    const [row] = await this.dbs.db.transaction(async (tx) => {
      const r = await tx
        .insert(invites)
        .values({
          workspaceId: input.workspaceId,
          tokenHash: sha256(token),
          email: input.email ?? null,
          role: input.role,
          createdById: user.userId,
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
        })
        .returning();
      await this.audit.record(tx, actor, {
        workspaceId: input.workspaceId,
        action: "invite.create",
        entityType: "invite",
        entityId: r[0]!.id,
        entityLabel: input.email ?? "invite link",
      });
      return r;
    });
    return {
      id: row!.id,
      email: row!.email,
      role: row!.role,
      createdAt: row!.createdAt.toISOString(),
      expiresAt: row!.expiresAt.toISOString(),
      acceptedAt: null,
      revokedAt: null,
      url: this.inviteUrl(token),
    };
  }

  async revokeInvite(actor: Actor, id: string) {
    const [inv] = await this.dbs.db.select().from(invites).where(eq(invites.id, id));
    if (!inv) throw notFound("Invite");
    await this.access.requireOwner(actor, inv.workspaceId);
    await this.dbs.db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, id));
  }

  private async findInvite(token: string) {
    const [row] = await this.dbs.db
      .select({ inv: invites, ws: workspaces, by: users })
      .from(invites)
      .innerJoin(workspaces, eq(workspaces.id, invites.workspaceId))
      .innerJoin(users, eq(users.id, invites.createdById))
      .where(eq(invites.tokenHash, sha256(token)));
    if (!row || row.inv.revokedAt || row.inv.acceptedAt) throw notFound("Invite");
    return row;
  }

  async previewInvite(token: string): Promise<InvitePreview> {
    const { inv, ws, by } = await this.findInvite(token);
    return {
      workspaceName: ws.name,
      invitedBy: by.name,
      role: inv.role,
      email: inv.email,
      expired: inv.expiresAt < new Date(),
    };
  }

  /** Accept as the signed-in user, or create an account first. Returns the user that joined. */
  async acceptInvite(token: string, signedIn: Actor | null, account?: { name: string; email: string; password: string }) {
    const { inv } = await this.findInvite(token);
    if (inv.expiresAt < new Date()) throw badRequest("This invite has expired");
    let userId: string;
    let createdUser = false;
    if (signedIn?.type === "user") {
      userId = signedIn.userId;
    } else if (account) {
      userId = (await this.auth.createUser(account)).id;
      createdUser = true;
    } else {
      throw new AppError("UNAUTHORIZED", "Sign in or create an account to accept");
    }
    const [user] = await this.dbs.db.select().from(users).where(eq(users.id, userId));
    await this.dbs.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(memberships)
        .where(and(eq(memberships.workspaceId, inv.workspaceId), eq(memberships.userId, userId)));
      if (!existing) await tx.insert(memberships).values({ workspaceId: inv.workspaceId, userId, role: inv.role });
      await tx.update(invites).set({ acceptedAt: new Date(), acceptedById: userId }).where(eq(invites.id, inv.id));
      await this.audit.record(tx, { type: "user", userId, name: user!.name }, {
        workspaceId: inv.workspaceId,
        action: "member.join",
        entityType: "member",
        entityId: userId,
        entityLabel: user!.name,
      });
    });
    return { workspaceId: inv.workspaceId, userId, createdUser };
  }

  /** Throws when the caller isn't owner; used by guards elsewhere. */
  async assertOwner(actor: Actor, workspaceId: string) {
    const role = actor.type === "user" ? await this.access.role(actor.userId, workspaceId) : null;
    if (role !== "owner") throw forbidden();
  }
}
