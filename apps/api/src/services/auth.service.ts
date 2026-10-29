import type { Me } from "@mado/contract";
import { sessions, users } from "@mado/db";
import { Injectable } from "@nestjs/common";
import { and, count, eq, gt } from "drizzle-orm";
import { config } from "../config";
import { DbService } from "../db";
import { type Actor, initials } from "../lib/actor";
import { hashPassword, randomToken, sha256, verifyPassword } from "../lib/crypto";
import { AppError, badRequest, conflict } from "../lib/errors";

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

@Injectable()
export class AuthService {
  constructor(private readonly dbs: DbService) {}

  async needsSetup() {
    const [row] = await this.dbs.db.select({ n: count() }).from(users);
    return (row?.n ?? 0) === 0;
  }

  async createUser(input: { name: string; email: string; password: string }) {
    const email = input.email.trim().toLowerCase();
    const [existing] = await this.dbs.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing) throw conflict("An account with this email already exists");
    const [user] = await this.dbs.db
      .insert(users)
      .values({ name: input.name.trim(), email, passwordHash: await hashPassword(input.password) })
      .returning();
    return user!;
  }

  /** First-run: the very first account becomes the instance owner. */
  async setup(input: { name: string; email: string; password: string }) {
    if (!(await this.needsSetup())) throw conflict("Setup is already done");
    return this.createUser(input);
  }

  async login(email: string, password: string) {
    const [user] = await this.dbs.db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
    // Verify against a dummy hash when the user is missing so timing doesn't reveal accounts.
    const ok = await verifyPassword(password, user?.passwordHash ?? "$argon2id$v=19$m=65536,t=2,p=1$c2FsdHNhbHQ$0000000000000000000000000000000000000000000");
    if (!user || !ok) throw new AppError("UNAUTHORIZED", "Wrong email or password");
    return user;
  }

  async createSession(userId: string, userAgent: string | null) {
    const token = randomToken(32);
    await this.dbs.db.insert(sessions).values({
      id: sha256(token),
      userId,
      userAgent,
      expiresAt: new Date(Date.now() + config.sessionDays * 86_400_000),
    });
    return token;
  }

  async destroySession(token: string) {
    await this.dbs.db.delete(sessions).where(eq(sessions.id, sha256(token)));
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

  async updateProfile(userId: string, patch: { name?: string; theme?: "system" | "dark" | "light"; accent?: "lamp" | "sora" | "ai" | "shu" }) {
    const [user] = await this.dbs.db.update(users).set(patch).where(eq(users.id, userId)).returning();
    return user!;
  }

  async changePassword(userId: string, current: string, next: string) {
    const [user] = await this.dbs.db.select().from(users).where(eq(users.id, userId));
    if (!user || !(await verifyPassword(current, user.passwordHash))) throw badRequest("Current password is wrong");
    await this.dbs.db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId));
  }

  userActor(user: UserRow): Actor {
    return { type: "user", userId: user.id, name: user.name };
  }
}
