import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@mado/db";
import type { DbService } from "../db";
import { AuthService } from "./auth.service";
import { RateLimitService } from "./rate-limit.service";

// Setup only works on an empty users table, which the shared dev database never has. Run it in a
// scratch schema holding a copy of the table; unqualified table names resolve there via search_path.
const ownerUrl = process.env.DATABASE_OWNER_URL ?? "postgres://mado_owner:mado@localhost:5442/mado";
const scratch = `setup_test_${Date.now()}`;
const admin = createDb(ownerUrl, { max: 1 }).client;
// postgres.js passes unknown URL parameters on as connection settings.
const { db, client } = createDb(`${ownerUrl}?search_path=${scratch}`, { max: 4 });
const dbs = { db } as DbService;

const account = (n: number) => ({ name: `Setup ${n}`, email: `setup-${n}@test.ch`, password: "correct horse battery" });

beforeAll(async () => {
  await admin.unsafe(`create schema ${scratch}; create table ${scratch}.users (like public.users including all)`);
});

afterAll(async () => {
  await client.end();
  await admin.unsafe(`drop schema ${scratch} cascade`);
  await admin.end();
});

describe("first-run setup", () => {
  test("refuses a missing or wrong token while no user exists", async () => {
    const auth = new AuthService(dbs, new RateLimitService(dbs));
    auth.currentSetupToken();
    expect(await auth.needsSetup()).toBe(true);
    await expect(auth.setup(account(0))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(auth.setup({ ...account(0), token: "nope" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await auth.needsSetup()).toBe(true);
  });

  test("exactly one of two concurrent setups succeeds, and the token is spent", async () => {
    const auth = new AuthService(dbs, new RateLimitService(dbs));
    const token = auth.currentSetupToken();
    const results = await Promise.allSettled([auth.setup({ ...account(1), token }), auth.setup({ ...account(2), token })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    const [row] = await client<{ n: number }[]>`select count(*)::int as n from users`;
    expect(row?.n).toBe(1);
    await expect(auth.setup({ ...account(3), token })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
