import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { authAttempts, users } from "@mado/db";
import { eq, like, or } from "drizzle-orm";
import { DbService } from "../db";
import { hashPassword } from "../lib/crypto";
import { AuthService } from "./auth.service";
import { POLICIES, RateLimitService } from "./rate-limit.service";

// Runs against the dev database. Keys are unique per run and removed afterwards.
const dbs = new DbService();
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const email = `limit-${stamp}@test.ch`;
const password = "correct horse battery";
const octet = () => Math.floor(Math.random() * 250) + 1;
const ipA = `198.18.${octet()}.${octet()}`;
const ipB = `198.19.${octet()}.${octet()}`;

const auth = () => new AuthService(dbs, new RateLimitService(dbs));

beforeAll(async () => {
  await dbs.db.insert(users).values({ email, name: "Limit Test", passwordHash: await hashPassword(password) });
});

afterAll(async () => {
  await dbs.db
    .delete(authAttempts)
    .where(or(eq(authAttempts.key, `account:${email}`), like(authAttempts.key, `account:spray-${stamp}-%`), eq(authAttempts.key, `ip:${ipA}`), eq(authAttempts.key, `ip:${ipB}`)));
});

describe("login rate limit", () => {
  test("blocks an account after 10 failures, before verifying, until the backoff passes", async () => {
    // A fresh IP for every attempt, as from a botnet: only the account limit applies.
    for (let i = 0; i < POLICIES.account.limit; i++) {
      await expect(auth().login(email, "wrong password", `198.51.${i}.${octet()}`)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    const blocked = auth().login(email, password, ipB);
    await expect(blocked).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await expect(blocked).rejects.toMatchObject({ data: { retryAfter: expect.any(Number) } });

    // A new service instance reads the same row, as after a restart.
    await expect(auth().login(email, password, ipB)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });

    await dbs.db.update(authAttempts).set({ blockedUntil: new Date(Date.now() - 1000) }).where(eq(authAttempts.key, `account:${email}`));
    expect((await auth().login(email, password, ipB)).email).toBe(email);
    const [row] = await dbs.db.select().from(authAttempts).where(eq(authAttempts.key, `account:${email}`));
    expect(row).toBeUndefined();
  });

  test("throttles one IP guessing across many accounts", async () => {
    for (let i = 0; i < POLICIES.ip.limit; i++) {
      await expect(auth().login(`spray-${stamp}-${i}@test.ch`, "wrong password", ipA)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    await expect(auth().login(email, password, ipA)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  }, 30_000);

  test("backoff doubles with each further failure", async () => {
    const limits = new RateLimitService(dbs);
    const key = { kind: "account" as const, id: `spray-${stamp}-backoff` };
    for (let i = 0; i < POLICIES.account.limit; i++) await limits.fail([key]);
    const first = await dbs.db.select().from(authAttempts).where(eq(authAttempts.key, `account:${key.id}`));
    await limits.fail([key]);
    const second = await dbs.db.select().from(authAttempts).where(eq(authAttempts.key, `account:${key.id}`));
    const span = (r: typeof first) => r[0]!.blockedUntil!.getTime() - r[0]!.lastFailureAt.getTime();
    expect(Math.round(span(first) / 1000)).toBe(POLICIES.account.backoff);
    expect(Math.round(span(second) / 1000)).toBe(POLICIES.account.backoff * 2);
  });
});
