import { authAttempts } from "@mado/db";
import { Injectable } from "@nestjs/common";
import { and, gt, inArray, isNull, lt, max, or, sql } from "drizzle-orm";
import { DbService } from "../db";
import { AppError } from "../lib/errors";

const MIN = 60;

/**
 * Up to `limit` failures, then each further failure blocks the key for `backoff` seconds, doubling up
 * to `maxBackoff`. Not a hard lockout, so a guessing attacker can't lock the owner out for long.
 * Counters reset once a key has had no failure for `window` seconds.
 */
export const POLICIES = {
  account: { limit: 10, window: 15 * MIN, backoff: MIN, maxBackoff: 15 * MIN },
  ip: { limit: 30, window: 15 * MIN, backoff: MIN, maxBackoff: 15 * MIN },
  pin: { limit: 5, window: 15 * MIN, backoff: 15 * MIN, maxBackoff: 60 * MIN },
  register: { limit: 20, window: 60 * MIN, backoff: 15 * MIN, maxBackoff: 60 * MIN },
} as const;

export type LimitKey = { kind: keyof typeof POLICIES; id: string };

export const accountKey = (email: string): LimitKey => ({ kind: "account", id: email.trim().toLowerCase() });
export const ipKeys = (ip: string | null): LimitKey[] => (ip ? [{ kind: "ip", id: ip }] : []);

const keyOf = (k: LimitKey) => `${k.kind}:${k.id}`;

export const tooManyRequests = (retryAfter: number, data: Record<string, unknown> = {}) =>
  new AppError("TOO_MANY_REQUESTS", "Too many attempts. Try again later.", { ...data, retryAfter });

@Injectable()
export class RateLimitService {
  constructor(private readonly dbs: DbService) {}

  /** Throws TOO_MANY_REQUESTS while any key is blocked. Call before checking the credential. */
  async check(keys: LimitKey[], data?: Record<string, unknown>) {
    if (keys.length === 0) return;
    const [row] = await this.dbs.db
      .select({ until: max(authAttempts.blockedUntil) })
      .from(authAttempts)
      .where(and(inArray(authAttempts.key, keys.map(keyOf)), gt(authAttempts.blockedUntil, sql`now()`)));
    if (row?.until) throw tooManyRequests(Math.max(1, Math.ceil((new Date(row.until).getTime() - Date.now()) / 1000)), data);
  }

  /** Records a failure on each key and returns the failure counts in the same order. */
  async fail(keys: LimitKey[]): Promise<number[]> {
    const counts: number[] = [];
    for (const k of keys) {
      const p = POLICIES[k.kind];
      const failures = sql`(case when ${authAttempts.lastFailureAt} < now() - make_interval(secs => ${p.window}) then 1 else ${authAttempts.failures} + 1 end)`;
      // The exponent is capped so power() can't overflow on a long-running attack.
      const blockedUntil = sql`(case when ${failures} >= ${p.limit} then now() + make_interval(secs => least(${p.backoff} * power(2, least(${failures} - ${p.limit}, 16)), ${p.maxBackoff})) end)`;
      const [row] = await this.dbs.db
        .insert(authAttempts)
        .values({ key: keyOf(k), failures: 1, lastFailureAt: sql`now()` })
        .onConflictDoUpdate({ target: authAttempts.key, set: { failures, lastFailureAt: sql`now()`, blockedUntil } })
        .returning({ failures: authAttempts.failures });
      counts.push(row!.failures);
    }
    return counts;
  }

  async clear(keys: LimitKey[]) {
    if (keys.length === 0) return;
    await this.dbs.db.delete(authAttempts).where(inArray(authAttempts.key, keys.map(keyOf)));
  }

  /** Counts a request that isn't a failure as such (e.g. a client registration) and blocks over the limit. */
  async hit(key: LimitKey) {
    await this.check([key]);
    await this.fail([key]);
  }

  async prune() {
    const rows = await this.dbs.db
      .delete(authAttempts)
      .where(
        and(
          lt(authAttempts.lastFailureAt, sql`now() - interval '1 day'`),
          or(isNull(authAttempts.blockedUntil), lt(authAttempts.blockedUntil, sql`now()`)),
        ),
      )
      .returning({ key: authAttempts.key });
    return rows.length;
  }
}
