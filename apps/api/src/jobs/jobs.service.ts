import { agentTokens, oauthCodes, sessions } from "@mado/db";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { and, isNotNull, lt, or } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { config } from "../config";
import { DbService } from "../db";
import { TrashService } from "../services/trash.service";

const DAY = 24 * 60 * 60 * 1000;
const TZ = "Europe/Zurich";

const JOBS = {
  purgeTrash: { name: "trash-purge", cron: "0 3 * * *" },
  cleanup: { name: "auth-cleanup", cron: "20 * * * *" },
} as const;

/**
 * Scheduled maintenance on pg-boss (Postgres only, no Redis). The API must boot without it:
 * any failure here is logged and the app runs on, it just skips the nightly work.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Jobs");
  private boss: PgBoss | null = null;

  constructor(
    private readonly dbs: DbService,
    private readonly trash: TrashService,
  ) {}

  async onModuleInit() {
    if (process.env.JOBS === "off") return;
    // Not awaited: pg-boss creates its schema on first start, which must not delay listening.
    this.start().catch((e) => {
      this.log.warn(`pg-boss disabled: ${(e as Error).message}`);
      this.boss = null;
    });
  }

  async onModuleDestroy() {
    await this.boss?.stop({ graceful: true, timeout: 5000 }).catch(() => {});
  }

  private async start() {
    const { PgBoss } = await import("pg-boss");
    const boss = new PgBoss({ connectionString: config.databaseUrl, schema: "pgboss", max: 3 });
    boss.on("error", (e) => this.log.warn(`pg-boss: ${e.message}`));
    await boss.start();
    this.boss = boss;

    await this.register(JOBS.purgeTrash, () => this.purgeTrash());
    await this.register(JOBS.cleanup, () => this.cleanup());
    this.log.log("pg-boss started");
  }

  private async register(job: { name: string; cron: string }, run: () => Promise<void>) {
    const boss = this.boss!;
    await boss.createQueue(job.name);
    await boss.schedule(job.name, job.cron, null, { tz: TZ });
    await boss.work(job.name, async () => {
      await run();
    });
  }

  async purgeTrash() {
    // TrashService is owned by another stream; tolerate it not having the method yet.
    const purge = (this.trash as { purgeExpired?: () => Promise<unknown> }).purgeExpired;
    if (typeof purge !== "function") {
      this.log.warn("TrashService.purgeExpired is not implemented; skipping trash purge");
      return;
    }
    const result = await purge.call(this.trash);
    this.log.log(`trash purge done ${result === undefined ? "" : JSON.stringify(result)}`);
  }

  async cleanup() {
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * DAY);
    const db = this.dbs.db;
    const expiredSessions = await db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.id });
    const staleCodes = await db
      .delete(oauthCodes)
      .where(lt(oauthCodes.expiresAt, now))
      .returning({ hash: oauthCodes.codeHash });
    // The app role has no DELETE on agent_tokens, so dead tokens go through the purge role.
    const deadTokens = await this.dbs.purgeDb
      .delete(agentTokens)
      .where(or(and(isNotNull(agentTokens.revokedAt), lt(agentTokens.revokedAt, monthAgo)), lt(agentTokens.expiresAt, monthAgo)))
      .returning({ id: agentTokens.id });
    this.log.log(
      `cleanup: ${expiredSessions.length} sessions, ${staleCodes.length} oauth codes, ${deadTokens.length} tokens`,
    );
  }
}
