import type { AiSettings } from "@mado/contract";
import { settings } from "@mado/db";
import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DbService } from "../db";
import { decrypt, encrypt } from "../lib/crypto";
import { AppError } from "../lib/errors";

type Feature = keyof AiSettings["models"];

const DEFAULT_MODELS: AiSettings["models"] = {
  taskDraft: "anthropic/claude-sonnet-5",
  docSummary: "anthropic/claude-haiku-4.5",
  leadAnalysis: "anthropic/claude-sonnet-5",
  emailDraft: "anthropic/claude-sonnet-5",
};

/**
 * Built-in AI through OpenRouter with the owner's own key (encrypted at rest). One model per feature.
 * OpenRouter is one of the only outbound calls the instance makes.
 */
@Injectable()
export class AiService {
  constructor(private readonly dbs: DbService) {}

  private async getSetting<T>(key: string): Promise<{ value: T | null; enc: string | null }> {
    const [row] = await this.dbs.db.select().from(settings).where(eq(settings.key, key));
    return { value: (row?.value as T) ?? null, enc: row?.valueEnc ?? null };
  }

  async settings(): Promise<AiSettings> {
    const key = await this.getSetting<null>("ai.openrouterKey");
    const models = await this.getSetting<Partial<AiSettings["models"]>>("ai.models");
    return { hasKey: !!key.enc, models: { ...DEFAULT_MODELS, ...(models.value ?? {}) } };
  }

  async update(input: { apiKey?: string | null; models?: Partial<AiSettings["models"]> }) {
    if (input.apiKey !== undefined) {
      const valueEnc = input.apiKey ? encrypt(input.apiKey) : null;
      await this.dbs.db
        .insert(settings)
        .values({ key: "ai.openrouterKey", valueEnc })
        .onConflictDoUpdate({ target: settings.key, set: { valueEnc } });
    }
    if (input.models) {
      const current = (await this.settings()).models;
      const value = { ...current, ...input.models };
      await this.dbs.db.insert(settings).values({ key: "ai.models", value }).onConflictDoUpdate({ target: settings.key, set: { value } });
    }
    return this.settings();
  }

  /**
   * Ask the feature's model for a JSON object. Throws PRECONDITION_FAILED without a key so the UI can
   * point to Settings › AI.
   */
  async json<T>(feature: Feature, system: string, user: string): Promise<{ data: T; model: string; ms: number }> {
    const { enc } = await this.getSetting<null>("ai.openrouterKey");
    if (!enc) throw new AppError("PRECONDITION_FAILED", "Add an OpenRouter key in Settings › AI first");
    const model = (await this.settings()).models[feature];
    const started = Date.now();
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${decrypt(enc)}`, "content-type": "application/json", "x-title": "mado" },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${system}\nAnswer with one JSON object only.` },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new AppError("BAD_REQUEST", `OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content ?? "{}";
    const match = text.match(/\{[\s\S]*\}/);
    try {
      return { data: JSON.parse(match?.[0] ?? text) as T, model, ms: Date.now() - started };
    } catch {
      throw new AppError("BAD_REQUEST", "The model did not return valid JSON");
    }
  }
}
