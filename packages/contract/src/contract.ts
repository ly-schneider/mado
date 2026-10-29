import { oc, type } from "@orpc/contract";
import { z } from "zod";
import {
  EXPIRY_OPTIONS,
  GRANT_LEVELS,
  LABEL_COLORS,
  LEAD_STAGES,
  PRIORITIES,
  PROJECT_KEY_RE,
  RESOURCE_TYPES,
  TASK_STATUSES,
  TASK_TYPES,
} from "./domain";
import type * as T from "./types";

const uuid = z.uuid();
const ok = type<{ ok: true }>();

const grantInput = z.object({
  agentName: z.string().trim().min(1).max(80),
  projectScope: z.enum(["listed", "all"]),
  allLevel: z.enum(GRANT_LEVELS),
  projects: z.array(z.object({ projectId: uuid, level: z.enum(GRANT_LEVELS) })),
  resourceTypes: z.array(z.enum(RESOURCE_TYPES)).min(1),
  expiry: z.enum(EXPIRY_OPTIONS),
});

const taskFilter = z.object({
  labelIds: z.array(uuid).optional(),
  epicIds: z.array(uuid).optional(),
  assignee: z.array(z.string()).optional(), // "user:<id>" | "agent:<grantId>" | "none"
  statuses: z.array(z.enum(TASK_STATUSES)).optional(),
  types: z.array(z.enum(TASK_TYPES)).optional(),
});

const taskPatch = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(200_000).optional(),
  type: z.enum(TASK_TYPES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignee: z.string().nullable().optional(), // "user:<id>" | "agent:<grantId>" | null
  labelIds: z.array(uuid).optional(),
  epicId: uuid.nullable().optional(),
  dueDate: z.iso.date().nullable().optional(),
  sortOrder: z.number().optional(),
});

export const contract = {
  auth: {
    setupStatus: oc.output(type<T.SetupStatus>()),
    /** Creates the owner account. Only allowed while no user exists. */
    setup: oc
      .input(z.object({ name: z.string().trim().min(1), email: z.email(), password: z.string().min(10) }))
      .output(type<T.Me>()),
    login: oc.input(z.object({ email: z.email(), password: z.string().min(1) })).output(type<T.Me>()),
    logout: oc.output(ok),
    me: oc.output(type<T.Me | null>()),
    updateProfile: oc
      .input(
        z.object({
          name: z.string().trim().min(1).optional(),
          theme: z.enum(["system", "dark", "light"]).optional(),
          accent: z.enum(["lamp", "sora", "ai", "shu"]).optional(),
        }),
      )
      .output(type<T.Me>()),
    changePassword: oc
      .input(z.object({ current: z.string(), next: z.string().min(10) }))
      .output(ok),
  },

  workspace: {
    list: oc.output(type<T.Workspace[]>()),
    create: oc
      .input(
        z.object({
          name: z.string().trim().min(1).max(60),
          project: z.object({ name: z.string().trim().min(1).max(60), key: z.string().regex(PROJECT_KEY_RE) }),
        }),
      )
      .output(type<T.Workspace>()),
    update: oc.input(z.object({ id: uuid, name: z.string().trim().min(1).max(60) })).output(type<T.Workspace>()),
    /** Owner only. Soft delete: the workspace disappears for everyone; data stays in the database. */
    delete: oc.input(z.object({ id: uuid, confirmName: z.string() })).output(ok),
    members: oc.input(z.object({ workspaceId: uuid })).output(type<T.Member[]>()),
    removeMember: oc.input(z.object({ workspaceId: uuid, userId: uuid })).output(ok),
    invites: oc.input(z.object({ workspaceId: uuid })).output(type<T.Invite[]>()),
    createInvite: oc
      .input(z.object({ workspaceId: uuid, email: z.email().optional(), role: z.enum(["owner", "member"]).default("member") }))
      .output(type<T.Invite>()),
    revokeInvite: oc.input(z.object({ id: uuid })).output(ok),
    /** Public: preview an invite by token. */
    previewInvite: oc.input(z.object({ token: z.string() })).output(type<T.InvitePreview>()),
    /** Public: accept an invite, creating the account if needed. */
    acceptInvite: oc
      .input(
        z.object({
          token: z.string(),
          account: z.object({ name: z.string().trim().min(1), email: z.email(), password: z.string().min(10) }).optional(),
        }),
      )
      .output(type<{ workspaceId: string }>()),
  },

  project: {
    create: oc
      .input(z.object({ workspaceId: uuid, name: z.string().trim().min(1).max(60), key: z.string().regex(PROJECT_KEY_RE) }))
      .output(type<T.Project>()),
    update: oc
      .input(z.object({ id: uuid, name: z.string().trim().min(1).max(60).optional(), description: z.string().max(2000).optional() }))
      .output(type<T.Project>()),
    delete: oc.input(z.object({ id: uuid })).output(ok),
    keyAvailable: oc.input(z.object({ key: z.string() })).output(type<{ available: boolean }>()),
    labels: oc.input(z.object({ projectId: uuid })).output(type<T.Label[]>()),
    createLabel: oc
      .input(z.object({ projectId: uuid, name: z.string().trim().min(1).max(40), color: z.enum(LABEL_COLORS) }))
      .output(type<T.Label>()),
    updateLabel: oc
      .input(z.object({ id: uuid, name: z.string().trim().min(1).max(40).optional(), color: z.enum(LABEL_COLORS).optional() }))
      .output(type<T.Label>()),
    deleteLabel: oc.input(z.object({ id: uuid })).output(ok),
    repos: oc.input(z.object({ projectId: uuid })).output(type<T.Repo[]>()),
    addRepo: oc
      .input(z.object({ projectId: uuid, provider: z.enum(["github", "gitlab"]), fullName: z.string().trim().min(3) }))
      .output(type<T.Repo>()),
    removeRepo: oc.input(z.object({ id: uuid })).output(ok),
  },

  task: {
    list: oc
      .input(z.object({ projectId: uuid, filter: taskFilter.optional() }))
      .output(type<T.TaskSummary[]>()),
    mine: oc
      .input(z.object({ tab: z.enum(["assigned", "created", "agents"]) }))
      .output(type<T.TaskSummary[]>()),
    epics: oc.input(z.object({ projectId: uuid })).output(type<T.TaskSummary[]>()),
    get: oc.input(z.object({ key: z.string() })).output(type<T.TaskDetail>()),
    create: oc
      .input(
        taskPatch.extend({
          projectId: uuid,
          title: z.string().trim().min(1).max(300),
          docIds: z.array(uuid).optional(),
          /** Client generated so the optimistic row and the server row share an ID. */
          clientId: uuid.optional(),
        }),
      )
      .output(type<T.TaskSummary>()),
    update: oc.input(z.object({ id: uuid, patch: taskPatch })).output(type<T.TaskSummary>()),
    delete: oc.input(z.object({ id: uuid })).output(ok),
    linkDoc: oc.input(z.object({ taskId: uuid, docId: uuid })).output(ok),
    unlinkDoc: oc.input(z.object({ taskId: uuid, docId: uuid })).output(ok),
    comment: oc.input(z.object({ taskId: uuid, body: z.string().trim().min(1).max(20_000) })).output(type<T.Comment>()),
    deleteComment: oc.input(z.object({ id: uuid })).output(ok),
    /** AI: draft a task from one sentence. Needs an OpenRouter key. */
    draft: oc
      .input(z.object({ projectId: uuid, sentence: z.string().trim().min(3).max(2000) }))
      .output(type<T.TaskDraft>()),
  },

  doc: {
    tree: oc.input(z.object({ workspaceId: uuid })).output(type<T.DocNode[]>()),
    get: oc.input(z.object({ id: uuid })).output(type<T.Doc>()),
    create: oc
      .input(
        z.object({
          workspaceId: uuid,
          projectId: uuid.nullable().optional(),
          parentId: uuid.nullable().optional(),
          title: z.string().trim().max(200).default("Untitled"),
          content: z.string().max(1_000_000).default(""),
          clientId: uuid.optional(),
        }),
      )
      .output(type<T.DocNode>()),
    /** Debounced autosave. A revision is written when the actor changes, after 2 min, or when `checkpoint` is set. */
    save: oc
      .input(
        z.object({
          id: uuid,
          title: z.string().trim().max(200).optional(),
          content: z.string().max(1_000_000).optional(),
          baseRevision: z.number().int().optional(),
          checkpoint: z.boolean().optional(),
        }),
      )
      .output(type<{ revisionNumber: number; revisionCount: number; updatedAt: string }>()),
    move: oc
      .input(z.object({ id: uuid, parentId: uuid.nullable(), sortOrder: z.number() }))
      .output(ok),
    delete: oc.input(z.object({ id: uuid })).output(ok),
    favorite: oc.input(z.object({ id: uuid, on: z.boolean() })).output(ok),
    favorites: oc.input(z.object({ workspaceId: uuid })).output(type<T.DocNode[]>()),
    resolveTitle: oc
      .input(z.object({ workspaceId: uuid, title: z.string() }))
      .output(type<{ id: string } | null>()),
    /** Markdown export of one page with its sub-pages, or of a whole project. */
    export: oc
      .input(z.object({ docId: uuid.optional(), projectId: uuid.optional(), workspaceId: uuid }))
      .output(type<{ files: { path: string; content: string }[] }>()),
    summarize: oc.input(z.object({ id: uuid })).output(type<{ summary: string; model: string }>()),
  },

  revision: {
    list: oc
      .input(z.object({ entityType: z.enum(["doc", "task", "lead"]), entityId: uuid }))
      .output(type<T.RevisionSummary[]>()),
    get: oc.input(z.object({ id: uuid })).output(type<T.Revision>()),
    /** Restoring adds a new revision on top. Nothing is overwritten. */
    restore: oc.input(z.object({ id: uuid })).output(ok),
  },

  share: {
    list: oc.input(z.object({ workspaceId: uuid, docId: uuid.optional() })).output(type<T.ShareLink[]>()),
    create: oc
      .input(
        z.object({
          docId: uuid,
          name: z.string().trim().min(1).max(60),
          type: z.enum(["view", "edit"]),
          pin: z.string().regex(/^\d{4,8}$/).optional(),
          expiry: z.enum(EXPIRY_OPTIONS),
        }),
      )
      .output(type<T.ShareLink>()),
    revoke: oc.input(z.object({ id: uuid })).output(ok),
  },

  /** Public guest API behind share tokens. No login. */
  guest: {
    open: oc.input(z.object({ token: z.string(), pin: z.string().optional() })).output(type<T.GuestSession>()),
    get: oc.input(z.object({ token: z.string(), pin: z.string().optional(), docId: uuid })).output(type<T.Doc>()),
    save: oc
      .input(
        z.object({
          token: z.string(),
          pin: z.string().optional(),
          docId: uuid,
          title: z.string().max(200).optional(),
          content: z.string().max(1_000_000).optional(),
        }),
      )
      .output(type<{ revisionNumber: number; updatedAt: string }>()),
    create: oc
      .input(z.object({ token: z.string(), pin: z.string().optional(), parentId: uuid, title: z.string().trim().min(1).max(200) }))
      .output(type<T.DocNode>()),
    delete: oc.input(z.object({ token: z.string(), pin: z.string().optional(), docId: uuid })).output(ok),
  },

  search: {
    query: oc
      .input(
        z.object({
          workspaceId: uuid,
          q: z.string().max(200),
          types: z.array(z.enum(["tasks", "docs", "leads"])).optional(),
          limit: z.number().int().min(1).max(50).default(8),
        }),
      )
      .output(type<T.SearchResults>()),
  },

  trash: {
    list: oc.input(z.object({ workspaceId: uuid })).output(type<T.TrashItem[]>()),
    restore: oc.input(z.object({ entityType: z.enum(["task", "doc", "comment", "lead", "label", "project"]), id: uuid })).output(ok),
    /** Owner only, UI only. Never reachable from MCP. */
    purge: oc.input(z.object({ entityType: z.enum(["task", "doc", "comment", "lead", "label", "project"]), id: uuid })).output(ok),
    empty: oc.input(z.object({ workspaceId: uuid })).output(type<{ purged: number }>()),
  },

  audit: {
    list: oc
      .input(
        z.object({
          workspaceId: uuid.optional(),
          grantId: z.string().optional(),
          entityId: z.string().optional(),
          limit: z.number().int().max(200).default(50),
        }),
      )
      .output(type<T.AuditEntry[]>()),
  },

  agents: {
    list: oc.output(type<T.AgentGrant[]>()),
    /** Active agents of every member, for the assignee picker. */
    assignable: oc.input(z.object({ workspaceId: uuid })).output(type<T.AssignableAgent[]>()),
    get: oc.input(z.object({ id: z.string() })).output(type<T.AgentGrant>()),
    update: oc.input(z.object({ id: z.string(), grant: grantInput.partial() })).output(type<T.AgentGrant>()),
    revoke: oc.input(z.object({ id: z.string() })).output(ok),
    sessions: oc.input(z.object({ grantId: z.string() })).output(type<T.AgentSession[]>()),
    /** One-click undo of every write in an agent run. */
    revertSession: oc.input(z.object({ sessionId: z.string() })).output(type<{ reverted: number; skipped: number }>()),
    createToken: oc.input(grantInput).output(type<{ grant: T.AgentGrant; token: string }>()),
    activeSessions: oc.output(type<{ sessionId: string; agentName: string; grantId: string; writes: number; lastTaskKey: string | null; lastActiveAt: string }[]>()),
  },

  oauth: {
    consent: oc.input(z.object({ requestId: z.string() })).output(type<T.ConsentRequest>()),
    approve: oc.input(z.object({ requestId: z.string(), grant: grantInput })).output(type<{ redirectTo: string }>()),
    deny: oc.input(z.object({ requestId: z.string() })).output(type<{ redirectTo: string }>()),
  },

  inbox: {
    list: oc.input(z.object({ workspaceId: uuid.optional(), archived: z.boolean().default(false) })).output(type<T.Notification[]>()),
    unread: oc.output(type<{ count: number }>()),
    markRead: oc.input(z.object({ ids: z.array(uuid), read: z.boolean().default(true) })).output(ok),
    archive: oc.input(z.object({ ids: z.array(uuid) })).output(ok),
  },

  crm: {
    list: oc.input(z.object({ projectId: uuid })).output(type<T.LeadSummary[]>()),
    get: oc.input(z.object({ id: uuid })).output(type<T.Lead>()),
    create: oc
      .input(
        z.object({
          projectId: uuid,
          company: z.object({ name: z.string().trim().min(1), location: z.string().default(""), details: z.string().default("") }),
          contact: z.object({ name: z.string().trim().min(1), email: z.string().default(""), role: z.string().default("") }).optional(),
          stage: z.enum(LEAD_STAGES).default("new"),
          source: z.string().default(""),
          notes: z.string().default(""),
          clientId: uuid.optional(),
        }),
      )
      .output(type<T.LeadSummary>()),
    update: oc
      .input(
        z.object({
          id: uuid,
          patch: z.object({
            stage: z.enum(LEAD_STAGES).optional(),
            source: z.string().optional(),
            notes: z.string().optional(),
            lastContactAt: z.iso.date().nullable().optional(),
            lastContactNote: z.string().optional(),
            sortOrder: z.number().optional(),
            company: z.object({ name: z.string().optional(), location: z.string().optional(), details: z.string().optional(), website: z.string().optional() }).optional(),
            contact: z.object({ name: z.string().optional(), email: z.string().optional(), role: z.string().optional(), phone: z.string().optional() }).optional(),
          }),
        }),
      )
      .output(type<T.LeadSummary>()),
    delete: oc.input(z.object({ id: uuid })).output(ok),
    analyze: oc.input(z.object({ id: uuid })).output(type<T.Lead>()),
    draftEmail: oc
      .input(z.object({ id: uuid, language: z.enum(["de", "en"]).default("de"), instructions: z.string().max(1000).optional() }))
      .output(type<T.Lead>()),
  },

  settings: {
    instance: oc.output(type<T.InstanceInfo>()),
    ai: oc.output(type<T.AiSettings>()),
    updateAi: oc
      .input(
        z.object({
          apiKey: z.string().nullable().optional(),
          models: z
            .object({ taskDraft: z.string(), docSummary: z.string(), leadAnalysis: z.string(), emailDraft: z.string() })
            .partial()
            .optional(),
        }),
      )
      .output(type<T.AiSettings>()),
  },
};

export type Contract = typeof contract;
