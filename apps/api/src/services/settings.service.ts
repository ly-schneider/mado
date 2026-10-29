import type { AiSettings, InstanceInfo } from "@mado/contract";
import { memberships, settings } from "@mado/db";
import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { config } from "../config";
import { DbService } from "../db";
import type { Actor } from "../lib/actor";
import { forbidden } from "../lib/errors";
import { AccessService } from "./access.service";
import { AiService } from "./ai.service";

@Injectable()
export class SettingsService {
  constructor(
    private readonly dbs: DbService,
    private readonly access: AccessService,
    private readonly ai: AiService,
  ) {}

  async instance(actor: Actor): Promise<InstanceInfo> {
    this.access.requireAccount(actor);
    const [backup] = await this.dbs.db.select({ value: settings.value }).from(settings).where(eq(settings.key, "backup.last"));
    const v = backup?.value as string | { at?: string } | null | undefined;
    const lastBackupAt = typeof v === "string" ? v : (v?.at ?? null);
    return { version: config.version, publicUrl: config.publicUrl, mcpUrl: `${config.publicUrl}/mcp`, lastBackupAt };
  }

  async aiSettings(actor: Actor): Promise<AiSettings> {
    this.access.requireUser(actor);
    return this.ai.settings();
  }

  /** The key is instance-wide and costs money, so only owners of a workspace may change it. */
  async updateAi(actor: Actor, input: { apiKey?: string | null; models?: Partial<AiSettings["models"]> }) {
    const user = this.access.requireUser(actor);
    const [owner] = await this.dbs.db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, user.userId), eq(memberships.role, "owner")))
      .limit(1);
    if (!owner) throw forbidden("Only a workspace owner can change AI settings");
    return this.ai.update(input);
  }
}
