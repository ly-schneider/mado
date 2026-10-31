import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { labels, memberships, projects, users, workspaces } from "@mado/db";
import { eq } from "drizzle-orm";
import { DbService } from "../db";
import type { Actor } from "../lib/actor";
import { AccessService } from "./access.service";
import { AiService } from "./ai.service";
import { AuditService } from "./audit.service";
import { DocService } from "./doc.service";
import { RefsService } from "./refs.service";
import { SearchService } from "./search.service";
import { TaskService } from "./task.service";
import { TrashService } from "./trash.service";

// Runs against the dev database (docker compose, port 5442). Each run creates its own workspace.
const dbs = new DbService();
const access = new AccessService(dbs);
const audit = new AuditService();
const refs = new RefsService();
const taskService = new TaskService(dbs, access, audit, refs, new AiService(dbs));
const search = new SearchService(dbs, access);
const ai = new AiService(dbs);
const trash = new TrashService(dbs, access, audit, refs, new DocService(dbs, access, audit, refs, ai));

let user: Actor;
let workspaceId: string;
let projectId: string;
let key: string;
let labelA: string;
let labelB: string;

beforeAll(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [u] = await dbs.db.insert(users).values({ email: `task-test-${stamp}@test.ch`, name: "Task Test", passwordHash: "x" }).returning();
  const [ws] = await dbs.db.insert(workspaces).values({ name: "Task tests", slug: `task-tests-${stamp}` }).returning();
  await dbs.db.insert(memberships).values({ workspaceId: ws!.id, userId: u!.id, role: "owner" });
  key = `K${stamp.replace(/\D/g, "").slice(-4)}`;
  const [p] = await dbs.db.insert(projects).values({ workspaceId: ws!.id, name: "Tasks", key }).returning();
  const [a, b] = await dbs.db
    .insert(labels)
    .values([
      { projectId: p!.id, name: "Alpha" },
      { projectId: p!.id, name: "Beta" },
    ])
    .returning();
  user = { type: "user", userId: u!.id, name: u!.name };
  workspaceId = ws!.id;
  projectId = p!.id;
  labelA = a!.id;
  labelB = b!.id;
});

afterAll(() => dbs.onApplicationShutdown());

describe("task keys", () => {
  test("numbers follow the project sequence and are never reused, even after a purge", async () => {
    const t1 = await taskService.create(user, { projectId, title: "one" });
    const t2 = await taskService.create(user, { projectId, title: "two" });
    expect([t1.key, t2.key]).toEqual([`${key}-1`, `${key}-2`]);

    await taskService.delete(user, t2.id);
    await trash.purge(user, "task", t2.id);
    const t3 = await taskService.create(user, { projectId, title: "three" });
    expect(t3.key).toBe(`${key}-3`);
  });

  test("concurrent creates get distinct consecutive numbers", async () => {
    const created = await Promise.all(Array.from({ length: 6 }, (_, i) => taskService.create(user, { projectId, title: `parallel ${i}` })));
    const numbers = created.map((t) => Number(t.key.split("-")[1])).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(6);
    expect(numbers[5]! - numbers[0]!).toBe(5);
    const [p] = await dbs.db.select({ next: projects.nextNumber }).from(projects).where(eq(projects.id, projectId));
    expect(p!.next).toBe(numbers[5]! + 1);
  });

  test("clientId becomes the row id", async () => {
    const clientId = crypto.randomUUID();
    const t = await taskService.create(user, { projectId, title: "optimistic", clientId });
    expect(t.id).toBe(clientId);
  });
});

describe("epic labels", () => {
  test("a task created under an epic inherits the epic's labels", async () => {
    const epic = await taskService.create(user, { projectId, title: "Epic", type: "epic", labelIds: [labelA] });
    const child = await taskService.create(user, { projectId, title: "Child", epicId: epic.id, labelIds: [labelB] });
    expect(child.labels.map((l) => l.id).sort()).toEqual([labelA, labelB].sort());
    expect(child.epic?.id).toBe(epic.id);
  });

  test("moving a task into an epic adds the epic's labels", async () => {
    const epic = await taskService.create(user, { projectId, title: "Epic 2", type: "epic", labelIds: [labelB] });
    const t = await taskService.create(user, { projectId, title: "Loose" });
    expect(t.labels).toEqual([]);
    const moved = await taskService.update(user, t.id, { epicId: epic.id });
    expect(moved.labels.map((l) => l.id)).toEqual([labelB]);
    const detail = await taskService.get(user, moved.key);
    expect(detail.activity.at(-1)?.text).toContain("added to an epic");
  });

  test("an epic can't be nested", async () => {
    const epic = await taskService.create(user, { projectId, title: "Epic 3", type: "epic" });
    expect(taskService.create(user, { projectId, title: "Nested", type: "epic", epicId: epic.id })).rejects.toThrow();
  });
});

describe("search", () => {
  test("finds tasks by body text with a plain snippet, by key, and by prefix", async () => {
    const t = await taskService.create(user, {
      projectId,
      title: "Quarterly report",
      description: "The **zygomorphic** widget renders twice when the window resizes.",
    });
    const body = await search.query(user, { workspaceId, q: "zygomorphic", limit: 8 });
    expect(body.tasks.map((x) => x.id)).toContain(t.id);
    const hit = body.tasks.find((x) => x.id === t.id)!;
    expect(hit.snippet).toContain("zygomorphic");
    expect(hit.snippet).not.toMatch(/[*<>]/);

    const byKey = await search.query(user, { workspaceId, q: t.key.toLowerCase(), limit: 8 });
    expect(byKey.tasks[0]?.id).toBe(t.id);

    const prefix = await search.query(user, { workspaceId, q: "zygomor", limit: 8 });
    expect(prefix.tasks.map((x) => x.id)).toContain(t.id);

    const german = await search.query(user, { workspaceId, q: "Quartal OR widgets", limit: 8 });
    expect(german.tasks.map((x) => x.id)).toContain(t.id);
    expect(german.ms).toBeLessThan(200);
  });

  test("tsquery syntax in user input never errors", async () => {
    for (const q of ["a & | ! (", "'", ":*", "-", "MAD-", "&&&"]) {
      await search.query(user, { workspaceId, q, limit: 8 });
    }
  });

  test("deleted tasks are not found", async () => {
    const t = await taskService.create(user, { projectId, title: "Ephemeral xylophonic thing" });
    await taskService.delete(user, t.id);
    const res = await search.query(user, { workspaceId, q: "xylophonic", limit: 8 });
    expect(res.tasks.map((x) => x.id)).not.toContain(t.id);
  });
});
