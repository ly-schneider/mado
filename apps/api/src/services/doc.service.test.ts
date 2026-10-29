import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { docs, memberships, projects, revisions, taskDocs, tasks, users, workspaces } from "@mado/db";
import { and, asc, eq } from "drizzle-orm";
import { DbService } from "../db";
import type { Actor } from "../lib/actor";
import { AccessService } from "./access.service";
import { AiService } from "./ai.service";
import { AuditService } from "./audit.service";
import { DocService } from "./doc.service";
import { RefsService } from "./refs.service";
import { ShareService } from "./share.service";

// Runs against the dev database (docker compose, port 5442). Each run creates its own workspace.
const dbs = new DbService();
const access = new AccessService(dbs);
const audit = new AuditService();
const docService = new DocService(dbs, access, audit, new RefsService(), new AiService(dbs));
const share = new ShareService(dbs, access, audit, docService);

let user: Actor;
let other: Actor;
let workspaceId: string;
let projectId: string;

beforeAll(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [u] = await dbs.db.insert(users).values({ email: `doc-test-${stamp}@test.ch`, name: "Doc Test", passwordHash: "x" }).returning();
  const [u2] = await dbs.db.insert(users).values({ email: `doc-test2-${stamp}@test.ch`, name: "Other Test", passwordHash: "x" }).returning();
  const [ws] = await dbs.db.insert(workspaces).values({ name: "Doc tests", slug: `doc-tests-${stamp}` }).returning();
  await dbs.db.insert(memberships).values([
    { workspaceId: ws!.id, userId: u!.id, role: "owner" },
    { workspaceId: ws!.id, userId: u2!.id, role: "member" },
  ]);
  const key = `T${stamp.replace(/\D/g, "").slice(-4)}`;
  const [p] = await dbs.db.insert(projects).values({ workspaceId: ws!.id, name: "Docs", key }).returning();
  user = { type: "user", userId: u!.id, name: u!.name };
  other = { type: "user", userId: u2!.id, name: u2!.name };
  workspaceId = ws!.id;
  projectId = p!.id;
});

afterAll(() => dbs.onApplicationShutdown());

const revisionRows = (docId: string) =>
  dbs.db
    .select()
    .from(revisions)
    .where(and(eq(revisions.entityType, "doc"), eq(revisions.entityId, docId)))
    .orderBy(asc(revisions.number));

describe("revision coalescing", () => {
  test("autosaves by the same actor fold into one revision; checkpoint and actor change start new ones", async () => {
    const page = await docService.create(user, { workspaceId, projectId, title: "Coalesce", content: "a" });
    for (const content of ["ab", "abc", "abcd"]) await docService.save(user, { id: page.id, content });
    expect((await revisionRows(page.id)).length).toBe(1);

    const cp = await docService.save(user, { id: page.id, content: "abcde", checkpoint: true });
    expect(cp.revisionNumber).toBe(2);

    await docService.save(user, { id: page.id, content: "abcdef" });
    // A different actor first snapshots the pending "abcdef" under its author, then adds its own.
    const r = await docService.save(other, { id: page.id, content: "other", baseRevision: 2 });
    const rows = await revisionRows(page.id);
    expect(rows.map((x) => [x.number, x.actorName, (x.snapshot as { content: string }).content])).toEqual([
      [1, "Doc Test", "a"],
      [2, "Doc Test", "abcde"],
      [3, "Doc Test", "abcdef"],
      [4, "Other Test", "other"],
    ]);
    expect(r.revisionNumber).toBe(4);
    const [row] = await dbs.db.select().from(docs).where(eq(docs.id, page.id));
    expect(row!.revisionNumber).toBe(4);
  });

  test("restoring appends a new revision on top", async () => {
    const page = await docService.create(user, { workspaceId, projectId, title: "Restore", content: "one" });
    await docService.save(user, { id: page.id, content: "two", checkpoint: true });
    const [first] = await revisionRows(page.id);
    await docService.restoreRevision(user, page.id, first!.id);
    const rows = await revisionRows(page.id);
    expect(rows.length).toBe(3);
    expect(rows[2]!.summary).toBe("Restored revision 1");
    expect((await docService.get(user, page.id)).content).toBe("one");
  });
});

describe("subtree delete and restore", () => {
  test("deletes a page with its sub-pages and restores them together", async () => {
    const root = await docService.create(user, { workspaceId, projectId, title: "Folder", content: "" });
    const child = await docService.create(user, { workspaceId, parentId: root.id, title: "Child", content: "" });
    const grandchild = await docService.create(user, { workspaceId, parentId: child.id, title: "Grandchild", content: "" });
    await docService.delete(user, root.id);
    const deleted = await dbs.db.select().from(docs).where(eq(docs.id, grandchild.id));
    expect(deleted[0]!.deletedAt).not.toBeNull();
    const restored = await dbs.db.transaction((tx) => docService.restoreSubtree(tx, root.id, deleted[0]!.deletedAt!));
    expect(restored.sort()).toEqual([root.id, child.id, grandchild.id].sort());
  });
});

describe("guest confinement", () => {
  test("guests only reach the shared subtree, and edits are attributed to the link", async () => {
    const shared = await docService.create(user, { workspaceId, projectId, title: "Shared", content: "" });
    const inside = await docService.create(user, { workspaceId, parentId: shared.id, title: "Inside", content: "" });
    const outside = await docService.create(user, { workspaceId, projectId, title: "Outside", content: "links [[Inside]]" });

    await expect(share.create(user, { docId: shared.id, name: "Client", type: "edit", expiry: "7d" })).rejects.toThrow("PIN");
    const link = await share.create(user, { docId: shared.id, name: "Client", type: "edit", pin: "1234", expiry: "7d" });
    const token = link.url.split("/s/")[1]!;

    await expect(share.open(token)).rejects.toMatchObject({ data: { pinRequired: true } });
    const session = await share.open(token, "1234");
    expect(session.tree.map((n) => n.id).sort()).toEqual([shared.id, inside.id].sort());

    const doc = await share.guestGet(token, "1234", inside.id);
    expect(doc.backlinks).toEqual([]); // the linking page is outside the subtree
    await expect(share.guestGet(token, "1234", outside.id)).rejects.toThrow("not found");
    await expect(share.guestSave(token, "1234", { docId: outside.id, content: "x" })).rejects.toThrow("not found");
    await expect(share.guestCreate(token, "1234", { parentId: outside.id, title: "x" })).rejects.toThrow("not found");
    await expect(share.guestDelete(token, "1234", shared.id)).rejects.toThrow("can't be deleted");

    await share.guestSave(token, "1234", { docId: inside.id, content: "guest text" });
    const rows = await revisionRows(inside.id);
    expect(rows.at(-1)!.actorName).toBe("Guest via “Client”");
    expect(rows.at(-1)!.actorType).toBe("guest");

    await share.revoke(user, link.id);
    await expect(share.open(token, "1234")).rejects.toThrow("no longer valid");
  });
});

describe("agent reads", () => {
  test("reading a page marks linked tasks assigned to the agent", async () => {
    const page = await docService.create(user, { workspaceId, projectId, title: "Spec", content: "" });
    const grantId = `g_test${Date.now()}`;
    const [project] = await dbs.db.select().from(projects).where(eq(projects.id, projectId));
    const [task] = await dbs.db
      .insert(tasks)
      .values({ projectId, number: 1, key: `${project!.key}-1`, title: "Build", assigneeGrantId: grantId, createdByType: "user", createdById: (user as { userId: string }).userId })
      .returning();
    await dbs.db.insert(taskDocs).values({ taskId: task!.id, docId: page.id });
    const agent: Actor = {
      type: "agent",
      userId: (user as { userId: string }).userId,
      name: "Claude",
      sessionId: null,
      grant: { id: grantId, userId: (user as { userId: string }).userId, agentName: "Claude", projectScope: "listed", allLevel: "read", projects: new Map([[projectId, "read"]]), resourceTypes: ["docs", "tasks"] },
    };
    const doc = await docService.get(agent, page.id);
    expect(doc.canEdit).toBe(false);
    expect(doc.backlinks.map((b) => b.key)).toEqual([`${project!.key}-1`]);
    const [link] = await dbs.db.select().from(taskDocs).where(eq(taskDocs.docId, page.id));
    expect(link!.lastReadByAgentAt).not.toBeNull();
  });
});
