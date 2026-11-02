import type { Me, UserSession } from "@mado/contract";
import { sessions, users } from "@mado/db";
import { type Db, type Tx } from "@mado/db";
import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, gt, sql } from "drizzle-orm";
import { config } from "../config";
import { DbService } from "../db";
import { type Actor, initials } from "../lib/actor";
import { hashPassword, randomToken, sha256, verifyPassword } from "../lib/crypto";
import { AppError, badRequest, conflict, forbidden } from "../lib/errors";
import { accountKey, ipKeys, RateLimitService } from "./rate-limit.service";

export const SESSION_COOKIE = "mado_session";
/**
 * The desktop app runs on tauri://localhost and WebKit blocks its cross-site cookies, so it carries
 * the session in this header instead. Web and PWA keep the HttpOnly cookie.
 */
export const SESSION_HEADER = "x-mado-session";

export function sessionToken(req: { cookies?: Record<string, string>; headers: Record<string, string | string[] | undefined> }) {
  const header = req.headers[SESSION_HEADER];
  return (typeof header === "string" && header) || req.cookies?.[SESSION_COOKIE] || undefined;
}

type UserRow = typeof users.$inferSelect;

export function toMe(u: UserRow): Me {
  return { id: u.id, email: u.email, name: u.name, initials: initials(u.name), theme: u.theme, accent: u.accent };
}

function sameSecret(a: string, b: string) {
  // Compare digests so the length of the expected token doesn't leak through timing either.
  return timingSafeEqual(Buffer.from(sha256(a), "hex"), Buffer.from(sha256(b), "hex"));
}

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly log = new Logger("Auth");
  /**
   * Required by auth.setup while no user exists, so a stranger who finds a fresh instance first
   * can't claim it. Kept in memory: a restart before setup prints a new one.
   */
  private setupToken: string | null = config.setupToken;

  constructor(
    private readonly dbs: DbService,
    private readonly limits: RateLimitService,
  ) {}

  async onApplicationBootstrap() {
    if (!(await this.needsSetup())) return;
    if (config.setupToken) {
      this.log.log(`Setup: ${config.publicUrl}/setup (token from MADO_SETUP_TOKEN)`);
    } else {
      this.log.log(`Setup: ${config.publicUrl}/setup?token=${this.currentSetupToken()}`);
    }
  }

  currentSetupToken() {
    this.setupToken ??= randomToken(24);
    return this.setupToken;
  }

  async needsSetup() {
    const [row] = await this.dbs.db.select({ n: count() }).from(users);
    return (row?.n ?? 0) === 0;
  }

  async createUser(input: { name: string; email: string; password: string }, db: Db | Tx = this.dbs.db) {
    const email = input.email.trim().toLowerCase();
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing) throw conflict("An account with this email already exists");
    const [user] = await db
      .insert(users)
      .values({ name: input.name.trim(), email, passwordHash: await hashPassword(input.password) })
      .returning();
    return user!;
  }

  /** First-run: the very first account becomes the instance owner. */
  async setup(input: { name: string; email: string; password: string; token?: string }, ip: string | null = null) {
    await this.limits.check(ipKeys(ip));
    if (!input.token || !this.setupToken || !sameSecret(input.token, this.setupToken)) {
      await this.limits.fail(ipKeys(ip));
      throw forbidden("Invalid setup token");
    }
    const user = await this.dbs.db.transaction(async (tx) => {
      // Serializes concurrent setups so the empty-table check and the insert can't interleave.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('mado.setup'))`);
      const [row] = await tx.select({ n: count() }).from(users);
      if ((row?.n ?? 0) > 0) throw conflict("Setup is already done");
      return this.createUser(input, tx);
    });
    this.setupToken = null;
    return user;
  }

  async login(email: string, password: string, ip: string | null = null) {
    const keys = [accountKey(email), ...ipKeys(ip)];
    // Checked before the hash so a blocked guess costs nothing and reveals nothing.
    await this.limits.check(keys);
    const [user] = await this.dbs.db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
    // Verify against a dummy hash when the user is missing so timing doesn't reveal accounts.
    const ok = await verifyPassword(password, user?.passwordHash ?? "$argon2id$v=19$m=65536,t=2,p=1$c2FsdHNhbHQ$0000000000000000000000000000000000000000000");
    if (!user || !ok) {
      await this.limits.fail(keys);
      throw new AppError("UNAUTHORIZED", "Wrong email or password");
    }
    await this.limits.clear([accountKey(email)]);
    return user;
  }

  async createSession(userId: string, client: { userAgent: string | null; ip: string | null }) {
    const token = randomToken(32);
    await this.dbs.db.insert(sessions).values({
      id: sha256(token),
      userId,
      userAgent: client.userAgent,
      ip: client.ip,
      expiresAt: new Date(Date.now() + config.sessionDays * 86_400_000),
    });
    return token;
  }

  async destroySession(token: string) {
    await this.dbs.db.delete(sessions).where(eq(sessions.id, sha256(token)));
  }

  async listSessions(userId: string, currentToken: string | undefined): Promise<UserSession[]> {
    const current = currentToken ? sha256(currentToken) : null;
    const rows = await this.dbs.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.createdAt));
    return rows.map((r) => ({
      id: r.id,
      userAgent: r.userAgent,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
      current: r.id === current,
    }));
  }

  async revokeSession(userId: string, id: string) {
    await this.dbs.db.delete(sessions).where(and(eq(sessions.userId, userId), eq(sessions.id, id)));
  }

  async userFromSession(token: string | undefined): Promise<UserRow | null> {
    if (!token) return null;
    const [row] = await this.dbs.db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())));
    return row?.user ?? null;
  }

  async updateProfile(userId: string, patch: { name?: string; theme?: "system" | "dark" | "light"; accent?: string }) {
    const [user] = await this.dbs.db.update(users).set(patch).where(eq(users.id, userId)).returning();
    return user!;
  }

  async changePassword(userId: string, current: string, next: string, ip: string | null = null) {
    const [user] = await this.dbs.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw badRequest("Current password is wrong");
    const keys = [accountKey(user.email), ...ipKeys(ip)];
    await this.limits.check(keys);
    if (!(await verifyPassword(current, user.passwordHash))) {
      await this.limits.fail(keys);
      throw badRequest("Current password is wrong");
    }
    await this.limits.clear([accountKey(user.email)]);
    await this.dbs.db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId));
  }

  userActor(user: UserRow): Actor {
    return { type: "user", userId: user.id, name: user.name };
  }
}
