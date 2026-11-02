import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { memberships, users, workspaces } from "@mado/db";
import { DbService } from "../db";
import type { Actor, LoadedGrant } from "../lib/actor";
import { AccessService } from "./access.service";
import { AiService } from "./ai.service";
import { AuditService } from "./audit.service";
import { AuthService } from "./auth.service";
import { RateLimitService } from "./rate-limit.service";
import { SettingsService } from "./settings.service";
import { WorkspaceService } from "./workspace.service";

// Runs against the dev database. The members-create setting is shared, so it's restored afterwards.
const dbs = new DbService();
const access = new AccessService(dbs);
const ai = new AiService(dbs);
const limits = new RateLimitService(dbs);
const settings = new SettingsService(dbs, access, ai);
const workspace = new WorkspaceService(dbs, access, new AuditService(), new AuthService(dbs, limits), limits, settings);

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const newKey = () => `Q${Math.floor(Math.random() * 9000 + 1000)}`;
let admin: Actor;
let member: Actor;
let memberId: string;
let membersCouldCreate: boolean;

beforeAll(async () => {
  const [a] = await dbs.db.insert(users).values({ email: `admin-${stamp}@test.ch`, name: "Admin", passwordHash: "x", isAdmin: true }).returning();
  const [m] = await dbs.db.insert(users).values({ email: `member-${stamp}@test.ch`, name: "Member", passwordHash: "x" }).returning();
  admin = { type: "user", userId: a!.id, name: "Admin" };
  member = { type: "user", userId: m!.id, name: "Member" };
  memberId = m!.id;
  // Owning some workspace used to be enough to change instance settings.
  const [ws] = await dbs.db.insert(workspaces).values({ name: "Owned", slug: `owned-${stamp}` }).returning();
  await dbs.db.insert(memberships).values({ workspaceId: ws!.id, userId: m!.id, role: "owner" });
  membersCouldCreate = await settings.membersCanCreateWorkspaces();
  await settings.updateInstance(admin, { membersCanCreateWorkspaces: false });
});

afterAll(async () => {
  await settings.updateInstance(admin, { membersCanCreateWorkspaces: membersCouldCreate });
});

describe("instance admin", () => {
  test("a workspace owner who isn't an admin can't change the AI settings", async () => {
    await expect(settings.updateAi(member, { apiKey: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const models = (await ai.settings()).models;
    expect((await settings.updateAi(admin, { models })).models).toEqual(models);
  });

  test("only admins create workspaces unless the setting allows members", async () => {
    const input = () => ({ name: `Created ${stamp}`, project: { name: "P", key: newKey() } });
    await expect(workspace.create(member, input())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await settings.instance(member)).canCreateWorkspaces).toBe(false);
    expect((await workspace.create(admin, input())).role).toBe("owner");

    await expect(settings.updateInstance(member, { membersCanCreateWorkspaces: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await settings.updateInstance(admin, { membersCanCreateWorkspaces: true });
    expect((await settings.instance(member)).canCreateWorkspaces).toBe(true);
    expect((await workspace.create(member, input())).role).toBe("owner");
    await settings.updateInstance(admin, { membersCanCreateWorkspaces: false });
  });

  test("admins grant and revoke admin, members can't", async () => {
    await expect(settings.setAdmin(member, memberId, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(settings.users(member)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const after = await settings.setAdmin(admin, memberId, true);
    expect(after.find((u) => u.id === memberId)?.isAdmin).toBe(true);
    await settings.updateAi(member, { models: (await ai.settings()).models });
    await settings.setAdmin(admin, memberId, false);
    await expect(settings.updateAi(member, { apiKey: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("an agent acting for an admin is not an admin", async () => {
    const grant = { id: "g_test", userId: admin.type === "user" ? admin.userId : "", agentName: "Test", projectScope: "all", allLevel: "delete", projects: new Map(), resourceTypes: [] } as LoadedGrant;
    const agent: Actor = { type: "agent", userId: grant.userId, grant, name: "Test", sessionId: null };
    await expect(settings.updateAi(agent, { apiKey: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
