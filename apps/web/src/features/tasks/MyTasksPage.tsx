import type { Comment, TaskDetail, TaskStatus, TaskSummary } from "@mado/contract";
import { PRIORITY_LABEL } from "@mado/contract";
import { Avatar, Badge, Button, EmptyState, IconButton, Menu, PriorityIcon, Segmented, Spinner, StatusIcon } from "@mado/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowUpRight, Bell, Calendar, ChevronDown, ChevronRight, CircleCheck, FileText, GitBranch, Link2, ListFilter, PanelRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { orpc } from "../../lib/orpc";
import { useCommands } from "../../lib/shortcuts";
import { ago, dueLabel } from "../../lib/time";
import { openCapture, pushRecent } from "../../lib/ui";
import { useMe, useWorkspace, workspaceInitials } from "../../lib/workspace";
import { StatusBar } from "../shell/AppShell";
import { MobileTitle } from "../shell/PageHeader";
import { ACTIVE_FIRST, branchName, copyText, groupByStatus, shortSession, STATUS_LABEL, taskUrl, updateTask, useIsPhone, noOverlay, docLabel } from "./data";
import { Description } from "./TaskDetailParts";
import { applyToTask, PickerHost, PickerPopover, useTaskHotkeys } from "./pickers";
import { AssigneeAvatar, GroupHeader, InlineMd, Pill, TaskRow, TaskRowPhone } from "./TaskBits";

type Tab = "assigned" | "created" | "agents";
type PhoneTab = "today" | "open" | "agents";

export function MyTasksPage() {
  const search = useSearch({ from: "/$ws/my-tasks" });
  const navigate = useNavigate({ from: "/$ws/my-tasks" });
  const ws = useWorkspace();
  const isPhone = useIsPhone();
  const [phoneTab, setPhoneTab] = useState<PhoneTab>("open");
  const [showDone, setShowDone] = useState(false);
  const tab: Tab = isPhone ? (phoneTab === "agents" ? "agents" : "assigned") : (search.tab ?? "assigned");
  const query = useQuery(orpc.task.mine.queryOptions({ input: { tab } }));
  const projectIds = useMemo(() => new Set(ws.projects.map((p) => p.id)), [ws.projects]);

  const tasks = useMemo(() => {
    let list = (query.data ?? []).filter((t) => projectIds.has(t.projectId) && t.status !== "canceled");
    if (!showDone) list = list.filter((t) => t.status !== "done");
    if (isPhone && phoneTab === "today") {
      const today = new Date().toISOString().slice(0, 10);
      list = list.filter((t) => t.status === "in_progress" || (t.dueDate !== null && t.dueDate <= today));
    }
    return list;
  }, [query.data, projectIds, showDone, isPhone, phoneTab]);
  const groups = useMemo(() => groupByStatus(tasks, ACTIVE_FIRST), [tasks]);
  const sections = ACTIVE_FIRST.map((s) => ({ status: s, tasks: groups.get(s) ?? [] })).filter((g) => g.tasks.length);
  const flat = sections.flatMap((g) => g.tasks);
  const selected = flat.find((t) => t.key === search.task) ?? (query.data ?? []).find((t) => t.key === search.task);

  const select = (t: TaskSummary | undefined) => navigate({ search: (s) => ({ ...s, task: t?.key }), replace: true });
  const open = (t: TaskSummary) => {
    pushRecent({ type: "task", id: t.id, title: t.title, ref: t.key });
    navigate({ to: "/$ws/t/$taskKey", params: { ws: ws.slug, taskKey: t.key } });
  };
  const move = (dir: 1 | -1) => {
    if (!flat.length) return;
    const i = selected ? flat.indexOf(selected) : -1;
    select(flat[i === -1 ? (dir === 1 ? 0 : flat.length - 1) : Math.max(0, Math.min(flat.length - 1, i + dir))]);
  };

  useEffect(() => {
    if (selected) document.querySelector(`[data-task-id="${selected.id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected?.id]);

  useCommands(
    [
      { id: "list.down", title: "Move down", keys: "j, ArrowDown", hint: "J", group: "Navigation", run: () => move(1) },
      { id: "list.up", title: "Move up", keys: "k, ArrowUp", hint: "K", group: "Navigation", run: () => move(-1) },
      { id: "list.open", title: "Open", keys: "Enter", hint: "↵", group: "Navigation", run: () => selected && open(selected) },
      { id: "list.clear", title: "Close detail", keys: "Escape", group: "Navigation", run: () => select(undefined), when: noOverlay },
      { id: "mine.assigned", title: "My tasks: assigned", keys: "1", group: "Tasks", run: () => navigate({ search: (s) => ({ ...s, tab: undefined }) }) },
      { id: "mine.created", title: "My tasks: created", keys: "2", group: "Tasks", run: () => navigate({ search: (s) => ({ ...s, tab: "created" }) }) },
      { id: "mine.agents", title: "My tasks: agents", keys: "3", group: "Tasks", run: () => navigate({ search: (s) => ({ ...s, tab: "agents" }) }) },
      { id: "mine.done", title: showDone ? "Hide done tasks" : "Show done tasks", group: "Tasks", run: () => setShowDone(!showDone) },
    ],
    [flat, selected, showDone],
  );
  useTaskHotkeys(() => selected, { onDeleted: () => move(1) }, [selected]);

  const inWorkspace = (query.data ?? []).filter((t) => projectIds.has(t.projectId));
  const openCount = inWorkspace.filter((t) => t.status !== "done" && t.status !== "canceled").length;
  const reviewCount = inWorkspace.filter((t) => t.status === "in_review").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="hidden min-h-0 flex-1 md:flex">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-edge pl-5 pr-3">
            <h1 className="text-base font-semibold text-ink">My tasks</h1>
            <span className="text-sm text-ink-subtle">{tasks.length}</span>
            <div className="flex-1" />
            <Segmented
              value={tab}
              onChange={(v) => navigate({ search: (s) => ({ ...s, tab: v === "assigned" ? undefined : v }), replace: true })}
              options={[
                { value: "assigned", label: "Assigned" },
                { value: "created", label: "Created" },
                { value: "agents", label: "Agents" },
              ]}
            />
            <Menu.Root>
              <Menu.Trigger aria-label="Filter" className="inline-flex size-8 items-center justify-center rounded-md text-ink-subtle outline-none hover:bg-state-hover hover:text-ink data-[popup-open]:bg-state-active">
                <ListFilter className="size-4" />
              </Menu.Trigger>
              <Menu.Popup align="end" className="w-52">
                <Menu.Item selected={showDone} onClick={() => setShowDone(!showDone)}>
                  Show done
                </Menu.Item>
              </Menu.Popup>
            </Menu.Root>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto pb-8">
            {query.isPending && !query.data ? (
              <div className="flex justify-center py-16">
                <Spinner />
              </div>
            ) : sections.length === 0 ? (
              <EmptyState icon={<CircleCheck />} title={tab === "agents" ? "No tasks with agents" : "Nothing on your plate"}>
                {tab === "agents" ? "Tasks assigned to a connected agent show up here." : "Press C to capture a task."}
              </EmptyState>
            ) : (
              sections.map((g) => (
                <section key={g.status}>
                  <GroupHeader status={g.status} count={g.tasks.length} sticky onAdd={() => openCapture("task", { status: g.status })} />
                  {g.tasks.map((t) => (
                    <TaskRow key={t.id} task={t} focused={selected?.id === t.id} onClick={() => select(t)} onOpen={() => open(t)} />
                  ))}
                </section>
              ))
            )}
          </div>
        </div>
        {selected && <DetailPane task={selected} onClose={() => select(undefined)} onOpen={() => open(selected)} />}
      </div>

      <MyTasksPhone
        tab={phoneTab}
        setTab={setPhoneTab}
        sections={sections}
        loading={query.isPending && !query.data}
        subtitle={`${openCount} open${reviewCount ? ` · ${reviewCount} in review` : ""}`}
        onOpen={open}
      />

      <StatusBar
        hints={[
          { keys: ["j", "k"], label: "move" },
          { keys: ["↵"], label: "open" },
          { keys: ["s"], label: "status" },
          { keys: ["a"], label: "assign" },
          { keys: ["⌥", "Space"], label: "quick capture" },
        ]}
      />
      <PickerHost />
    </div>
  );
}

function DetailPane({ task, onClose, onOpen }: { task: TaskSummary; onClose: () => void; onOpen: () => void }) {
  const ws = useWorkspace();
  const detail = useQuery(orpc.task.get.queryOptions({ input: { key: task.key } }));
  const d = detail.data;
  const onChange = applyToTask(task);
  const due = dueLabel(task.dueDate);
  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-edge xl:w-[440px]">
      <div className="flex h-[52px] shrink-0 items-center gap-1 px-5">
        <span className="flex-1 text-sm text-ink-subtle">{task.key}</span>
        <IconButton label="Open in full (↵)" size="sm" onClick={onOpen}>
          <ArrowUpRight />
        </IconButton>
        <IconButton label="Copy link" size="sm" onClick={() => copyText(taskUrl(ws.slug, task.key), "link")}>
          <Link2 />
        </IconButton>
        <IconButton label="Close (esc)" size="sm" onClick={onClose}>
          <PanelRight />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        <h2 className="mt-2 text-title text-ink">{task.title}</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <PickerPopover kind="status" target={task} onChange={onChange}>
            <Pill>
              <StatusIcon status={task.status} />
              {STATUS_LABEL[task.status]}
            </Pill>
          </PickerPopover>
          <PickerPopover kind="priority" target={task} onChange={onChange}>
            <Pill>
              <PriorityIcon priority={task.priority} />
              {PRIORITY_LABEL[task.priority]}
            </Pill>
          </PickerPopover>
          <PickerPopover kind="assignee" target={task} onChange={onChange}>
            <Pill>
              <AssigneeAvatar assignee={task.assignee} size="xs" />
              {task.assignee?.name.split(" ")[0] ?? "Assign"}
            </Pill>
          </PickerPopover>
          <PickerPopover kind="labels" target={task} onChange={onChange}>
            {task.labels.length ? (
              task.labels.map((l) => (
                <Pill key={l.id} className="rounded-full">
                  <span className="size-1.5 rounded-full bg-ink-subtle" />
                  {l.name}
                </Pill>
              ))
            ) : (
              <Pill className="text-ink-subtle">Labels</Pill>
            )}
          </PickerPopover>
          {due && (
            <Pill>
              <Calendar />
              {due === "Due today" ? due : `Due ${due}`}
            </Pill>
          )}
        </div>
        {d ? (
          <>
            <div className="mt-5 text-sm">
              <Description task={d} />
            </div>
            <div className="mt-5 divide-y divide-edge overflow-hidden rounded-lg border border-edge">
              {d.linkedDocs.map((doc) => (
                <Link key={doc.id} to="/$ws/wiki/$docId" params={{ ws: ws.slug, docId: doc.id }} className="flex h-9 items-center gap-2.5 px-3 text-sm hover:bg-state-hover">
                  <FileText className="size-4 shrink-0 text-ink-subtle" />
                  <span className="min-w-0 flex-1 truncate text-ink">{docLabel(doc)}</span>
                  <span className="text-label text-ink-subtle">doc</span>
                </Link>
              ))}
              <button type="button" onClick={() => copyText(d.branch ?? branchName(task.key, task.title), "branch name")} className="flex h-9 w-full items-center gap-2.5 px-3 text-left text-sm hover:bg-state-hover">
                <GitBranch className="size-4 shrink-0 text-ink-subtle" />
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{d.branch ?? branchName(task.key, task.title)}</span>
                <span className="text-label text-ink-subtle">
                  branch · {d.git.filter((g) => g.kind === "commit").length ? `${d.git.filter((g) => g.kind === "commit").length} commits` : "no commits yet"}
                </span>
              </button>
            </div>
            <AgentSuggestion task={task} detail={d} />
          </>
        ) : (
          <div className="mt-8 flex justify-center">
            <Spinner />
          </div>
        )}
      </div>
    </aside>
  );
}

/** The latest agent comment on a task you own, with a one-click hand-off. */
function AgentSuggestion({ task, detail }: { task: TaskSummary; detail: TaskDetail }) {
  const ws = useWorkspace();
  const storageKey = `mado.dismissed.${task.id}`;
  const comment: Comment | undefined = [...detail.comments].reverse().find((c) => c.actor.type === "agent");
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === comment?.id;
    } catch {
      return false;
    }
  });
  if (!comment || dismissed) return null;
  const assigned = task.assignee?.type === "agent" && task.assignee.id === comment.actor.id;
  return (
    <div className="mt-4 rounded-lg border border-edge px-3.5 py-3">
      <div className="flex items-center gap-2 text-sm">
        <Avatar type="agent" size="sm" />
        <span className="font-medium text-ink">{comment.actor.name}</span>
        <Badge>agent</Badge>
        <span className="ml-auto text-label text-ink-subtle">{new Date(comment.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <p className="mt-2 text-sm text-ink-muted">
        “<InlineMd text={comment.body.trim()} wsSlug={ws.slug} />”
      </p>
      {!assigned && (
        <div className="mt-3 flex gap-2">
          <Button
            onClick={() =>
              updateTask(task, { assignee: `agent:${comment.actor.id}` }, { assignee: { type: "agent", id: comment.actor.id, name: comment.actor.name, initials: null } })
            }
          >
            Assign to agent
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setDismissed(true);
              try {
                localStorage.setItem(storageKey, comment.id);
              } catch {}
            }}
          >
            Not now
          </Button>
        </div>
      )}
    </div>
  );
}

/** iOS 34:2. */
function MyTasksPhone({
  tab,
  setTab,
  sections,
  loading,
  subtitle,
  onOpen,
}: {
  tab: PhoneTab;
  setTab: (t: PhoneTab) => void;
  sections: { status: TaskStatus; tasks: TaskSummary[] }[];
  loading: boolean;
  subtitle: string;
  onOpen: (t: TaskSummary) => void;
}) {
  const ws = useWorkspace();
  const me = useMe().data;
  const navigate = useNavigate();
  const { data: sessions = [] } = useQuery(orpc.agents.activeSessions.queryOptions({ refetchInterval: 30_000 }));
  const { data: unread } = useQuery(orpc.inbox.unread.queryOptions());
  const live = sessions[0];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-32 md:hidden">
      <div className="flex h-[52px] items-center justify-between px-4 pt-safe">
        <button type="button" onClick={() => navigate({ to: "/$ws/settings/$section", params: { ws: ws.slug, section: "workspace" } })} className="flex h-9 items-center gap-2 rounded-full border border-edge bg-raised pl-1.5 pr-3 text-sm font-medium text-ink">
          <span className="flex size-6 items-center justify-center rounded-full bg-ink text-[10px] font-medium text-on-ink">{workspaceInitials(ws.name)}</span>
          {ws.name}
          <ChevronDown className="size-3.5 text-ink-subtle" />
        </button>
        <Link to="/$ws/inbox" params={{ ws: ws.slug }} aria-label="Inbox" className="relative flex size-9 items-center justify-center rounded-full border border-edge bg-raised text-ink-muted">
          <Bell className="size-[18px]" />
          {!!unread?.count && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent" />}
        </Link>
      </div>
      <MobileTitle title="My tasks" subtitle={subtitle} />
      <div className="px-4 pb-3">
        <Segmented
          size="touch"
          value={tab}
          onChange={setTab}
          options={[
            { value: "today", label: "Today" },
            { value: "open", label: "Open" },
            { value: "agents", label: "Agents" },
          ]}
        />
      </div>
      {live && (
        <Link
          to="/$ws/t/$taskKey"
          params={{ ws: ws.slug, taskKey: live.lastTaskKey ?? "" }}
          disabled={!live.lastTaskKey}
          className="mx-4 mb-3 flex items-center gap-3 rounded-xl border border-edge bg-panel px-3.5 py-3"
        >
          <Avatar type="agent" size="lg" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-ink">
              {live.agentName} is on {live.lastTaskKey ? <span className="text-accent">{live.lastTaskKey}</span> : "a task"}
            </span>
            <span className="block truncate text-label text-ink-subtle">
              {live.writes} writes · session {shortSession(live.sessionId)} · {ago(live.lastActiveAt, { long: true })}
            </span>
          </span>
          <ChevronRight className="size-4 text-ink-faint" />
        </Link>
      )}
      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : sections.length === 0 ? (
        <EmptyState icon={<CircleCheck />} title="All clear">
          {me ? `Nothing ${tab === "today" ? "due today" : "open"}, ${me.name.split(" ")[0]}.` : null}
        </EmptyState>
      ) : (
        sections.map((g) => (
          <section key={g.status}>
            <div className="flex h-9 items-center gap-2 px-4 pt-2 text-label">
              <StatusIcon status={g.status} />
              <span className="font-medium text-ink-muted">{STATUS_LABEL[g.status]}</span>
              <span className="text-ink-subtle">{g.tasks.length}</span>
            </div>
            {g.tasks.map((t) => (
              <TaskRowPhone key={t.id} task={t} onClick={() => onOpen(t)} />
            ))}
          </section>
        ))
      )}
    </div>
  );
}

