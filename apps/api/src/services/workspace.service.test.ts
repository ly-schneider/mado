import "reflect-metadata";
import { beforeAll, describe, expect, test } from "bun:test";
import { memberships, users, workspaces } from "@mado/db";
import { eq, inArray } from "drizzle-orm";
import { DbService } from "../db";
import type { Actor } from "../lib/actor";
import { AccessService } from "./access.service";
import { AiService } from "./ai.service";
import { AuditService } from "./audit.service";
import { AuthService } from "./auth.service";
import { RateLimitService } from "./rate-limit.service";
import { SettingsService } from "./settings.service";
import { WorkspaceService } from "./workspace.service";

// Runs against the dev database. Each run creates its own workspace and accounts.
const dbs = new DbService();
const access = new AccessService(dbs);
const limits = new RateLimitService(dbs);
const workspace = new WorkspaceService(dbs, access, new AuditService(), new AuthService(dbs, limits), limits, new SettingsService(dbs, access, new AiService(dbs)));

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const password = "correct horse battery";
let owner: Actor;
let workspaceId: string;

async function userActor(label: string): Promise<Actor> {
  const [u] = await dbs.db.insert(users).values({ email: `${label}-${stamp}@test.ch`, name: label, passwordHash: "x" }).returning();
  return { type: "user", userId: u!.id, name: label };
}

const tokenOf = (url: string | undefined) => url!.split("/invite/")[1]!;

beforeAll(async () => {
  owner = await userActor("owner");
  const [ws] = await dbs.db.insert(workspaces).values({ name: "Invite tests", slug: `invite-tests-${stamp}` }).returning();
  workspaceId = ws!.id;
  await dbs.db.insert(memberships).values({ workspaceId, userId: owner.type === "user" ? owner.userId : "", role: "owner" });
});

describe("email invites", () => {
  test("only the invited address can accept, signed in or signing up", async () => {
    const email = `alice-${stamp}@test.ch`;
    const inv = await workspace.createInvite(owner, { workspaceId, email, role: "owner" });
    const token = tokenOf(inv.url);

    const mallory = await userActor("mallory");
    await expect(workspace.acceptInvite(token, mallory)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(workspace.acceptInvite(token, null, { name: "Mallory", email: `mallory2-${stamp}@test.ch`, password })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const [made] = await dbs.db.select().from(users).where(eq(users.email, `mallory2-${stamp}@test.ch`));
    expect(made).toBeUndefined();

    const joined = await workspace.acceptInvite(token, null, { name: "Alice", email: email.toUpperCase(), password });
    expect(joined.createdUser).toBe(true);
    expect(await access.role(joined.userId, workspaceId)).toBe("owner");
  });
});

describe("single use", () => {
  test("signed-in users accepting one link at once produce one membership", async () => {
    const inv = await workspace.createInvite(owner, { workspaceId, role: "member" });
    const token = tokenOf(inv.url);
    const racers = await Promise.all([1, 2, 3, 4, 5].map((n) => userActor(`racer-${n}`)));
    const results = await Promise.allSettled(racers.map((r) => workspace.acceptInvite(token, r)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const ids = racers.map((x) => (x.type === "user" ? x.userId : ""));
    const rows = await dbs.db.select().from(memberships).where(inArray(memberships.userId, ids));
    expect(rows).toHaveLength(1);
  });

  test("two sign-ups racing on one link create one account", async () => {
    const inv = await workspace.createInvite(owner, { workspaceId, role: "member" });
    const token = tokenOf(inv.url);
    const emails = [`signup-a-${stamp}@test.ch`, `signup-b-${stamp}@test.ch`];
    const results = await Promise.allSettled(emails.map((email) => workspace.acceptInvite(token, null, { name: "Racer", email, password })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const made = await dbs.db.select().from(users).where(inArray(users.email, emails));
    expect(made).toHaveLength(1);
  });
});
