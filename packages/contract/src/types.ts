import type {
  ActorType,
  ExpiryOption,
  GrantLevel,
  LabelColor,
  LeadStage,
  Priority,
  ResourceType,
  Role,
  TaskStatus,
  TaskType,
} from "./domain";

/** Dates cross the wire as ISO strings. */
export type ISODate = string;

export interface Actor {
  type: ActorType;
  id: string;
  name: string;
  /** Initials for users, null for agents (they render the agent glyph). */
  initials: string | null;
}

export type Accent = "lamp" | "sora" | "ai" | "shu";

export interface Me {
  id: string;
  email: string;
  name: string;
  initials: string;
  theme: "system" | "dark" | "light";
  accent: Accent;
}

export interface SetupStatus {
  needsSetup: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: Role;
  projects: Project[];
}

export interface Project {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  description: string;
  openTaskCount: number;
  /** Number the next task will get, e.g. 125 for GAT-125. */
  nextNumber: number;
}

export interface Label {
  id: string;
  projectId: string;
  name: string;
  color: LabelColor;
  taskCount: number;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  initials: string;
  role: Role;
  joinedAt: ISODate;
}

export interface Invite {
  id: string;
  email: string | null;
  role: Role;
  createdAt: ISODate;
  expiresAt: ISODate;
  acceptedAt: ISODate | null;
  revokedAt: ISODate | null;
  /** Only returned right after creation. */
  url?: string;
}

export interface InvitePreview {
  workspaceName: string;
  invitedBy: string;
  role: Role;
  email: string | null;
  expired: boolean;
}

export interface Assignee {
  type: "user" | "agent";
  id: string;
  name: string;
  initials: string | null;
}

export interface TaskSummary {
  id: string;
  key: string;
  projectId: string;
  type: TaskType;
  title: string;
  status: TaskStatus;
  priority: Priority;
  assignee: Assignee | null;
  labels: Pick<Label, "id" | "name" | "color">[];
  epic: { id: string; key: string; title: string } | null;
  dueDate: string | null;
  prNumber: string | null;
  sortOrder: number;
  updatedAt: ISODate;
  createdAt: ISODate;
}

export interface GitLink {
  id: string;
  provider: "github" | "gitlab";
  kind: "commit" | "pr" | "branch";
  externalId: string;
  title: string;
  url: string;
  state: string | null;
  repo: string;
  at: ISODate;
}

export interface LinkedDoc {
  id: string;
  title: string;
  path: string;
  lastReadByAgentAt: ISODate | null;
}

export interface Comment {
  id: string;
  body: string;
  actor: Actor;
  sessionId: string | null;
  createdAt: ISODate;
}

export interface ActivityEntry {
  id: string;
  actor: Actor;
  action: string;
  /** Human sentence fragment, e.g. "moved Todo → In progress". */
  text: string;
  via: string | null; // "MCP · session 7f3a", "GitHub"
  sessionId: string | null;
  createdAt: ISODate;
}

export interface TaskDetail extends TaskSummary {
  description: string;
  project: { id: string; key: string; name: string };
  createdBy: Actor;
  branch: string | null;
  linkedDocs: LinkedDoc[];
  git: GitLink[];
  comments: Comment[];
  activity: ActivityEntry[];
  /** Only for epics. */
  children: TaskSummary[];
  /** Neighbours in the list the user came from are computed client side; this is position in project. */
  agentAccess: { grantId: string; agentName: string; projects: string[]; level: GrantLevel; sessionId: string | null } | null;
}

export interface TaskDraft {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  type: TaskType;
  priority: Priority;
  epicId: string | null;
  labelIds: string[];
  docIds: string[];
  model: string;
}

export interface DocNode {
  id: string;
  title: string;
  parentId: string | null;
  projectId: string | null;
  sortOrder: number;
  hasChildren: boolean;
  updatedAt: ISODate;
}

export interface Backlink {
  type: "doc" | "task";
  id: string;
  title: string;
  /** Parent page title for docs, task title for tasks */
  subtitle: string;
  key: string | null;
}

export interface Doc {
  id: string;
  workspaceId: string;
  projectId: string | null;
  parentId: string | null;
  title: string;
  content: string;
  path: { id: string; title: string }[];
  revisionNumber: number;
  revisionCount: number;
  updatedAt: ISODate;
  updatedBy: Actor | null;
  favorite: boolean;
  backlinks: Backlink[];
  shareLinks: number;
  canEdit: boolean;
}

export interface RevisionSummary {
  id: string;
  number: number;
  actor: Actor;
  sessionId: string | null;
  summary: string | null;
  added: number;
  removed: number;
  createdAt: ISODate;
  current: boolean;
}

export interface Revision extends RevisionSummary {
  snapshot: { title: string; content: string } | Record<string, unknown>;
}

export interface ShareLink {
  id: string;
  name: string;
  type: "view" | "edit";
  url: string;
  hasPin: boolean;
  expiresAt: ISODate | null;
  revokedAt: ISODate | null;
  lastUsedAt: ISODate | null;
  createdAt: ISODate;
  docId: string;
  docTitle: string;
}

export interface GuestSession {
  linkName: string;
  type: "view" | "edit";
  rootId: string;
  workspaceName: string;
  tree: DocNode[];
  expiresAt: ISODate | null;
}

export interface SearchResults {
  tasks: (Pick<TaskSummary, "id" | "key" | "title" | "status" | "assignee"> & { snippet: string | null })[];
  docs: { id: string; title: string; path: string; snippet: string | null; updatedAt: ISODate }[];
  leads: { id: string; company: string; contact: string | null; stage: LeadStage; snippet: string | null }[];
  ms: number;
}

export interface TrashItem {
  entityType: "task" | "doc" | "comment" | "lead" | "label" | "project";
  id: string;
  title: string;
  subtitle: string;
  deletedAt: ISODate;
  deletedBy: Actor;
  purgeAt: ISODate;
}

export interface AuditEntry {
  id: string;
  actor: Actor;
  sessionId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  text: string;
  revertedAt: ISODate | null;
  createdAt: ISODate;
}

export interface GrantProject {
  projectId: string;
  key: string;
  name: string;
  level: GrantLevel;
}

export interface AgentGrant {
  id: string;
  kind: "oauth" | "pat" | "builtin";
  clientName: string;
  clientVerified: boolean;
  agentName: string;
  projectScope: "listed" | "all";
  allLevel: GrantLevel;
  projects: GrantProject[];
  resourceTypes: ResourceType[];
  expiresAt: ISODate | null;
  revokedAt: ISODate | null;
  lastUsedAt: ISODate | null;
  lastIp: string | null;
  createdAt: ISODate;
  status: "active" | "expired" | "revoked";
}

/** An agent any member connected, which can be assigned to tasks in this workspace. */
export interface AssignableAgent {
  grantId: string;
  agentName: string;
  ownerName: string;
  mine: boolean;
}

export interface AgentSession {
  id: string;
  grantId: string;
  agentName: string;
  writes: number;
  startedAt: ISODate;
  lastActiveAt: ISODate;
  revertedAt: ISODate | null;
  entries: AuditEntry[];
}

export interface ConsentRequest {
  requestId: string;
  client: { id: string; name: string; verified: boolean; redirectUri: string; registeredAt: ISODate };
  user: { name: string; role: Role };
  projects: (Project & { workspaceName: string })[];
}

export interface GrantInput {
  agentName: string;
  projectScope: "listed" | "all";
  allLevel: GrantLevel;
  projects: { projectId: string; level: GrantLevel }[];
  resourceTypes: ResourceType[];
  expiry: ExpiryOption;
}

export interface Notification {
  id: string;
  kind: string;
  entityType: string;
  entityId: string;
  /** Task key or doc title for routing */
  ref: string;
  title: string;
  body: string;
  actor: Actor;
  readAt: ISODate | null;
  createdAt: ISODate;
}

export interface Company {
  id: string;
  name: string;
  location: string;
  details: string;
  website: string;
}

export interface Contact {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
}

export interface LeadSummary {
  id: string;
  projectId: string;
  stage: LeadStage;
  source: string;
  company: Company;
  contact: Contact | null;
  lastContactAt: string | null;
  owner: Actor;
  sortOrder: number;
  updatedAt: ISODate;
}

export interface Lead extends LeadSummary {
  notes: string;
  lastContactNote: string;
  analysis: { rows: { label: string; text: string }[]; model: string; ms: number } | null;
  analyzedAt: ISODate | null;
  draft: { subject: string; body: string; language: string; model: string } | null;
  draftedAt: ISODate | null;
}

export interface Repo {
  id: string;
  provider: "github" | "gitlab";
  fullName: string;
  webhookUrl: string;
  lastEventAt: ISODate | null;
  /** Only returned right after creation. */
  secret?: string;
}

export interface AiSettings {
  hasKey: boolean;
  models: { taskDraft: string; docSummary: string; leadAnalysis: string; emailDraft: string };
}

export interface InstanceInfo {
  version: string;
  publicUrl: string;
  mcpUrl: string;
  lastBackupAt: ISODate | null;
}
