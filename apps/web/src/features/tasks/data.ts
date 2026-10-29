import type { Assignee, Label, Priority, TaskDetail, TaskStatus, TaskSummary, TaskType, Workspace } from "@mado/contract";
import { STATUS_LABEL, TASK_STATUSES } from "@mado/contract";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { toast } from "../../lib/toast";
import { useMe, useWorkspace } from "../../lib/workspace";

export type TaskPatch = Parameters<typeof client.task.update>[0]["patch"];

/** Board columns and list groups run left to right in this order. */
export const STATUS_ORDER: TaskStatus[] = ["backlog", "todo", "in_progress", "in_review", "done", "canceled"];
/** My tasks and the phone list put active work first. */
export const ACTIVE_FIRST: TaskStatus[] = ["in_progress", "todo", "in_review", "backlog", "done", "canceled"];

export { STATUS_LABEL, TASK_STATUSES };

export function assigneeValue(a: Pick<Assignee, "type" | "id"> | null | undefined) {
  return a ? `${a.type}:${a.id}` : null;
}

export function bySortOrder(a: TaskSummary, b: TaskSummary) {
  return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
}

export function groupByStatus(tasks: TaskSummary[], order: TaskStatus[] = STATUS_ORDER) {
  const map = new Map<TaskStatus, TaskSummary[]>(order.map((s) => [s, []]));
  for (const t of tasks) map.get(t.status)?.push(t);
  for (const list of map.values()) list.sort(bySortOrder);
  return map;
}

/** gat-109-rrule: what `git switch -c` should get, so commits link back to the task. */
export function branchName(key: string, title: string) {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .split(/\s+/)
    .filter((w) => !["a", "an", "the", "and", "or", "for", "to", "of", "in", "on"].includes(w))
    .slice(0, 3)
    .join("-");
  return `${key.toLowerCase()}${slug ? `-${slug}` : ""}`;
}

export function shortSession(id: string | null | undefined) {
  return id ? id.replace(/-/g, "").slice(0, 4) : "";
}

export function taskUrl(slug: string, key: string) {
  return `${location.origin}/${slug}/t/${key}`;
}

export async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${what}`);
  } catch {
    toast.error("Clipboard not available");
  }
}

// ── Queries ─────────────────────────────────────────────────────────────

export function useProjectTasks(projectId: string | undefined) {
  return useQuery({ ...orpc.task.list.queryOptions({ input: { projectId: projectId ?? "" } }), enabled: !!projectId });
}

export function useLabels(projectId: string | undefined) {
  return useQuery({ ...orpc.project.labels.queryOptions({ input: { projectId: projectId ?? "" } }), enabled: !!projectId, staleTime: 60_000 });
}

export function useEpics(projectId: string | undefined) {
  return useQuery({ ...orpc.task.epics.queryOptions({ input: { projectId: projectId ?? "" } }), enabled: !!projectId, staleTime: 60_000 });
}

export interface AssigneeOption extends Assignee {
  value: string;
}

/** Members and active agents in one list: agents are assignable like people, but never look like them. */
export function useAssigneeOptions() {
  const ws = useWorkspace();
  const me = useMe().data;
  const members = useQuery({ ...orpc.workspace.members.queryOptions({ input: { workspaceId: ws.id } }), staleTime: 300_000 });
  const agents = useQuery({ ...orpc.agents.assignable.queryOptions({ input: { workspaceId: ws.id } }), staleTime: 60_000 });
  return useMemo<AssigneeOption[]>(() => {
    const users: AssigneeOption[] = (members.data ?? []).map((m) => ({ type: "user", id: m.userId, name: m.name, initials: m.initials, value: `user:${m.userId}` }));
    if (me && !users.some((u) => u.id === me.id)) users.unshift({ type: "user", id: me.id, name: me.name, initials: me.initials, value: `user:${me.id}` });
    users.sort((a, b) => (a.id === me?.id ? -1 : b.id === me?.id ? 1 : a.name.localeCompare(b.name)));
    // Other members' agents carry the owner's name so two "Claude Code" grants stay distinguishable.
    const bots: AssigneeOption[] = (agents.data ?? []).map((a) => ({
      type: "agent",
      id: a.grantId,
      name: a.mine ? a.agentName : `${a.agentName} (${a.ownerName.split(" ")[0]})`,
      initials: null,
      value: `agent:${a.grantId}`,
    }));
    return [...users, ...bots];
  }, [members.data, agents.data, me]);
}

// ── Cache helpers ───────────────────────────────────────────────────────

const listKeys = () => [orpc.task.list.key(), orpc.task.mine.key(), orpc.task.epics.key()];

function snapshot() {
  return [...listKeys(), orpc.task.get.key()].flatMap((queryKey) => queryClient.getQueriesData({ queryKey }));
}

function restore(snap: ReturnType<typeof snapshot>) {
  for (const [key, data] of snap) queryClient.setQueryData(key, data);
}

function mapLists(fn: (list: TaskSummary[]) => TaskSummary[]) {
  for (const queryKey of listKeys()) queryClient.setQueriesData<TaskSummary[]>({ queryKey }, (old) => (old ? fn(old) : old));
}

function patchDetail(id: string, partial: Partial<TaskDetail>) {
  queryClient.setQueriesData<TaskDetail>({ queryKey: orpc.task.get.key() }, (old) => (old && old.id === id ? { ...old, ...partial } : old));
}

export function findCachedTask(id: string): TaskSummary | undefined {
  for (const queryKey of listKeys()) {
    for (const [, data] of queryClient.getQueriesData<TaskSummary[]>({ queryKey })) {
      const hit = data?.find((t) => t.id === id);
      if (hit) return hit;
    }
  }
  return undefined;
}

export function findCachedTaskByKey(key: string): TaskSummary | undefined {
  for (const queryKey of listKeys()) {
    for (const [, data] of queryClient.getQueriesData<TaskSummary[]>({ queryKey })) {
      const hit = data?.find((t) => t.key === key);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Everything the UI shows changes at once; the server result replaces it, an error rolls it back. */
export async function updateTask(task: Pick<TaskSummary, "id" | "key">, patch: TaskPatch, optimistic: Partial<TaskSummary>) {
  const snap = snapshot();
  const now = new Date().toISOString();
  mapLists((list) => list.map((t) => (t.id === task.id ? { ...t, ...optimistic, updatedAt: now } : t)));
  patchDetail(task.id, { ...optimistic, ...(patch.description !== undefined ? { description: patch.description } : {}) });
  try {
    const saved = await client.task.update({ id: task.id, patch });
    mapLists((list) => list.map((t) => (t.id === saved.id ? saved : t)));
    patchDetail(saved.id, saved);
    void queryClient.invalidateQueries({ queryKey: orpc.task.get.queryKey({ input: { key: task.key } }) });
    return saved;
  } catch (e) {
    restore(snap);
    toast.error(errorMessage(e));
    return null;
  }
}

export async function deleteTask(task: Pick<TaskSummary, "id" | "key" | "title">) {
  const snap = snapshot();
  mapLists((list) => list.filter((t) => t.id !== task.id));
  try {
    await client.task.delete({ id: task.id });
    toast(`Deleted ${task.key}`, {
      action: {
        label: "Undo",
        run: async () => {
          restore(snap);
          try {
            await client.trash.restore({ entityType: "task", id: task.id });
          } catch (e) {
            toast.error(errorMessage(e));
          }
          void queryClient.invalidateQueries({ queryKey: orpc.task.key() });
        },
      },
    });
    return true;
  } catch (e) {
    restore(snap);
    toast.error(errorMessage(e));
    return false;
  }
}

export interface NewTask {
  projectId: string;
  projectKey: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  type?: TaskType;
  assignee?: Assignee | null;
  labels?: Pick<Label, "id" | "name" | "color">[];
  epic?: TaskSummary["epic"];
  dueDate?: string | null;
  docIds?: string[];
  sortOrder?: number;
}

/**
 * Next key from the project's sequence (projects.next_number), bumped locally on each optimistic create.
 * Exact unless someone else creates a task in between, which the server then resolves.
 */
export function predictKey(projectId: string, projectKey: string): string {
  const workspaces = queryClient.getQueryData<Workspace[]>(orpc.workspace.list.queryKey());
  const project = workspaces?.flatMap((w) => w.projects).find((p) => p.id === projectId);
  return project ? `${projectKey}-${project.nextNumber}` : `${projectKey}-…`;
}

function bumpNextNumber(projectId: string) {
  queryClient.setQueryData<Workspace[]>(orpc.workspace.list.queryKey(), (list) =>
    list?.map((w) => ({ ...w, projects: w.projects.map((p) => (p.id === projectId ? { ...p, nextNumber: p.nextNumber + 1 } : p)) })),
  );
}

/**
 * Inserts the row into the cached board before the request leaves, so it shows up in one frame.
 * The client-generated id is sent as clientId, so the optimistic row and the server row are the same row.
 */
export async function createTask(input: NewTask): Promise<TaskSummary | null> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const listKey = orpc.task.list.queryKey({ input: { projectId: input.projectId } });
  const existing = queryClient.getQueryData<TaskSummary[]>(listKey) ?? [];
  const status = input.status ?? "todo";
  const minInColumn = existing.filter((t) => t.status === status).reduce((m, t) => Math.min(m, t.sortOrder), 1);
  const optimistic: TaskSummary = {
    id,
    key: predictKey(input.projectId, input.projectKey),
    projectId: input.projectId,
    type: input.type ?? "task",
    title: input.title,
    status,
    priority: input.priority ?? "none",
    assignee: input.assignee ?? null,
    labels: input.labels ?? [],
    epic: input.epic ?? null,
    dueDate: input.dueDate ?? null,
    prNumber: null,
    sortOrder: input.sortOrder ?? minInColumn - 1,
    updatedAt: now,
    createdAt: now,
  };
  queryClient.setQueryData<TaskSummary[]>(listKey, (old) => [...(old ?? []), optimistic]);
  bumpNextNumber(input.projectId);
  try {
    const saved = await client.task.create({
      clientId: id,
      projectId: input.projectId,
      title: input.title,
      description: input.description || undefined,
      status,
      priority: optimistic.priority,
      type: optimistic.type,
      assignee: assigneeValue(input.assignee),
      labelIds: optimistic.labels.map((l) => l.id),
      epicId: optimistic.epic?.id ?? null,
      dueDate: optimistic.dueDate,
      docIds: input.docIds,
      sortOrder: optimistic.sortOrder,
    });
    queryClient.setQueryData<TaskSummary[]>(listKey, (old) => (old ?? []).map((t) => (t.id === id ? saved : t)));
    void queryClient.invalidateQueries({ queryKey: orpc.task.mine.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.workspace.list.key() });
    return saved;
  } catch (e) {
    queryClient.setQueryData<TaskSummary[]>(listKey, (old) => (old ?? []).filter((t) => t.id !== id));
    void queryClient.invalidateQueries({ queryKey: orpc.workspace.list.key() });
    toast.error(errorMessage(e));
    return null;
  }
}

// ── Display settings (per browser) ──────────────────────────────────────

export interface DisplaySettings {
  showBacklog: boolean;
  showCanceled: boolean;
  showDone: boolean;
}

const DISPLAY_KEY = "mado.tasks.display";
const displayListeners = new Set<() => void>();
let displayCache: DisplaySettings | null = null;

function readDisplay(): DisplaySettings {
  if (displayCache) return displayCache;
  let parsed: Partial<DisplaySettings> = {};
  try {
    parsed = JSON.parse(localStorage.getItem(DISPLAY_KEY) ?? "{}");
  } catch {}
  displayCache = { showBacklog: false, showCanceled: false, showDone: true, ...parsed };
  return displayCache;
}

export function setDisplay(patch: Partial<DisplaySettings>) {
  displayCache = { ...readDisplay(), ...patch };
  try {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify(displayCache));
  } catch {}
  for (const l of displayListeners) l();
}

export function useDisplay() {
  return useSyncExternalStore(
    (l) => {
      displayListeners.add(l);
      return () => displayListeners.delete(l);
    },
    readDisplay,
  );
}

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (l) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", l);
      return () => m.removeEventListener("change", l);
    },
    () => window.matchMedia(query).matches,
  );
}

export const useIsPhone = () => useMediaQuery("(max-width: 767px)");

/** Escape belongs to an open dialog or popover first. */
export const noOverlay = () => !document.querySelector('[role="dialog"], [role="menu"], [data-popup-open]');

/** "Architecture / Events": linked docs carry the parent path separately from the title. */
export function docLabel(d: { path: string; title: string }) {
  if (!d.path || d.path === d.title || d.path.endsWith(` / ${d.title}`)) return d.path || d.title;
  return `${d.path} / ${d.title}`;
}
