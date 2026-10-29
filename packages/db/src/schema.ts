import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** Soft delete columns. The app's Postgres role has no DELETE on tables that carry these. */
const softDelete = {
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedByType: text("deleted_by_type").$type<ActorType>(),
  deletedById: text("deleted_by_id"),
};

export type ActorType = "user" | "agent" | "guest" | "system";
export type Role = "owner" | "member";
export type TaskType = "task" | "bug" | "epic";
export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled";
export type Priority = "none" | "urgent" | "high" | "medium" | "low";
export type GrantLevel = "read" | "write" | "delete";
export type ResourceType = "docs" | "tasks" | "comments" | "crm";
export type LeadStage = "new" | "contacted" | "replied" | "qualified" | "won" | "lost";

// Both language configs plus 'simple' so keys like GAT-109 and German compounds both match.
const searchVector = (title: string, body: string) =>
  sql.raw(`setweight(to_tsvector('simple', coalesce(${title}, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(${title}, '')), 'A') ||
    setweight(to_tsvector('german', coalesce(${title}, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(${body}, '')), 'C') ||
    setweight(to_tsvector('german', coalesce(${body}, '')), 'C')`);

// ── Identity ────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  theme: text("theme").$type<"system" | "dark" | "light">().notNull().default("system"),
  accent: text("accent").$type<"lamp" | "sora" | "ai" | "shu">().notNull().default("lamp"),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256 of the cookie token
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// ── Workspaces and projects ─────────────────────────────────────────────

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: createdAt(),
  ...softDelete,
});

export const memberships = pgTable(
  "memberships",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").$type<Role>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const invites = pgTable("invites", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  tokenHash: text("token_hash").notNull().unique(),
  email: text("email"),
  role: text("role").$type<Role>().notNull().default("member"),
  createdById: uuid("created_by_id")
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedById: uuid("accepted_by_id").references(() => users.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const projects = pgTable(
  "projects",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    nextNumber: integer("next_number").notNull().default(1),
    sortOrder: doublePrecision("sort_order").notNull().default(0),
    createdAt: createdAt(),
    ...softDelete,
  },
  // Keys are unique per instance, including deleted projects, so IDs are never reused.
  (t) => [uniqueIndex("projects_key_idx").on(t.key)],
);

export const labels = pgTable(
  "labels",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    color: text("color").notNull().default("grey"),
    createdAt: createdAt(),
    ...softDelete,
  },
  (t) => [index("labels_project_idx").on(t.projectId)],
);

// ── Tasks ───────────────────────────────────────────────────────────────

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    number: integer("number").notNull(),
    key: text("key").notNull().unique(),
    type: text("type").$type<TaskType>().notNull().default("task"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").$type<TaskStatus>().notNull().default("todo"),
    priority: text("priority").$type<Priority>().notNull().default("none"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id),
    assigneeGrantId: text("assignee_grant_id"),
    epicId: uuid("epic_id"),
    dueDate: text("due_date"), // ISO date, no time
    branch: text("branch"),
    sortOrder: doublePrecision("sort_order").notNull().default(0),
    createdByType: text("created_by_type").$type<ActorType>().notNull(),
    createdById: text("created_by_id").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...softDelete,
    search: tsvector("search").generatedAlwaysAs(searchVector("key || ' ' || title", "description")),
  },
  (t) => [
    index("tasks_project_idx").on(t.projectId),
    index("tasks_epic_idx").on(t.epicId),
    index("tasks_assignee_idx").on(t.assigneeUserId),
    index("tasks_search_idx").using("gin", t.search),
  ],
);

export const taskLabels = pgTable(
  "task_labels",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    labelId: uuid("label_id")
      .notNull()
      .references(() => labels.id),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.labelId] })],
);

export const taskDocs = pgTable(
  "task_docs",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    docId: uuid("doc_id")
      .notNull()
      .references(() => docs.id),
    lastReadByAgentAt: timestamp("last_read_by_agent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.docId] })],
);

export const gitLinks = pgTable(
  "git_links",
  {
    id: id(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    provider: text("provider").$type<"github" | "gitlab">().notNull(),
    kind: text("kind").$type<"commit" | "pr" | "branch">().notNull(),
    externalId: text("external_id").notNull(), // sha, PR number or branch name
    title: text("title").notNull(),
    url: text("url").notNull(),
    state: text("state"), // open | merged | closed for PRs
    repo: text("repo").notNull(),
    authoredAt: timestamp("authored_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("git_links_task_idx").on(t.taskId),
    uniqueIndex("git_links_unique_idx").on(t.taskId, t.provider, t.kind, t.repo, t.externalId),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: id(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    body: text("body").notNull(),
    actorType: text("actor_type").$type<ActorType>().notNull(),
    actorId: text("actor_id").notNull(),
    sessionId: text("session_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...softDelete,
  },
  (t) => [index("comments_task_idx").on(t.taskId)],
);

// ── Wiki ────────────────────────────────────────────────────────────────

export const docs = pgTable(
  "docs",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    projectId: uuid("project_id").references(() => projects.id), // null = workspace-level page
    parentId: uuid("parent_id"),
    title: text("title").notNull().default("Untitled"),
    content: text("content").notNull().default(""),
    sortOrder: doublePrecision("sort_order").notNull().default(0),
    revisionNumber: integer("revision_number").notNull().default(0),
    updatedByType: text("updated_by_type").$type<ActorType>(),
    updatedById: text("updated_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...softDelete,
    search: tsvector("search").generatedAlwaysAs(searchVector("title", "content")),
  },
  (t) => [
    index("docs_workspace_idx").on(t.workspaceId),
    index("docs_parent_idx").on(t.parentId),
    index("docs_search_idx").using("gin", t.search),
  ],
);

/** Outgoing links found in docs and tasks: [[Page]] and KEY-123. Rebuilt on every save. */
export const refs = pgTable(
  "refs",
  {
    sourceType: text("source_type").$type<"doc" | "task">().notNull(),
    sourceId: uuid("source_id").notNull(),
    targetType: text("target_type").$type<"doc" | "task">().notNull(),
    targetId: uuid("target_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sourceType, t.sourceId, t.targetType, t.targetId] }),
    index("refs_target_idx").on(t.targetType, t.targetId),
  ],
);

export const favorites = pgTable(
  "favorites",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    docId: uuid("doc_id")
      .notNull()
      .references(() => docs.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.docId] })],
);

export const shareLinks = pgTable("share_links", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  docId: uuid("doc_id")
    .notNull()
    .references(() => docs.id),
  name: text("name").notNull(),
  type: text("type").$type<"view" | "edit">().notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  tokenEnc: text("token_enc").notNull(), // encrypted so the owner can copy the link again
  pinHash: text("pin_hash"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdById: uuid("created_by_id")
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
});

// ── History ─────────────────────────────────────────────────────────────

/** Append-only. The app role has neither UPDATE nor DELETE here. */
export const revisions = pgTable(
  "revisions",
  {
    id: id(),
    entityType: text("entity_type").$type<"doc" | "task" | "lead">().notNull(),
    entityId: uuid("entity_id").notNull(),
    number: integer("number").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    added: integer("added").notNull().default(0),
    removed: integer("removed").notNull().default(0),
    summary: text("summary"),
    actorType: text("actor_type").$type<ActorType>().notNull(),
    actorId: text("actor_id").notNull(),
    actorName: text("actor_name").notNull(),
    sessionId: text("session_id"),
    createdAt: createdAt(),
  },
  (t) => [index("revisions_entity_idx").on(t.entityType, t.entityId, t.number)],
);

/** Append-only. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    projectId: uuid("project_id"),
    actorType: text("actor_type").$type<ActorType>().notNull(),
    actorId: text("actor_id").notNull(),
    actorName: text("actor_name").notNull(),
    sessionId: text("session_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    entityLabel: text("entity_label").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_workspace_idx").on(t.workspaceId, t.createdAt),
    index("audit_actor_idx").on(t.actorType, t.actorId),
    index("audit_session_idx").on(t.sessionId),
    index("audit_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    workspaceId: uuid("workspace_id").notNull(),
    kind: text("kind").notNull(), // assigned | commented | status | mention | agent
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    actorType: text("actor_type").$type<ActorType>().notNull(),
    actorId: text("actor_id").notNull(),
    actorName: text("actor_name").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

// ── Agents and OAuth ────────────────────────────────────────────────────

export const oauthClients = pgTable("oauth_clients", {
  id: id(),
  clientId: text("client_id").notNull().unique(),
  name: text("name").notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  verified: boolean("verified").notNull().default(false),
  createdAt: createdAt(),
});

/**
 * One grant per connected agent. Tokens reference the grant, never the privileges,
 * so edits apply on the agent's next call.
 */
export const agentGrants = pgTable("agent_grants", {
  id: text("id").primaryKey(), // g_xxxx
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  kind: text("kind").$type<"oauth" | "pat" | "builtin">().notNull(),
  clientId: text("client_id"),
  clientName: text("client_name").notNull(),
  agentName: text("agent_name").notNull(),
  // 'all' covers every project the user can access, including future ones, at allLevel.
  projectScope: text("project_scope").$type<"listed" | "all">().notNull().default("listed"),
  allLevel: text("all_level").$type<GrantLevel>().notNull().default("read"),
  resourceTypes: jsonb("resource_types").$type<ResourceType[]>().notNull().default(["docs", "tasks", "comments", "crm"]),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  lastIp: text("last_ip"),
  createdAt: createdAt(),
});

export const agentGrantProjects = pgTable(
  "agent_grant_projects",
  {
    grantId: text("grant_id")
      .notNull()
      .references(() => agentGrants.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    level: text("level").$type<GrantLevel>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.grantId, t.projectId] })],
);

export const oauthCodes = pgTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  grantId: text("grant_id")
    .notNull()
    .references(() => agentGrants.id),
  clientId: text("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  resource: text("resource"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export const agentTokens = pgTable(
  "agent_tokens",
  {
    id: id(),
    grantId: text("grant_id")
      .notNull()
      .references(() => agentGrants.id),
    type: text("type").$type<"access" | "refresh" | "pat">().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("agent_tokens_grant_idx").on(t.grantId)],
);

export const agentSessions = pgTable("agent_sessions", {
  id: text("id").primaryKey(), // short hex shown in the UI
  grantId: text("grant_id")
    .notNull()
    .references(() => agentGrants.id),
  writes: integer("writes").notNull().default(0),
  lastTaskKey: text("last_task_key"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
  revertedAt: timestamp("reverted_at", { withTimezone: true }),
});

// ── Git ─────────────────────────────────────────────────────────────────

export const repos = pgTable(
  "repos",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    provider: text("provider").$type<"github" | "gitlab">().notNull(),
    fullName: text("full_name").notNull(), // owner/repo or group/project
    secretEnc: text("secret_enc").notNull(),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    createdAt: createdAt(),
    ...softDelete,
  },
  (t) => [uniqueIndex("repos_unique_idx").on(t.provider, t.fullName)],
);

// ── CRM ─────────────────────────────────────────────────────────────────

export const companies = pgTable(
  "companies",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    location: text("location").notNull().default(""),
    details: text("details").notNull().default(""), // e.g. "40 seats"
    website: text("website").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...softDelete,
  },
  (t) => [index("companies_project_idx").on(t.projectId)],
);

export const contacts = pgTable("contacts", {
  id: id(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  companyId: uuid("company_id").references(() => companies.id),
  name: text("name").notNull(),
  role: text("role").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  ...softDelete,
});

export const leads = pgTable(
  "leads",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    contactId: uuid("contact_id").references(() => contacts.id),
    stage: text("stage").$type<LeadStage>().notNull().default("new"),
    source: text("source").notNull().default(""),
    notes: text("notes").notNull().default(""),
    lastContactAt: text("last_contact_at"), // ISO date
    lastContactNote: text("last_contact_note").notNull().default(""),
    analysis: jsonb("analysis").$type<{ rows: { label: string; text: string }[]; model: string; ms: number } | null>(),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
    draft: jsonb("draft").$type<{ subject: string; body: string; language: string; model: string } | null>(),
    draftedAt: timestamp("drafted_at", { withTimezone: true }),
    sortOrder: doublePrecision("sort_order").notNull().default(0),
    createdByType: text("created_by_type").$type<ActorType>().notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...softDelete,
    search: tsvector("search").generatedAlwaysAs(searchVector("source", "notes")),
  },
  (t) => [index("leads_project_idx").on(t.projectId)],
);

// ── Settings ────────────────────────────────────────────────────────────

/** Instance-wide key/value settings. Secrets are stored encrypted (AES-GCM) in valueEnc. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  valueEnc: text("value_enc"),
  updatedAt: updatedAt(),
});
