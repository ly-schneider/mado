import { createHmac, timingSafeEqual } from "node:crypto";
import { findTaskKeys } from "@mado/contract";
import { gitLinks, projects, repos, taskLabels, tasks, type TaskStatus, type Tx } from "@mado/db";
import { Controller, Logger, Post, Req, Res } from "@nestjs/common";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { DbService } from "../db";
import type { Actor } from "../lib/actor";
import { decrypt } from "../lib/crypto";
import { AuditService } from "../services/audit.service";
import { type GitCommit, type GitEvent, parseGithub, parseGitlab, type Provider } from "./payloads";

const MAX_BODY = 5 * 1024 * 1024;

type Task = typeof tasks.$inferSelect;
type Repo = typeof repos.$inferSelect;

// PR opened moves work forward only; it never pulls a done or canceled task back.
const OPEN_MOVES_FROM: TaskStatus[] = ["backlog", "todo", "in_progress"];
const MERGE_MOVES_FROM: TaskStatus[] = ["backlog", "todo", "in_progress", "in_review"];

async function readRaw(req: Request): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("payload too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Same shape TaskService writes, so revision restore treats webhook revisions like any other. */
function taskSnapshot(t: Task, labelIds: string[]) {
  return {
    key: t.key,
    title: t.title,
    description: t.description,
    type: t.type,
    status: t.status,
    priority: t.priority,
    assignee: t.assigneeUserId ? `user:${t.assigneeUserId}` : t.assigneeGrantId ? `agent:${t.assigneeGrantId}` : null,
    labelIds: [...labelIds].sort(),
    epicId: t.epicId,
    dueDate: t.dueDate,
  };
}

const firstLine = (message: string) => message.split("\n", 1)[0]!.trim();

@Controller("webhooks")
export class WebhooksController {
  private readonly log = new Logger("Webhooks");

  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  @Post("github")
  async github(@Req() req: Request, @Res() res: Response) {
    const event = req.header("x-github-event") ?? "";
    await this.handle("github", req, res, (raw, body, repo) => {
      const signature = req.header("x-hub-signature-256") ?? "";
      const expected = `sha256=${createHmac("sha256", decrypt(repo.secretEnc)).update(raw).digest("hex")}`;
      if (!safeEqual(signature, expected)) return false;
      return event === "ping" ? [] : parseGithub(event, body);
    }, (body) => body?.repository?.full_name);
  }

  @Post("gitlab")
  async gitlab(@Req() req: Request, @Res() res: Response) {
    const event = req.header("x-gitlab-event") ?? "";
    await this.handle("gitlab", req, res, (_raw, body, repo) => {
      if (!safeEqual(req.header("x-gitlab-token") ?? "", decrypt(repo.secretEnc))) return false;
      return parseGitlab(event, body);
    }, (body) => body?.project?.path_with_namespace);
  }

  /** Verify, then link synchronously: payloads are small and providers allow ~10 s before retrying. */
  private async handle(
    provider: Provider,
    req: Request,
    res: Response,
    verifyAndParse: (raw: Buffer, body: any, repo: Repo) => GitEvent[] | false,
    repoName: (body: any) => unknown,
  ) {
    let raw: Buffer;
    let body: any;
    try {
      raw = await readRaw(req);
      const text = raw.toString("utf8");
      // GitHub can be configured to send form-encoded payloads; the signature still covers the raw body.
      body = req.is("application/x-www-form-urlencoded")
        ? JSON.parse(new URLSearchParams(text).get("payload") ?? "")
        : JSON.parse(text);
    } catch {
      return res.status(400).json({ error: "invalid payload" });
    }

    const name = repoName(body);
    if (typeof name !== "string") return res.status(400).json({ error: "no repository in payload" });
    const [repo] = await this.dbs.db
      .select()
      .from(repos)
      .where(and(eq(repos.provider, provider), sql`lower(${repos.fullName}) = lower(${name})`, isNull(repos.deletedAt)))
      .limit(1);
    if (!repo) return res.status(404).json({ error: `repository ${name} is not linked to a project` });

    let events: GitEvent[] | false;
    try {
      events = verifyAndParse(raw, body, repo);
    } catch {
      events = false;
    }
    if (events === false) return res.status(401).json({ error: "signature or token does not match" });

    try {
      const linked = await this.process(provider, repo, events);
      await this.dbs.db.update(repos).set({ lastEventAt: new Date() }).where(eq(repos.id, repo.id));
      res.status(200).json({ ok: true, linked });
    } catch (e) {
      this.log.error(`${provider} ${repo.fullName}: ${(e as Error).message}`);
      res.status(500).json({ error: "processing failed" });
    }
  }

  private async process(provider: Provider, repo: Repo, events: GitEvent[]) {
    const [project] = await this.dbs.db
      .select({ id: projects.id, workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, repo.projectId));
    if (!project) return [];
    const actor: Actor = { type: "system", name: provider === "github" ? "GitHub" : "GitLab" };
    const ctx = { provider, repo: repo.fullName, projectId: project.id, workspaceId: project.workspaceId, actor };
    const linked = new Set<string>();

    for (const event of events) {
      if (event.kind === "ignored") continue;
      await this.dbs.db.transaction(async (tx) => {
        const keys = await this.handleEvent(tx, ctx, event);
        for (const k of keys) linked.add(k);
      });
    }
    return [...linked];
  }

  private async handleEvent(tx: Tx, ctx: Ctx, event: Exclude<GitEvent, { kind: "ignored" }>): Promise<string[]> {
    switch (event.kind) {
      case "push": {
        const branchKeys = findTaskKeys(event.branch, { caseInsensitive: true });
        const byKey = new Map<string, GitCommit[]>();
        for (const commit of event.commits) {
          for (const key of new Set([...findTaskKeys(commit.message), ...branchKeys])) {
            byKey.set(key, [...(byKey.get(key) ?? []), commit]);
          }
        }
        const found = await this.tasksFor(tx, ctx.projectId, [...byKey.keys(), ...branchKeys]);
        for (const task of found) {
          if (branchKeys.includes(task.key)) await this.linkBranch(tx, ctx, task, event.branch, event.branchUrl);
          let added = 0;
          for (const c of byKey.get(task.key) ?? []) {
            const inserted = await this.upsertLink(tx, ctx, task.id, {
              kind: "commit",
              externalId: c.sha.slice(0, 7),
              title: firstLine(c.message),
              url: c.url,
              state: null,
              authoredAt: c.at,
            });
            if (inserted) added++;
          }
          if (added > 0) {
            await this.record(tx, ctx, task, "task.git_link", null, {
              provider: ctx.provider,
              kind: "commit",
              count: added,
              branch: event.branch,
            });
          }
        }
        return found.map((t) => t.key);
      }

      case "branch": {
        const found = await this.tasksFor(tx, ctx.projectId, findTaskKeys(event.branch, { caseInsensitive: true }));
        for (const task of found) await this.linkBranch(tx, ctx, task, event.branch, event.branchUrl);
        return found.map((t) => t.key);
      }

      case "pr": {
        const branchKeys = event.branch ? findTaskKeys(event.branch, { caseInsensitive: true }) : [];
        const found = await this.tasksFor(tx, ctx.projectId, [...findTaskKeys(event.title), ...branchKeys]);
        for (const task of found) {
          if (event.branch && event.branchUrl && branchKeys.includes(task.key)) {
            await this.linkBranch(tx, ctx, task, event.branch, event.branchUrl);
          }
          const [prior] = await tx
            .select({ state: gitLinks.state })
            .from(gitLinks)
            .where(
              and(
                eq(gitLinks.taskId, task.id),
                eq(gitLinks.provider, ctx.provider),
                eq(gitLinks.kind, "pr"),
                eq(gitLinks.repo, ctx.repo),
                eq(gitLinks.externalId, event.number),
              ),
            );
          await this.upsertLink(tx, ctx, task.id, {
            kind: "pr",
            externalId: event.number,
            title: event.title,
            url: event.url,
            state: event.state,
            authoredAt: null,
          });
          if (prior?.state !== event.state) {
            await this.record(tx, ctx, task, "task.git_link", null, {
              provider: ctx.provider,
              kind: "pr",
              number: event.number,
              title: event.title,
              state: event.state,
              url: event.url,
            });
          }
          if (event.action === "opened" && OPEN_MOVES_FROM.includes(task.status)) {
            await this.setStatus(tx, ctx, task, "in_review");
          } else if (event.action === "merged" && MERGE_MOVES_FROM.includes(task.status)) {
            await this.setStatus(tx, ctx, task, "done");
          }
        }
        return found.map((t) => t.key);
      }
    }
  }

  /** Keys from other projects are ignored: a repo only ever links into its own project. */
  private async tasksFor(tx: Tx, projectId: string, keys: string[]): Promise<Task[]> {
    const unique = [...new Set(keys)];
    if (unique.length === 0) return [];
    return tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), inArray(tasks.key, unique), isNull(tasks.deletedAt)));
  }

  /** Returns true when the row is new, so redelivered webhooks don't repeat activity entries. */
  private async upsertLink(
    tx: Tx,
    ctx: Ctx,
    taskId: string,
    link: { kind: "commit" | "pr" | "branch"; externalId: string; title: string; url: string; state: string | null; authoredAt: Date | null },
  ) {
    const [row] = await tx
      .insert(gitLinks)
      .values({ taskId, provider: ctx.provider, repo: ctx.repo, ...link })
      .onConflictDoUpdate({
        target: [gitLinks.taskId, gitLinks.provider, gitLinks.kind, gitLinks.repo, gitLinks.externalId],
        set: { title: link.title, url: link.url, state: link.state },
      })
      .returning({ inserted: sql<boolean>`xmax = 0` });
    return Boolean(row?.inserted);
  }

  private async linkBranch(tx: Tx, ctx: Ctx, task: Task, branch: string, url: string) {
    const inserted = await this.upsertLink(tx, ctx, task.id, {
      kind: "branch",
      externalId: branch,
      title: branch,
      url,
      state: null,
      authoredAt: null,
    });
    if (task.branch !== branch) {
      await tx.update(tasks).set({ branch }).where(eq(tasks.id, task.id));
      task.branch = branch;
    }
    if (inserted) await this.record(tx, ctx, task, "task.git_link", null, { provider: ctx.provider, kind: "branch", branch });
  }

  private async setStatus(tx: Tx, ctx: Ctx, task: Task, status: TaskStatus) {
    const completedAt = status === "done" ? new Date() : null;
    const [updated] = await tx.update(tasks).set({ status, completedAt }).where(eq(tasks.id, task.id)).returning();
    await this.record(tx, ctx, task, "task.update", { status: task.status }, { status });
    const labels = await tx.select({ id: taskLabels.labelId }).from(taskLabels).where(eq(taskLabels.taskId, task.id));
    await this.audit.revision(tx, ctx.actor, {
      entityType: "task",
      entityId: task.id,
      snapshot: taskSnapshot(updated!, labels.map((l) => l.id)),
      summary: `${ctx.actor.name}: ${status === "done" ? "merged" : "opened PR"}`,
    });
    task.status = status;
  }

  private record(tx: Tx, ctx: Ctx, task: Task, action: string, before: unknown, after: unknown) {
    return this.audit.record(tx, ctx.actor, {
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      action,
      entityType: "task",
      entityId: task.id,
      entityLabel: `${task.key} ${task.title}`,
      before,
      after,
    });
  }
}

interface Ctx {
  provider: Provider;
  repo: string;
  projectId: string;
  workspaceId: string;
  actor: Actor;
}
