import { type ExpiryOption, expiryToDate, type GuestSession, type ShareLink } from "@mado/contract";
import { docs, shareLinks, workspaces } from "@mado/db";
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import { config } from "../config";
import { DbService } from "../db";
import type { Actor } from "../lib/actor";
import { decrypt, encrypt, randomToken, sha256 } from "../lib/crypto";
import { AppError, badRequest, notFound } from "../lib/errors";
import { AccessService } from "./access.service";
import { AuditService } from "./audit.service";
import { DocService, guestName } from "./doc.service";

type LinkRow = typeof shareLinks.$inferSelect;

const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MS = 15 * 60_000;
const LAST_USED_THROTTLE_MS = 60_000;

/**
 * Guest share links. Tokens are stored as a sha256 hash (lookup) plus an encrypted copy so members
 * can copy the link again. A guest becomes an Actor confined to the linked subtree by AccessService.
 */
@Injectable()
export class ShareService {
  /** Wrong PIN attempts per link. In memory: a restart resets it, which is fine for a single instance. */
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    private readonly dbs: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly docs: DocService,
  ) {}

  private url(row: LinkRow) {
    return `${config.publicUrl}/s/${decrypt(row.tokenEnc)}`;
  }

  private toLink(row: LinkRow, docTitle: string): ShareLink {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      url: this.url(row),
      hasPin: !!row.pinHash,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      docId: row.docId,
      docTitle,
    };
  }

  async list(actor: Actor, workspaceId: string, docId?: string): Promise<ShareLink[]> {
    this.access.requireUser(actor);
    await this.access.requireWorkspace(actor, workspaceId);
    const rows = await this.dbs.db
      .select({ link: shareLinks, title: docs.title })
      .from(shareLinks)
      .innerJoin(docs, eq(docs.id, shareLinks.docId))
      .where(and(eq(shareLinks.workspaceId, workspaceId), docId ? eq(shareLinks.docId, docId) : undefined))
      .orderBy(desc(shareLinks.createdAt));
    return rows.map((r) => this.toLink(r.link, r.title));
  }

  async create(actor: Actor, input: { docId: string; name: string; type: "view" | "edit"; pin?: string; expiry: ExpiryOption }): Promise<ShareLink> {
    const user = this.access.requireUser(actor);
    const doc = await this.access.requireDoc(actor, input.docId, input.type === "edit" ? "write" : "read");
    // An edit link without login is a password anyone can forward, so it must carry a PIN.
    if (input.type === "edit" && !input.pin) throw badRequest("Edit links need a PIN");
    const token = randomToken(32);
    const row = await this.dbs.db.transaction(async (tx) => {
      const [r] = await tx
        .insert(shareLinks)
        .values({
          workspaceId: doc.workspaceId,
          docId: doc.id,
          name: input.name,
          type: input.type,
          tokenHash: sha256(token),
          tokenEnc: encrypt(token),
          pinHash: input.pin ? await Bun.password.hash(input.pin, { algorithm: "argon2id" }) : null,
          expiresAt: expiryToDate(input.expiry),
          createdById: user.userId,
        })
        .returning();
      await this.audit.record(tx, actor, {
        workspaceId: doc.workspaceId,
        projectId: doc.projectId,
        action: "share.create",
        entityType: "share_link",
        entityId: r!.id,
        entityLabel: `${input.name} · ${doc.title}`,
        after: { type: input.type, docId: doc.id, hasPin: !!input.pin, expiresAt: r!.expiresAt },
      });
      return r!;
    });
    return this.toLink(row, doc.title);
  }

  async revoke(actor: Actor, id: string) {
    this.access.requireUser(actor);
    const [link] = await this.dbs.db.select().from(shareLinks).where(eq(shareLinks.id, id));
    if (!link) throw notFound("Link");
    await this.access.requireWorkspace(actor, link.workspaceId);
    if (link.revokedAt) return;
    await this.dbs.db.transaction(async (tx) => {
      await tx.update(shareLinks).set({ revokedAt: new Date() }).where(eq(shareLinks.id, id));
      await this.audit.record(tx, actor, {
        workspaceId: link.workspaceId,
        action: "share.revoke",
        entityType: "share_link",
        entityId: link.id,
        entityLabel: link.name,
      });
    });
  }

  /**
   * Validates a token (+ PIN) and returns the guest actor. A missing or wrong PIN throws
   * UNAUTHORIZED with data.pinRequired so the guest page can ask for it.
   */
  async guestActor(token: string, pin?: string): Promise<{ actor: Extract<Actor, { type: "guest" }>; link: LinkRow }> {
    const [link] = await this.dbs.db.select().from(shareLinks).where(eq(shareLinks.tokenHash, sha256(token)));
    const gone = () => new AppError("NOT_FOUND", "This link is no longer valid", { linkInvalid: true });
    if (!link || link.revokedAt) throw gone();
    if (link.expiresAt && link.expiresAt < new Date()) throw new AppError("NOT_FOUND", "This link has expired", { linkInvalid: true, expired: true });

    if (link.pinHash) {
      const state = this.failures.get(link.id);
      if (state && state.lockedUntil > Date.now()) {
        throw new ORPCError("TOO_MANY_REQUESTS", {
          message: "Too many wrong PINs. Try again later.",
          data: { pinRequired: true, retryAfter: Math.ceil((state.lockedUntil - Date.now()) / 1000) },
        });
      }
      if (!pin) throw new AppError("UNAUTHORIZED", "PIN required", { pinRequired: true });
      if (!(await Bun.password.verify(pin, link.pinHash))) {
        const count = (state && state.lockedUntil > 0 && state.lockedUntil <= Date.now() ? 0 : (state?.count ?? 0)) + 1;
        this.failures.set(link.id, { count, lockedUntil: count >= PIN_MAX_FAILURES ? Date.now() + PIN_LOCK_MS : 0 });
        throw new AppError("UNAUTHORIZED", "Wrong PIN", { pinRequired: true, wrongPin: true, attemptsLeft: Math.max(0, PIN_MAX_FAILURES - count) });
      }
      this.failures.delete(link.id);
    }

    const [root] = await this.dbs.db.select({ deletedAt: docs.deletedAt }).from(docs).where(eq(docs.id, link.docId));
    if (!root || root.deletedAt) throw gone();

    if (!link.lastUsedAt || Date.now() - link.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
      await this.dbs.db.update(shareLinks).set({ lastUsedAt: new Date() }).where(eq(shareLinks.id, link.id));
    }
    return {
      link,
      actor: {
        type: "guest",
        linkId: link.id,
        name: guestName(link.name),
        workspaceId: link.workspaceId,
        rootDocId: link.docId,
        canEdit: link.type === "edit",
      },
    };
  }

  async open(token: string, pin?: string): Promise<GuestSession> {
    const { actor, link } = await this.guestActor(token, pin);
    const [ws] = await this.dbs.db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, link.workspaceId));
    const tree = await this.docs.tree(actor, link.workspaceId);
    return {
      linkName: link.name,
      type: link.type,
      rootId: link.docId,
      workspaceName: ws?.name ?? "",
      tree: tree.map((n) => (n.id === link.docId ? { ...n, parentId: null } : n)),
      expiresAt: link.expiresAt?.toISOString() ?? null,
    };
  }

  async guestGet(token: string, pin: string | undefined, docId: string) {
    const { actor } = await this.guestActor(token, pin);
    return this.docs.get(actor, docId);
  }

  async guestSave(token: string, pin: string | undefined, input: { docId: string; title?: string; content?: string }) {
    const { actor } = await this.guestActor(token, pin);
    const r = await this.docs.save(actor, { id: input.docId, title: input.title, content: input.content });
    return { revisionNumber: r.revisionNumber, updatedAt: r.updatedAt };
  }

  async guestCreate(token: string, pin: string | undefined, input: { parentId: string; title: string }) {
    const { actor, link } = await this.guestActor(token, pin);
    return this.docs.create(actor, { workspaceId: link.workspaceId, parentId: input.parentId, title: input.title, content: "" });
  }

  async guestDelete(token: string, pin: string | undefined, docId: string) {
    const { actor } = await this.guestActor(token, pin);
    await this.docs.delete(actor, docId);
  }
}
