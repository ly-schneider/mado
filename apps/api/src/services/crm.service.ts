import type { Lead, LeadStage, LeadSummary } from "@mado/contract";
import { STAGE_LABEL } from "@mado/contract";
import { companies, contacts, leads, tasks, type Tx } from "@mado/db";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, isNull, max, notInArray } from "drizzle-orm";
import { DbService } from "../db";
import { type Actor, actorId } from "../lib/actor";
import { badRequest, notFound } from "../lib/errors";
import { AccessService } from "./access.service";
import { AiService } from "./ai.service";
import { AuditService } from "./audit.service";
import { lookupActor, resolveActors } from "./doc.service";

type LeadRow = typeof leads.$inferSelect;
type CompanyRow = typeof companies.$inferSelect;
type ContactRow = typeof contacts.$inferSelect;

export interface LeadPatch {
  stage?: LeadStage;
  source?: string;
  notes?: string;
  lastContactAt?: string | null;
  lastContactNote?: string;
  sortOrder?: number;
  company?: { name?: string; location?: string; details?: string; website?: string };
  contact?: { name?: string; email?: string; role?: string; phone?: string };
}

/** Swiss UWG: unsolicited mail must offer an easy way to decline, so every draft ends with one. */
const OPT_OUT: Record<"de" | "en", string> = {
  de: "Kein Interesse? Eine kurze Antwort genügt.",
  en: "Not interested? A short reply is enough.",
};

const leadLabel = (company: string, contact: string | null | undefined) => (contact ? `${company} · ${contact}` : company);

@Injectable()
export class CrmService {
  constructor(
    private readonly dbs: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly ai: AiService,
  ) {}

  private get db() {
    return this.dbs.db;
  }

  private async rows(where: ReturnType<typeof and>) {
    return this.db
      .select({ lead: leads, company: companies, contact: contacts })
      .from(leads)
      .innerJoin(companies, eq(companies.id, leads.companyId))
      .leftJoin(contacts, eq(contacts.id, leads.contactId))
      .where(where)
      .orderBy(asc(leads.sortOrder), desc(leads.updatedAt));
  }

  private async summaries(rows: { lead: LeadRow; company: CompanyRow; contact: ContactRow | null }[]): Promise<LeadSummary[]> {
    const actors = await resolveActors(
      this.db,
      rows.map((r) => ({ type: r.lead.createdByType, id: r.lead.createdById })),
    );
    return rows.map(({ lead, company, contact }) => ({
      id: lead.id,
      projectId: lead.projectId,
      stage: lead.stage,
      source: lead.source,
      company: { id: company.id, name: company.name, location: company.location, details: company.details, website: company.website },
      contact: contact && !contact.deletedAt ? { id: contact.id, name: contact.name, role: contact.role, email: contact.email, phone: contact.phone } : null,
      lastContactAt: lead.lastContactAt,
      owner: lookupActor(actors, lead.createdByType, lead.createdById)!,
      sortOrder: lead.sortOrder,
      updatedAt: lead.updatedAt.toISOString(),
    }));
  }

  private async load(id: string) {
    const [row] = await this.rows(and(eq(leads.id, id), isNull(leads.deletedAt)));
    if (!row) throw notFound("Lead");
    return row;
  }

  private async toLead(id: string): Promise<Lead> {
    const row = await this.load(id);
    const [summary] = await this.summaries([row]);
    return {
      ...summary!,
      notes: row.lead.notes,
      lastContactNote: row.lead.lastContactNote,
      analysis: row.lead.analysis ?? null,
      analyzedAt: row.lead.analyzedAt?.toISOString() ?? null,
      draft: row.lead.draft ?? null,
      draftedAt: row.lead.draftedAt?.toISOString() ?? null,
    };
  }

  async list(actor: Actor, projectId: string): Promise<LeadSummary[]> {
    await this.access.requireProject(actor, projectId, "read", "crm");
    return this.summaries(await this.rows(and(eq(leads.projectId, projectId), isNull(leads.deletedAt))));
  }

  async get(actor: Actor, id: string): Promise<Lead> {
    const row = await this.load(id);
    await this.access.requireProject(actor, row.lead.projectId, "read", "crm");
    return this.toLead(id);
  }

  async create(
    actor: Actor,
    input: {
      projectId: string;
      company: { name: string; location: string; details: string };
      contact?: { name: string; email: string; role: string };
      stage: LeadStage;
      source: string;
      notes: string;
      clientId?: string;
    },
  ): Promise<LeadSummary> {
    const project = await this.access.requireProject(actor, input.projectId, "write", "crm");
    if (input.clientId) {
      const [existing] = await this.db.select({ id: leads.id, projectId: leads.projectId }).from(leads).where(eq(leads.id, input.clientId));
      if (existing) {
        if (existing.projectId !== input.projectId) throw badRequest("Lead ID is already used");
        return (await this.summaries([await this.load(existing.id)]))[0]!;
      }
    }
    const id = await this.db.transaction(async (tx) => {
      const [company] = await tx.insert(companies).values({ projectId: project.id, ...input.company }).returning();
      const contact = input.contact
        ? (await tx.insert(contacts).values({ projectId: project.id, companyId: company!.id, ...input.contact }).returning())[0]
        : undefined;
      const [last] = await tx.select({ m: max(leads.sortOrder) }).from(leads).where(and(eq(leads.projectId, project.id), isNull(leads.deletedAt)));
      const [lead] = await tx
        .insert(leads)
        .values({
          ...(input.clientId ? { id: input.clientId } : {}),
          projectId: project.id,
          companyId: company!.id,
          contactId: contact?.id ?? null,
          stage: input.stage,
          source: input.source,
          notes: input.notes,
          sortOrder: (last?.m ?? 0) + 1,
          createdByType: actor.type,
          createdById: actorId(actor),
        })
        .returning();
      await this.audit.revision(tx, actor, {
        entityType: "lead",
        entityId: lead!.id,
        snapshot: { notes: input.notes, stage: input.stage, source: input.source },
        summary: "Created",
      });
      await this.audit.record(tx, actor, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        action: "lead.create",
        entityType: "lead",
        entityId: lead!.id,
        entityLabel: leadLabel(company!.name, contact?.name),
        after: { company: input.company, contact: input.contact ?? null, stage: input.stage, source: input.source },
      });
      return lead!.id;
    });
    return (await this.summaries([await this.load(id)]))[0]!;
  }

  async update(actor: Actor, id: string, patch: LeadPatch, opts: { summary?: string; forceRevision?: boolean } = {}): Promise<LeadSummary> {
    const before = await this.load(id);
    const project = await this.access.requireProject(actor, before.lead.projectId, "write", "crm");
    const { lead } = before;

    await this.db.transaction(async (tx) => {
      const leadSet: Partial<typeof leads.$inferInsert> = {};
      for (const k of ["stage", "source", "notes", "lastContactAt", "lastContactNote", "sortOrder"] as const) {
        if (patch[k] !== undefined) (leadSet as Record<string, unknown>)[k] = patch[k];
      }
      if (patch.company && Object.keys(patch.company).length) {
        if (patch.company.name !== undefined && !patch.company.name.trim()) throw badRequest("Company name can't be empty");
        await tx.update(companies).set(patch.company).where(eq(companies.id, lead.companyId));
      }
      if (patch.contact && Object.keys(patch.contact).length) {
        if (before.contact && !before.contact.deletedAt) {
          await tx.update(contacts).set(patch.contact).where(eq(contacts.id, before.contact.id));
        } else if (patch.contact.name?.trim()) {
          const [c] = await tx
            .insert(contacts)
            .values({ projectId: lead.projectId, companyId: lead.companyId, ...patch.contact, name: patch.contact.name.trim() })
            .returning();
          leadSet.contactId = c!.id;
        }
      }
      leadSet.updatedAt = new Date();
      await tx.update(leads).set(leadSet).where(eq(leads.id, id));

      const tracked = { notes: lead.notes, stage: lead.stage, source: lead.source };
      const next = { notes: patch.notes ?? lead.notes, stage: patch.stage ?? lead.stage, source: patch.source ?? lead.source };
      if (opts.forceRevision || next.notes !== tracked.notes || next.stage !== tracked.stage || next.source !== tracked.source) {
        await this.revision(tx, actor, id, tracked, next, opts.summary);
      }

      const stageChanged = patch.stage !== undefined && patch.stage !== lead.stage;
      await this.audit.record(tx, actor, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        action: stageChanged ? "lead.stage" : "lead.update",
        entityType: "lead",
        entityId: id,
        entityLabel: leadLabel(patch.company?.name ?? before.company.name, patch.contact?.name ?? before.contact?.name),
        before: {
          ...pick(lead, Object.keys(leadSet)),
          ...(patch.company ? { company: pick(before.company, Object.keys(patch.company)) } : {}),
          ...(patch.contact ? { contact: before.contact ? pick(before.contact, Object.keys(patch.contact)) : null } : {}),
        },
        after: { ...patch, ...(stageChanged ? { stageText: `${STAGE_LABEL[lead.stage]} → ${STAGE_LABEL[patch.stage!]}` } : {}) },
      });
    });
    return (await this.summaries([await this.load(id)]))[0]!;
  }

  private async revision(
    tx: Tx,
    actor: Actor,
    id: string,
    prev: { notes: string; stage: LeadStage; source: string },
    next: { notes: string; stage: LeadStage; source: string },
    summary?: string,
  ) {
    const parts: string[] = [];
    if (prev.stage !== next.stage) parts.push(`${STAGE_LABEL[prev.stage]} → ${STAGE_LABEL[next.stage]}`);
    if (prev.source !== next.source) parts.push("source");
    if (prev.notes !== next.notes) parts.push("notes");
    await this.audit.revision(tx, actor, { entityType: "lead", entityId: id, snapshot: next, summary: summary ?? (parts.join(", ") || null) });
  }

  async delete(actor: Actor, id: string) {
    const row = await this.load(id);
    const project = await this.access.requireProject(actor, row.lead.projectId, "delete", "crm");
    await this.db.transaction(async (tx) => {
      await tx.update(leads).set({ deletedAt: new Date(), deletedByType: actor.type, deletedById: actorId(actor) }).where(eq(leads.id, id));
      await this.audit.record(tx, actor, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        action: "lead.delete",
        entityType: "lead",
        entityId: id,
        entityLabel: leadLabel(row.company.name, row.contact?.name),
        before: { stage: row.lead.stage },
      });
    });
  }

  private describe(row: { lead: LeadRow; company: CompanyRow; contact: ContactRow | null }) {
    const { lead, company, contact } = row;
    return [
      `Company: ${company.name}${company.location ? ` (${company.location})` : ""}${company.details ? `, ${company.details}` : ""}${company.website ? `, ${company.website}` : ""}`,
      contact ? `Contact: ${contact.name}${contact.role ? `, ${contact.role}` : ""}${contact.email ? `, ${contact.email}` : ""}` : "Contact: none yet",
      `Stage: ${STAGE_LABEL[lead.stage]}`,
      lead.source && `Source: ${lead.source}`,
      lead.lastContactAt && `Last contact: ${lead.lastContactAt}${lead.lastContactNote ? ` (${lead.lastContactNote})` : ""}`,
      lead.notes && `Notes:\n${lead.notes}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  async analyze(actor: Actor, id: string): Promise<Lead> {
    const row = await this.load(id);
    const project = await this.access.requireProject(actor, row.lead.projectId, "write", "crm");
    const open = await this.db
      .select({ key: tasks.key, title: tasks.title })
      .from(tasks)
      .where(and(eq(tasks.projectId, project.id), isNull(tasks.deletedAt), notInArray(tasks.status, ["done", "canceled"])))
      .orderBy(desc(tasks.updatedAt))
      .limit(60);
    const { data, model, ms } = await this.ai.json<{ rows?: { label?: string; text?: string }[] }>(
      "leadAnalysis",
      [
        `You assess sales leads for the project "${project.name}" (${project.key}).`,
        'Return {"rows": [{"label": string, "text": string}]} with exactly these labels in order: "Fit", "Timing", "Risk", "Next step".',
        "Each text is one or two plain sentences. Be concrete and honest; say when information is missing.",
        "When an open task of the project is relevant (e.g. a feature the lead needs), reference it by its key like ABC-12.",
        "Write in the language of the lead notes (German or English).",
      ].join("\n"),
      `${this.describe(row)}\n\nOpen tasks:\n${open.map((t) => `${t.key} ${t.title}`).join("\n") || "(none)"}`,
    );
    const rows = (data.rows ?? [])
      .filter((r) => r && typeof r.label === "string" && typeof r.text === "string")
      .map((r) => ({ label: r.label!.trim(), text: r.text!.trim() }));
    const analysis = { rows, model, ms };
    await this.db.transaction(async (tx) => {
      await tx.update(leads).set({ analysis, analyzedAt: new Date() }).where(eq(leads.id, id));
      await this.audit.record(tx, actor, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        action: "lead.analyze",
        entityType: "lead",
        entityId: id,
        entityLabel: leadLabel(row.company.name, row.contact?.name),
        before: { analysis: row.lead.analysis },
        after: { analysis },
      });
    });
    return this.toLead(id);
  }

  /** Drafts only. Sending stays manual, outside mado. */
  async draftEmail(actor: Actor, id: string, language: "de" | "en", instructions?: string): Promise<Lead> {
    const row = await this.load(id);
    const project = await this.access.requireProject(actor, row.lead.projectId, "write", "crm");
    const { data, model } = await this.ai.json<{ subject?: string; body?: string }>(
      "emailDraft",
      [
        `Write a short, personal first-contact email for one specific lead, in ${language === "de" ? "German (Swiss usage: ss instead of ß, formal Sie)" : "English"}.`,
        "Low volume, one-to-one: no marketing language, no superlatives, no placeholders like [Name] unless the contact name is unknown.",
        "Plain text, at most 120 words, greeting and sign-off included.",
        `End the body with this exact line on its own: "${OPT_OUT[language]}"`,
        'Return {"subject": string, "body": string}.',
      ].join("\n"),
      `${this.describe(row)}${instructions ? `\n\nInstructions from the sender:\n${instructions}` : ""}`,
    );
    let body = String(data.body ?? "").trim();
    if (!body.includes(OPT_OUT[language])) body = `${body}\n\n${OPT_OUT[language]}`;
    const draft = { subject: String(data.subject ?? "").trim(), body, language, model };
    await this.db.transaction(async (tx) => {
      await tx.update(leads).set({ draft, draftedAt: new Date() }).where(eq(leads.id, id));
      await this.audit.record(tx, actor, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        action: "lead.draft",
        entityType: "lead",
        entityId: id,
        entityLabel: leadLabel(row.company.name, row.contact?.name),
        after: { subject: draft.subject, language },
      });
    });
    return this.toLead(id);
  }
}

function pick(obj: object, keys: string[]) {
  const src = obj as Record<string, unknown>;
  return Object.fromEntries(keys.filter((k) => k in src && k !== "updatedAt").map((k) => [k, src[k]]));
}
