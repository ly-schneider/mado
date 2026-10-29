import {
  LEAD_STAGES,
  PRIORITIES,
  RESOURCE_TYPES,
  TASK_STATUSES,
  TASK_TYPES,
  type DocNode,
  type TaskDetail,
  type TaskSummary,
} from "@mado/contract";
import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { config } from "../config";
import type { Actor } from "../lib/actor";
import type { RouterService } from "../rpc/router.service";
import type { AgentService, GrantProjectInfo } from "../services/agent.service";

type AgentActor = Extract<Actor, { type: "agent" }>;
type Client = ReturnType<RouterService["clientFor"]>;

export interface ToolDeps {
  router: RouterService;
  agents: AgentService;
}

interface Ctx {
  actor: AgentActor;
  client: Client;
  ip: string | null;
  deps: ToolDeps;
}

/** The controller puts the freshly authenticated actor on every request, so grant edits apply per call. */
export function ctxFrom(extra: { authInfo?: { extra?: Record<string, unknown> } }, deps: ToolDeps): Ctx {
  const actor = extra.authInfo?.extra?.actor as AgentActor | undefined;
  if (!actor) throw new ToolError("Not authenticated");
  const ip = (extra.authInfo?.extra?.ip as string | null | undefined) ?? null;
  return { actor, client: deps.router.clientFor(actor, ip), ip, deps };
}

/** An error the agent can act on, shown verbatim. */
export class ToolError extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRASH_NOTE = "Deletes are soft: the item goes to the Trash and the user can restore it for 30 days. Nothing can be purged via MCP.";

export function toolError(e: unknown): CallToolResult {
  let text: string;
  if (e instanceof ToolError) {
    text = e.message;
  } else if (e instanceof ORPCError) {
    const data = (e.data ?? {}) as { error?: string; required?: { project?: string; level?: string; resource?: string }; issues?: { path?: (string | number)[]; message: string }[] };
    if (data.error === "insufficient_scope") {
      const r = data.required ?? {};
      text =
        `insufficient_scope: this agent's grant needs "${r.level ?? "?"}" access to ${r.resource ?? "this resource"}` +
        `${r.project ? ` on ${r.project}` : ""}. Ask the user to upgrade the grant in Mado › Settings › Connected agents, ` +
        "then retry. You cannot change your own privileges.";
    } else if (e.code === "NOT_IMPLEMENTED") {
      text = "This operation is not available on this Mado server yet.";
    } else if (data.issues?.length) {
      text = `Invalid input: ${data.issues.map((i) => `${i.path?.join(".") || "input"}: ${i.message}`).join("; ")}`;
    } else {
      text = `${e.code}: ${e.message}`;
    }
  } else {
    console.error("mcp tool failed", e);
    text = "Internal error in Mado. Try again later.";
  }
  return { isError: true, content: [{ type: "text", text }] };
}

const out = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

// ── Resolution helpers ──────────────────────────────────────────────

async function projects(ctx: Ctx) {
  return ctx.deps.agents.agentProjects(ctx.actor);
}

async function project(ctx: Ctx, key: string): Promise<GrantProjectInfo> {
  const found = (await projects(ctx)).find((p) => p.key === key.trim().toUpperCase());
  if (!found) throw new ToolError(`Project ${key} not found or not covered by this grant. Call list_projects to see what you can access.`);
  return found;
}

const taskUrl = (p: { workspaceSlug: string }, key: string) => `${config.publicUrl}/${p.workspaceSlug}/t/${key}`;
const docUrl = (p: { workspaceSlug: string }, id: string) => `${config.publicUrl}/${p.workspaceSlug}/wiki/${id}`;

async function workspaceIds(ctx: Ctx, projectKey?: string) {
  if (projectKey) return [(await project(ctx, projectKey)).workspaceId];
  return [...new Set((await projects(ctx)).map((p) => p.workspaceId))];
}

async function resolveDoc(ctx: Ctx, ref: string, projectKey?: string): Promise<string> {
  if (UUID_RE.test(ref)) return ref;
  for (const workspaceId of await workspaceIds(ctx, projectKey)) {
    const hit = await ctx.client.doc.resolveTitle({ workspaceId, title: ref });
    if (hit) return hit.id;
  }
  throw new ToolError(`No page titled "${ref}". Use list_docs or search to find it.`);
}

async function resolveTaskId(ctx: Ctx, key: string) {
  return (await ctx.client.task.get({ key: key.trim().toUpperCase() })).id;
}

async function resolveAssignee(ctx: Ctx, workspaceId: string, value: string): Promise<string | null> {
  const v = value.trim();
  if (v === "me") return `agent:${ctx.actor.grant.id}`;
  if (v === "none" || v === "") return null;
  if (/^(user|agent):/.test(v)) return v;
  const members = await ctx.client.workspace.members({ workspaceId });
  const m = members.find((m) => m.email.toLowerCase() === v.toLowerCase() || m.name.toLowerCase() === v.toLowerCase());
  if (!m) throw new ToolError(`No workspace member "${v}". Members: ${members.map((m) => `${m.name} <${m.email}>`).join(", ")}`);
  return `user:${m.userId}`;
}

async function resolveLabels(ctx: Ctx, projectId: string, names: string[]) {
  const labels = await ctx.client.project.labels({ projectId });
  return names.map((name) => {
    const l = labels.find((l) => l.name.toLowerCase() === name.trim().toLowerCase());
    if (!l) throw new ToolError(`Unknown label "${name}". Labels in this project: ${labels.map((l) => l.name).join(", ") || "none"}`);
    return l.id;
  });
}

const summarizeTask = (t: TaskSummary) => ({
  key: t.key,
  title: t.title,
  type: t.type,
  status: t.status,
  priority: t.priority,
  assignee: t.assignee ? `${t.assignee.type}:${t.assignee.name}` : null,
  labels: t.labels.map((l) => l.name),
  epic: t.epic?.key ?? null,
  dueDate: t.dueDate,
  updatedAt: t.updatedAt,
});

function renderTask(t: TaskDetail, url: string) {
  return {
    ...summarizeTask(t),
    url,
    project: t.project.key,
    description: t.description,
    branch: t.branch,
    linkedDocs: t.linkedDocs.map((d) => ({ id: d.id, title: d.title, path: d.path })),
    comments: t.comments.map((c) => ({ by: `${c.actor.type}:${c.actor.name}`, at: c.createdAt, body: c.body })),
    git: t.git.map((g) => ({ kind: g.kind, repo: g.repo, id: g.externalId, title: g.title, state: g.state, url: g.url })),
    children: t.children.map((c) => `${c.key} ${c.title} [${c.status}]`),
  };
}

function renderTree(nodes: DocNode[]) {
  const byParent = new Map<string | null, DocNode[]>();
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    const parent = n.parentId && ids.has(n.parentId) ? n.parentId : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), n]);
  }
  const lines: string[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const n of (byParent.get(parent) ?? []).sort((a, b) => a.sortOrder - b.sortOrder)) {
      lines.push(`${"  ".repeat(depth)}- ${n.title}${n.kind === "folder" ? "/" : ""} (id: ${n.id})`);
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.join("\n") || "(no pages)";
}

// ── Tools ───────────────────────────────────────────────────────────

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const softDelete = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

export function registerTools(server: McpServer, deps: ToolDeps) {
  const tool = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    annotations: Record<string, boolean>,
    run: (args: z.infer<z.ZodObject<S>>, ctx: Ctx) => Promise<unknown>,
  ) => {
    server.registerTool(name, { description, inputSchema: shape, annotations }, (async (args: z.infer<z.ZodObject<S>>, extra: Parameters<typeof ctxFrom>[0]) => {
      try {
        return out(await run(args, ctxFrom(extra, deps)));
      } catch (e) {
        return toolError(e);
      }
    }) as never);
  };

  const projectKey = z.string().describe("Project key, e.g. GAT");
  const taskKey = z.string().describe("Task key, e.g. GAT-109");
  const docRef = z.string().describe("Page id (uuid) or page title, optionally as a path like Folder/Page");

  tool("whoami", "Show who you are in Mado: your agent name, grant id, this session id, and exactly which projects, levels (read/write/delete) and resource types (docs, tasks, comments, crm) your grant allows. Call this first if unsure what you may do.", {}, readOnly, async (_args, ctx) => {
    const g = ctx.actor.grant;
    return {
      agentName: ctx.actor.name,
      grantId: g.id,
      sessionId: ctx.actor.sessionId,
      projectScope: g.projectScope === "all" ? `all projects of the user, including future ones, at ${g.allLevel}` : "listed projects",
      resourceTypes: g.resourceTypes,
      projects: (await projects(ctx)).map((p) => ({ key: p.key, name: p.name, workspace: p.workspaceName, level: p.level })),
      notes: [
        "read < write < delete. delete includes write.",
        TRASH_NOTE,
        "All your writes are logged as this agent and grouped in this session, so the user can revert the whole session.",
        "If a call fails with insufficient_scope, ask the user to upgrade the grant in Settings › Connected agents.",
      ],
    };
  });

  tool("list_projects", "List the projects this agent can access, with their key (used as task key prefix, e.g. GAT-109), workspace and your access level.", {}, readOnly, async (_args, ctx) =>
    (await projects(ctx)).map((p) => ({ key: p.key, name: p.name, workspace: p.workspaceName, level: p.level })),
  );

  tool(
    "search",
    "Full-text search across tasks, wiki pages and leads you can access. Matches task keys (GAT-109), titles and bodies in English and German.",
    {
      q: z.string().min(1).max(200).describe("Search text"),
      types: z.array(z.enum(["tasks", "docs", "leads"])).optional().describe("Limit to these result types"),
      project: projectKey.optional().describe("Only search the workspace of this project"),
      limit: z.number().int().min(1).max(50).optional(),
    },
    readOnly,
    async (args, ctx) => {
      const merged = { tasks: [] as unknown[], docs: [] as unknown[], leads: [] as unknown[] };
      for (const workspaceId of await workspaceIds(ctx, args.project)) {
        const r = await ctx.client.search.query({ workspaceId, q: args.q, types: args.types, limit: args.limit ?? 10 });
        merged.tasks.push(...r.tasks.map((t) => ({ key: t.key, title: t.title, status: t.status, snippet: t.snippet })));
        merged.docs.push(...r.docs.map((d) => ({ id: d.id, title: d.title, path: d.path, snippet: d.snippet })));
        merged.leads.push(...r.leads.map((l) => ({ id: l.id, company: l.company, contact: l.contact, stage: l.stage, snippet: l.snippet })));
      }
      return merged;
    },
  );

  // Tasks

  tool(
    "get_task",
    "Get one task by key with its description, linked wiki pages (read those before working on the task), comments, git commits/PRs and sub-tasks.",
    { key: taskKey },
    readOnly,
    async (args, ctx) => {
      const key = args.key.trim().toUpperCase();
      const t = await ctx.client.task.get({ key });
      const p = await project(ctx, t.project.key);
      if (ctx.actor.sessionId) await ctx.deps.agents.touchSession(ctx.actor.sessionId, key);
      return renderTask(t, taskUrl(p, key));
    },
  );

  tool(
    "list_tasks",
    "List tasks of a project. Filter by status, type or assignee. assignee \"me\" means tasks assigned to this agent.",
    {
      project: projectKey,
      status: z.array(z.enum(TASK_STATUSES)).optional(),
      type: z.array(z.enum(TASK_TYPES)).optional(),
      assignee: z.string().optional().describe('"me" (this agent), "none", or a member name/email'),
    },
    readOnly,
    async (args, ctx) => {
      const p = await project(ctx, args.project);
      const assignee = args.assignee ? await resolveAssignee(ctx, p.workspaceId, args.assignee) : undefined;
      const list = await ctx.client.task.list({
        projectId: p.id,
        filter: {
          statuses: args.status,
          types: args.type,
          assignee: args.assignee ? [assignee ?? "none"] : undefined,
        },
      });
      return list.map(summarizeTask);
    },
  );

  tool(
    "create_task",
    "Create a task in a project. Returns its key (e.g. GAT-110). Labels are matched by name; epic by key; linked docs by id or title. Write the description in Markdown and include acceptance criteria when you know them.",
    {
      project: projectKey,
      title: z.string().min(1).max(300),
      description: z.string().max(200_000).optional().describe("Markdown"),
      type: z.enum(TASK_TYPES).optional(),
      status: z.enum(TASK_STATUSES).optional(),
      priority: z.enum(PRIORITIES).optional(),
      labels: z.array(z.string()).optional().describe("Label names"),
      epic: taskKey.optional().describe("Key of the parent epic"),
      docs: z.array(z.string()).optional().describe("Wiki pages to link, by id or title"),
      assignee: z.string().optional().describe('"me" to assign yourself, or a member name/email'),
      dueDate: z.string().optional().describe("YYYY-MM-DD"),
    },
    write,
    async (args, ctx) => {
      const p = await project(ctx, args.project);
      const created = await ctx.client.task.create({
        projectId: p.id,
        title: args.title,
        description: args.description,
        type: args.type,
        status: args.status,
        priority: args.priority,
        labelIds: args.labels ? await resolveLabels(ctx, p.id, args.labels) : undefined,
        epicId: args.epic ? await resolveTaskId(ctx, args.epic) : undefined,
        docIds: args.docs ? await Promise.all(args.docs.map((d) => resolveDoc(ctx, d, args.project))) : undefined,
        assignee: args.assignee ? await resolveAssignee(ctx, p.workspaceId, args.assignee) : undefined,
        dueDate: args.dueDate,
      });
      return { key: created.key, id: created.id, url: taskUrl(p, created.key), task: summarizeTask(created) };
    },
  );

  tool(
    "update_task",
    "Update a task by key. Only the fields you pass change. Move it with status (backlog, todo, in_progress, in_review, done, canceled). assignee \"me\" assigns this agent, \"none\" unassigns. labels replaces the label set. Use append_description to add to the description without rewriting it.",
    {
      key: taskKey,
      title: z.string().min(1).max(300).optional(),
      description: z.string().max(200_000).optional().describe("Replaces the whole description (Markdown)"),
      append_description: z.string().max(50_000).optional().describe("Appended to the description after a blank line"),
      type: z.enum(TASK_TYPES).optional(),
      status: z.enum(TASK_STATUSES).optional(),
      priority: z.enum(PRIORITIES).optional(),
      assignee: z.string().optional(),
      labels: z.array(z.string()).optional(),
      epic: z.string().nullable().optional().describe("Epic key, or null to detach"),
      dueDate: z.string().nullable().optional(),
      link_docs: z.array(z.string()).optional().describe("Wiki pages (id or title) to link"),
    },
    write,
    async (args, ctx) => {
      const key = args.key.trim().toUpperCase();
      const t = await ctx.client.task.get({ key });
      const p = await project(ctx, t.project.key);
      let description = args.description;
      if (args.append_description) description = `${(description ?? t.description).trimEnd()}\n\n${args.append_description}`.trimStart();
      const patch = {
        title: args.title,
        description,
        type: args.type,
        status: args.status,
        priority: args.priority,
        assignee: args.assignee !== undefined ? await resolveAssignee(ctx, p.workspaceId, args.assignee) : undefined,
        labelIds: args.labels ? await resolveLabels(ctx, p.id, args.labels) : undefined,
        epicId: args.epic === undefined ? undefined : args.epic === null ? null : await resolveTaskId(ctx, args.epic),
        dueDate: args.dueDate,
      };
      const hasPatch = Object.values(patch).some((v) => v !== undefined);
      const updated = hasPatch ? await ctx.client.task.update({ id: t.id, patch }) : t;
      for (const ref of args.link_docs ?? []) {
        await ctx.client.task.linkDoc({ taskId: t.id, docId: await resolveDoc(ctx, ref, p.key) });
      }
      if (ctx.actor.sessionId) await ctx.deps.agents.touchSession(ctx.actor.sessionId, key);
      return { url: taskUrl(p, key), task: summarizeTask(updated) };
    },
  );

  tool("delete_task", `Delete a task by key. ${TRASH_NOTE} Needs the delete level.`, { key: taskKey }, softDelete, async (args, ctx) => {
    const key = args.key.trim().toUpperCase();
    await ctx.client.task.delete({ id: await resolveTaskId(ctx, key) });
    return `${key} moved to Trash. The user can restore it for 30 days.`;
  });

  tool(
    "comment_task",
    "Add a Markdown comment to a task, e.g. a progress report, a question for the user or a summary of what you changed (mention commits/PRs).",
    { key: taskKey, body: z.string().min(1).max(20_000) },
    write,
    async (args, ctx) => {
      const c = await ctx.client.task.comment({ taskId: await resolveTaskId(ctx, args.key), body: args.body });
      return { id: c.id, createdAt: c.createdAt };
    },
  );

  // Docs

  tool(
    "get_doc",
    "Read a wiki page (Markdown) by id or title. Project wiki pages hold architecture, decisions and runbooks: read the relevant ones before touching code.",
    { doc: docRef, project: projectKey.optional().describe("Narrows title lookup to this project's workspace") },
    readOnly,
    async (args, ctx) => {
      const d = await ctx.client.doc.get({ id: await resolveDoc(ctx, args.doc, args.project) });
      const path = d.path.map((p) => p.title).join(" / ");
      const meta = [`id: ${d.id}`, `path: ${path || d.title}`, `revision ${d.revisionNumber}`, `updated ${d.updatedAt}${d.updatedBy ? ` by ${d.updatedBy.name}` : ""}`];
      if (d.backlinks.length) meta.push(`linked from: ${d.backlinks.map((b) => b.key ?? b.title).join(", ")}`);
      return `# ${d.title}\n${meta.join(" · ")}\n\n${d.content}`;
    },
  );

  tool("list_docs", "List the wiki page tree of a project with page ids.", { project: projectKey }, readOnly, async (args, ctx) => {
    const p = await project(ctx, args.project);
    const tree = await ctx.client.doc.tree({ workspaceId: p.workspaceId });
    return renderTree(tree.filter((n) => n.projectId === p.id));
  });

  tool(
    "create_doc",
    "Create a wiki page or folder in a project. Content is Markdown; link other pages with [[Page title]] and tasks with their key (GAT-109). Folders only group pages and other folders, nested to any depth; they have no content.",
    {
      project: projectKey,
      kind: z.enum(["page", "folder"]).optional().describe("Defaults to page"),
      title: z.string().min(1).max(200),
      content: z.string().max(1_000_000).optional(),
      parent: docRef.optional().describe("Parent page id or title"),
    },
    write,
    async (args, ctx) => {
      const p = await project(ctx, args.project);
      const node = await ctx.client.doc.create({
        workspaceId: p.workspaceId,
        projectId: p.id,
        parentId: args.parent ? await resolveDoc(ctx, args.parent, args.project) : null,
        kind: args.kind ?? "page",
        title: args.title,
        content: args.content ?? "",
      });
      return { id: node.id, title: node.title, url: docUrl(p, node.id) };
    },
  );

  tool(
    "update_doc",
    "Change a wiki page. Pass content to replace the whole Markdown body, or append to add text at the end. Every save creates a revision the user can restore.",
    {
      doc: docRef,
      project: projectKey.optional(),
      title: z.string().min(1).max(200).optional(),
      content: z.string().max(1_000_000).optional().describe("New full Markdown content"),
      append: z.string().max(200_000).optional().describe("Markdown appended after a blank line"),
    },
    write,
    async (args, ctx) => {
      if (args.content !== undefined && args.append !== undefined) throw new ToolError("Pass either content or append, not both.");
      const id = await resolveDoc(ctx, args.doc, args.project);
      let content = args.content;
      let baseRevision: number | undefined;
      if (args.append !== undefined) {
        const current = await ctx.client.doc.get({ id });
        content = `${current.content.trimEnd()}\n\n${args.append}`.trimStart();
        baseRevision = current.revisionNumber;
      }
      const r = await ctx.client.doc.save({ id, title: args.title, content, baseRevision, checkpoint: true });
      return { id, revisionNumber: r.revisionNumber, updatedAt: r.updatedAt };
    },
  );

  tool("delete_doc", `Delete a wiki page and its sub-pages. ${TRASH_NOTE} Needs the delete level.`, { doc: docRef, project: projectKey.optional() }, softDelete, async (args, ctx) => {
    const id = await resolveDoc(ctx, args.doc, args.project);
    await ctx.client.doc.delete({ id });
    return `Page ${id} moved to Trash. The user can restore it for 30 days.`;
  });

  // CRM

  const company = z.object({ name: z.string().min(1), location: z.string().optional(), details: z.string().optional(), website: z.string().optional() });
  const contact = z.object({ name: z.string().min(1), email: z.string().optional(), role: z.string().optional(), phone: z.string().optional() });

  tool("list_leads", "List CRM leads of a project with company, contact and stage. Needs the crm resource type.", { project: projectKey }, readOnly, async (args, ctx) => {
    const p = await project(ctx, args.project);
    return (await ctx.client.crm.list({ projectId: p.id })).map((l) => ({
      id: l.id,
      company: l.company.name,
      contact: l.contact?.name ?? null,
      stage: l.stage,
      source: l.source,
      lastContactAt: l.lastContactAt,
    }));
  });

  tool("get_lead", "Get one CRM lead with notes, last contact and any AI analysis or email draft.", { id: z.string().uuid() }, readOnly, async (args, ctx) =>
    ctx.client.crm.get({ id: args.id }),
  );

  tool(
    "create_lead",
    `Create a CRM lead (company, optional contact, stage, source, notes). Stages: ${LEAD_STAGES.join(", ")}. Emails are never sent by Mado.`,
    {
      project: projectKey,
      company,
      contact: contact.optional(),
      stage: z.enum(LEAD_STAGES).optional(),
      source: z.string().optional(),
      notes: z.string().optional().describe("Markdown"),
    },
    write,
    async (args, ctx) => {
      const p = await project(ctx, args.project);
      const lead = await ctx.client.crm.create({
        projectId: p.id,
        company: { name: args.company.name, location: args.company.location ?? "", details: args.company.details ?? "" },
        contact: args.contact ? { name: args.contact.name, email: args.contact.email ?? "", role: args.contact.role ?? "" } : undefined,
        stage: args.stage ?? "new",
        source: args.source ?? "",
        notes: args.notes ?? "",
      });
      return { id: lead.id, company: lead.company.name, stage: lead.stage };
    },
  );

  tool(
    "update_lead",
    "Update a CRM lead: stage, notes, source, last contact date/note, company or contact fields. Only passed fields change.",
    {
      id: z.string().uuid(),
      stage: z.enum(LEAD_STAGES).optional(),
      source: z.string().optional(),
      notes: z.string().optional().describe("Replaces the notes"),
      lastContactAt: z.string().nullable().optional().describe("YYYY-MM-DD"),
      lastContactNote: z.string().optional(),
      company: company.partial().optional(),
      contact: contact.partial().optional(),
    },
    write,
    async (args, ctx) => {
      const { id, ...patch } = args;
      const lead = await ctx.client.crm.update({ id, patch });
      return { id: lead.id, company: lead.company.name, stage: lead.stage, updatedAt: lead.updatedAt };
    },
  );

  // Resources: wiki pages as mado://doc/<id>

  server.registerResource(
    "doc",
    new ResourceTemplate("mado://doc/{id}", { list: undefined }),
    { title: "Wiki page", description: "A Mado wiki page as Markdown", mimeType: "text/markdown" },
    async (uri, vars, extra) => {
      const ctx = ctxFrom(extra, deps);
      const id = String(Array.isArray(vars.id) ? vars.id[0] : vars.id);
      const d = await ctx.client.doc.get({ id });
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: `# ${d.title}\n\n${d.content}` }] };
    },
  );
}

export const SERVER_INSTRUCTIONS = `Mado is the user's workspace for wiki pages, tasks (keys like GAT-109) and CRM leads.
- Start with whoami or list_projects to see what this grant allows.
- Before working on a task, call get_task and read its linked docs with get_doc.
- Report progress with comment_task and move the task with update_task (status in_progress, in_review, done). Put the task key in commit messages so Mado links the commit.
- Every write is logged as this agent and grouped into one session the user can revert in one click.
- ${TRASH_NOTE}
- If a tool returns insufficient_scope, ask the user to upgrade the grant; never try to work around it.
- Supported resource types: ${RESOURCE_TYPES.join(", ")}.`;
