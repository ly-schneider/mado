export const TASK_STATUSES = ["backlog", "todo", "in_progress", "in_review", "done", "canceled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  canceled: "Canceled",
};

export const TASK_TYPES = ["task", "bug", "epic"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};

export const LEAD_STAGES = ["new", "contacted", "replied", "qualified", "won", "lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const STAGE_LABEL: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  replied: "Replied",
  qualified: "Qualified",
  won: "Won",
  lost: "Lost",
};

export const GRANT_LEVELS = ["read", "write", "delete"] as const;
export type GrantLevel = (typeof GRANT_LEVELS)[number];

export const RESOURCE_TYPES = ["docs", "tasks", "comments", "crm"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const EXPIRY_OPTIONS = ["7d", "30d", "90d", "never"] as const;
export type ExpiryOption = (typeof EXPIRY_OPTIONS)[number];

export const LABEL_COLORS = ["grey", "amber", "red", "green", "blue", "violet", "pink", "teal"] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

export type ActorType = "user" | "agent" | "guest" | "system";
export type Role = "owner" | "member";

/** Project keys: 2 to 5 capital letters (digits allowed after the first), unique per instance. */
export const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,4}$/;

/** Task keys in free text, commit messages, PR titles and branch names. */
export const TASK_KEY_RE = /\b([A-Z][A-Z0-9]{1,4})-(\d+)\b/g;

/** Branch names are usually lower case (gat-109-rrule), so match those case-insensitively. */
export function findTaskKeys(text: string, opts: { caseInsensitive?: boolean } = {}): string[] {
  const re = new RegExp(TASK_KEY_RE.source, opts.caseInsensitive ? "gi" : "g");
  const keys = new Set<string>();
  for (const m of text.matchAll(re)) keys.add(`${m[1]!.toUpperCase()}-${m[2]}`);
  return [...keys];
}

/** [[Page]] or [[Folder/Page]] wiki links. */
export const WIKI_LINK_RE = /\[\[([^\]\n]+?)\]\]/g;

export function findWikiLinks(text: string): string[] {
  return [...new Set([...text.matchAll(WIKI_LINK_RE)].map((m) => m[1]!.trim()))];
}

export function expiryToDate(expiry: ExpiryOption, from = new Date()): Date | null {
  if (expiry === "never") return null;
  const days = Number.parseInt(expiry, 10);
  return new Date(from.getTime() + days * 86_400_000);
}

export function levelAllows(have: GrantLevel, need: GrantLevel) {
  return GRANT_LEVELS.indexOf(have) >= GRANT_LEVELS.indexOf(need);
}

export const TRASH_RETENTION_DAYS = 30;
