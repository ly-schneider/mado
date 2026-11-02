import type { AiSettings, InstanceInfo, InstanceUser } from "@mado/contract";
import { settings, users } from "@mado/db";
import { Injectable } from "@nestjs/common";
import { asc, eq, sql } from "drizzle-orm";
import { config } from "../config";
import { DbService } from "../db";
import { type Actor, initials } from "../lib/actor";
import { badRequest, notFound } from "../lib/errors";
import { AccessService } from "./access.service";
import { AiService } from "./ai.service";

const MEMBERS_CREATE_WORKSPACES = "workspaces.membersCanCreate";

@Injectable()
export class SettingsService {
  constructor(
    private readonly dbs: DbService,
    private readonly access: AccessService,
    private readonly ai: AiService,
  ) {}

  private async flag(key: string) {
    const [row] = await this.dbs.db.select({ value: settings.value }).from(settings).where(eq(settings.key, key));
    return row?.value === true;
  }

  /** Off by default: otherwise any invited member could open their own workspace on this instance. */
  membersCanCreateWorkspaces() {
    return this.flag(MEMBERS_CREATE_WORKSPACES);
  }

  async canCreateWorkspaces(userId: string) {
    return (await this.access.isAdmin(userId)) || (await this.membersCanCreateWorkspaces());
  }

  async instance(actor: Actor): Promise<InstanceInfo> {
    this.access.requireAccount(actor);
    const [backup] = await this.dbs.db.select({ value: settings.value }).from(settings).where(eq(settings.key, "backup.last"));
    const v = backup?.value as string | { at?: string } | null | undefined;
    const lastBackupAt = typeof v === "string" ? v : (v?.at ?? null);
    const membersCanCreateWorkspaces = await this.membersCanCreateWorkspaces();
    const canCreateWorkspaces = actor.type === "user" && (membersCanCreateWorkspaces || (await this.access.isAdmin(actor.userId)));
    return { version: config.version, publicUrl: config.publicUrl, mcpUrl: `${config.publicUrl}/mcp`, lastBackupAt, membersCanCreateWorkspaces, canCreateWorkspaces };
  }

  async updateInstance(actor: Actor, input: { membersCanCreateWorkspaces: boolean }) {
    await this.access.requireAdmin(actor);
    await this.dbs.db
      .insert(settings)
      .values({ key: MEMBERS_CREATE_WORKSPACES, value: input.membersCanCreateWorkspaces })
      .onConflictDoUpdate({ target: settings.key, set: { value: input.membersCanCreateWorkspaces } });
    return this.instance(actor);
  }

  async users(actor: Actor): Promise<InstanceUser[]> {
    await this.access.requireAdmin(actor);
    const rows = await this.dbs.db.select().from(users).orderBy(asc(users.createdAt));
    return rows.map((u) => ({ id: u.id, name: u.name, email: u.email, initials: initials(u.name), isAdmin: u.isAdmin, createdAt: u.createdAt.toISOString() }));
  }

  async setAdmin(actor: Actor, userId: string, admin: boolean) {
    await this.access.requireAdmin(actor);
    await this.dbs.db.transaction(async (tx) => {
      // Serializes demotions so two admins removing each other can't leave the instance without one.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('mado.admins'))`);
      const [target] = await tx.update(users).set({ isAdmin: admin }).where(eq(users.id, userId)).returning({ id: users.id });
      if (!target) throw notFound("User");
      const [left] = await tx.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.isAdmin, true));
      if (!left?.n) throw badRequest("The instance needs at least one admin");
    });
    return this.users(actor);
  }

  async aiSettings(actor: Actor): Promise<AiSettings> {
    this.access.requireUser(actor);
    return this.ai.settings();
  }

  /** The key is instance-wide and costs money, so only instance admins may change it. */
  async updateAi(actor: Actor, input: { apiKey?: string | null; models?: Partial<AiSettings["models"]> }) {
    await this.access.requireAdmin(actor);
    return this.ai.update(input);
  }
}
