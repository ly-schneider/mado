import type { TaskStatus, TaskSummary } from "@mado/contract";
import { Button, cn, ContextArea, EmptyState, Segmented, Spinner, StatusIcon } from "@mado/ui";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Plus, Zap } from "@mado/ui/fluent";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TaskView } from "../../router";
import { useCommands } from "../../lib/shortcuts";
import { openCapture, pushRecent } from "../../lib/ui";
import { useProject, useWorkspace } from "../../lib/workspace";
import { MobileTitle, PageHeader } from "../shell/PageHeader";
import { ACTIVE_FIRST, groupByStatus, setDisplay, STATUS_LABEL, updateTask, useDisplay, useProjectTasks, noOverlay } from "./data";
import { FilterBar, FilterMenu, hasFilters, type TaskFilters, useFilterPredicate } from "./FilterBar";
import { newTaskEntries, TaskRowMenu } from "./actions";
import { PickerHost, useTaskHotkeys } from "./pickers";
import { AssigneeAvatar, GroupHeader, TaskCard, TaskRow, TaskRowPhone } from "./TaskBits";

const BOARD_CORE: TaskStatus[] = ["todo", "in_progress", "in_review"];

export function TasksPage() {
  const { key } = useParams({ from: "/$ws/p/$key/tasks" });
  const search = useSearch({ from: "/$ws/p/$key/tasks" });
  const navigate = useNavigate({ from: "/$ws/p/$key/tasks" });
  const ws = useWorkspace();
  const project = useProject(key);
  const view: TaskView = search.view ?? "board";
  const filters: TaskFilters = { status: search.status, labels: search.labels, epic: search.epic, assignee: search.assignee };
  const display = useDisplay();
  const tasks = useProjectTasks(project?.id);
  const predicate = useFilterPredicate(filters);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const filtered = useMemo(() => (tasks.data ?? []).filter((t) => t.type !== "epic" && predicate(t)), [tasks.data, predicate]);
  const groups = useMemo(() => groupByStatus(filtered), [filtered]);
  const epics = useMemo(() => epicProgress(tasks.data ?? []), [tasks.data]);

  const visible: TaskStatus[] = useMemo(() => {
    const order = view === "board" ? (["backlog", ...BOARD_CORE, "done", "canceled"] as TaskStatus[]) : ACTIVE_FIRST;
    // A status filter names the columns explicitly, overriding the Display toggles.
    if (filters.status) return order.filter((s) => filters.status!.split(",").includes(s));
    return order.filter((s) => (s === "backlog" ? display.showBacklog : s === "done" ? display.showDone : s === "canceled" ? display.showCanceled : true));
  }, [view, display, filters.status]);

  /** Board columns, or list groups with tasks, in on-screen order. */
  const columns = useMemo(
    () => visible.map((s) => ({ status: s, tasks: groups.get(s) ?? [] })).filter((c) => view === "board" || c.tasks.length > 0),
    [visible, groups, view],
  );
  const flat = useMemo(() => (view === "epics" ? epics.flatMap((g) => g.epics.map((e) => e.epic)) : columns.flatMap((c) => c.tasks)), [view, epics, columns]);
  const focused = flat.find((t) => t.id === focusId);

  useEffect(() => {
    if (!focusId) return;
    document.querySelector(`[data-task-id="${focusId}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusId]);

  const open = (t: TaskSummary) => {
    pushRecent({ type: "task", id: t.id, title: t.title, ref: t.key });
    navigate({ to: "/$ws/t/$taskKey", params: { ws: ws.slug, taskKey: t.key } });
  };
  const setFilters = (f: TaskFilters) => navigate({ search: (s) => ({ ...s, ...f }), replace: true });
  const setView = (v: TaskView) => navigate({ search: (s) => ({ ...s, view: v === "board" ? undefined : v }), replace: true });
  const create = (status?: TaskStatus) => project && openCapture("task", { projectId: project.id, status, type: view === "epics" ? "epic" : undefined });
  /** The board, narrowed to one epic's tasks. */
  const showEpicTasks = (epic: TaskSummary) => navigate({ search: { view: undefined, epic: epic.key }, replace: false });

  const move = (dir: 1 | -1) => {
    if (!flat.length) return;
    if (!focused) return setFocusId(flat[dir === 1 ? 0 : flat.length - 1]!.id);
    if (view !== "board") {
      const i = flat.indexOf(focused);
      return setFocusId(flat[Math.max(0, Math.min(flat.length - 1, i + dir))]!.id);
    }
    const col = columns.find((c) => c.tasks.includes(focused))!;
    const i = col.tasks.indexOf(focused);
    const next = col.tasks[i + dir];
    if (next) setFocusId(next.id);
  };
  const moveColumn = (dir: 1 | -1) => {
    if (view !== "board") return;
    if (!focused) return move(1);
    const ci = columns.findIndex((c) => c.tasks.includes(focused));
    const row = columns[ci]!.tasks.indexOf(focused);
    for (let j = ci + dir; j >= 0 && j < columns.length; j += dir) {
      const col = columns[j]!.tasks;
      if (col.length) return setFocusId(col[Math.min(row, col.length - 1)]!.id);
    }
  };

  useCommands(
    [
      { id: "list.down", title: "Move down", keys: "j, ArrowDown", hint: "J", group: "Navigation", run: () => move(1) },
      { id: "list.up", title: "Move up", keys: "k, ArrowUp", hint: "K", group: "Navigation", run: () => move(-1) },
      { id: "list.left", title: "Previous column", keys: "ArrowLeft", group: "Navigation", run: () => moveColumn(-1) },
      { id: "list.right", title: "Next column", keys: "ArrowRight", group: "Navigation", run: () => moveColumn(1) },
      { id: "list.open", title: "Open", keys: "Enter", hint: "↵", group: "Navigation", run: () => focused && open(focused) },
      { id: "list.clear", title: "Clear focus", keys: "Escape", group: "Navigation", run: () => setFocusId(null), when: noOverlay },
      { id: "tasks.create", title: view === "epics" ? "Create epic" : "Create task", subtitle: project ? `in ${project.name}` : undefined, keys: "c", hint: "C", group: "Actions", run: () => create() },
      { id: "tasks.view.board", title: "Show as board", keys: "v b", hint: "V then B", group: "Tasks", run: () => setView("board") },
      { id: "tasks.view.list", title: "Show as list", keys: "v l", hint: "V then L", group: "Tasks", run: () => setView("list") },
      { id: "tasks.view.epics", title: "Show epics", keys: "v e", hint: "V then E", group: "Tasks", run: () => setView("epics") },
      {
        id: "epics.tasks",
        title: "Show tasks in this epic",
        subtitle: focused?.key,
        keys: "t",
        hint: "T",
        group: "Tasks",
        run: () => focused && showEpicTasks(focused),
        when: () => view === "epics" && !!focused,
      },
      { id: "tasks.filter", title: "Add filter", keys: "f", hint: "F", group: "Tasks", run: () => setAddOpen(true) },
      { id: "tasks.filter.clear", title: "Clear filters", group: "Tasks", run: () => setFilters({ status: undefined, labels: undefined, epic: undefined, assignee: undefined }), when: () => hasFilters(filters) },
      { id: "tasks.backlog", title: display.showBacklog ? "Hide backlog" : "Show backlog", group: "Tasks", run: () => setDisplay({ showBacklog: !display.showBacklog }) },
      { id: "tasks.done", title: display.showDone ? "Hide done" : "Show done", group: "Tasks", run: () => setDisplay({ showDone: !display.showDone }) },
      { id: "tasks.canceled", title: display.showCanceled ? "Hide canceled" : "Show canceled", group: "Tasks", run: () => setDisplay({ showCanceled: !display.showCanceled }) },
    ],
    [flat, focused, view, project?.id, display, search],
  );
  useTaskHotkeys(() => focused, { onDeleted: () => move(1) }, [focused]);

  if (!project) {
    return <EmptyState title={`No project ${key}`} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumbs={[{ label: ws.name }, { label: view === "epics" ? "Epics" : "Tasks" }]}
        center={
          <Segmented
            value={view}
            onChange={setView}
            options={VIEW_OPTIONS}
          />
        }
        mobileLabel={project.name}
      >
        {view !== "epics" && <FilterMenu projectId={project.id} filters={filters} onChange={setFilters} open={addOpen} onOpenChange={setAddOpen} />}
        <Button variant="primary" icon={<Plus />} kbd="C" onClick={() => create()}>
          {view === "epics" ? "New epic" : "New task"}
        </Button>
      </PageHeader>
      <MobileTitle
        title={view === "epics" ? "Epics" : "Tasks"}
        subtitle={
          view === "epics"
            ? `${epics.flatMap((g) => g.epics).filter((e) => e.epic.status !== "done" && e.epic.status !== "canceled").length} open`
            : `${filtered.filter((t) => t.status !== "done" && t.status !== "canceled").length} open`
        }
      />
      <div className="px-4 pb-3 md:hidden">
        <Segmented value={view === "epics" ? "epics" : "board"} onChange={(v) => setView(v)} options={PHONE_VIEW_OPTIONS} />
      </div>
      {view !== "epics" && <FilterBar projectId={project.id} filters={filters} onChange={setFilters} />}

      {tasks.isPending && !tasks.data ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : view === "epics" ? (
        <EpicsView groups={epics} focusId={focusId} onOpen={open} onShowTasks={showEpicTasks} onCreate={() => create()} onFocus={setFocusId} />
      ) : (
        <>
          <div className="hidden min-h-0 flex-1 md:flex">
            {view === "board" ? (
              <Board projectId={project.id} columns={columns} focusId={focusId} onOpen={open} onCreate={create} onFocus={setFocusId} />
            ) : (
              <ListView projectId={project.id} columns={columns} focusId={focusId} onOpen={open} onCreate={create} onFocus={setFocusId} />
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-36 md:hidden">
            {filtered.length === 0 && <p className="px-4 py-10 text-center text-sm text-ink-subtle">No tasks</p>}
            {ACTIVE_FIRST.filter((s) => s !== "canceled").map((s) => {
              const list = groups.get(s) ?? [];
              if (!list.length) return null;
              return (
                <section key={s}>
                  <GroupHeader status={s} count={list.length} className="bg-page px-4" />
                  {list.map((t) => (
                    <TaskRowMenu key={t.id} task={t} onOpen={() => open(t)}>
                      <TaskRowPhone task={t} onClick={() => open(t)} />
                    </TaskRowMenu>
                  ))}
                </section>
              );
            })}
          </div>
        </>
      )}
      <PickerHost />
    </div>
  );
}

const VIEW_OPTIONS: { value: TaskView; label: string }[] = [
  { value: "board", label: "Board" },
  { value: "list", label: "List" },
  { value: "epics", label: "Epics" },
];
const PHONE_VIEW_OPTIONS: { value: TaskView; label: string }[] = [
  { value: "board", label: "Tasks" },
  { value: "epics", label: "Epics" },
];

interface EpicProgress {
  epic: TaskSummary;
  done: number;
  /** Canceled tasks don't count towards an epic. */
  total: number;
  assignees: NonNullable<TaskSummary["assignee"]>[];
}

/** Epics grouped by status, active first, each with its tasks counted from the project's task list. */
function epicProgress(all: TaskSummary[]) {
  const children = new Map<string, TaskSummary[]>();
  for (const t of all) {
    if (!t.epic) continue;
    const list = children.get(t.epic.id) ?? [];
    list.push(t);
    children.set(t.epic.id, list);
  }
  const groups = groupByStatus(all.filter((t) => t.type === "epic"), ACTIVE_FIRST);
  return ACTIVE_FIRST.map((status) => ({
    status,
    epics: (groups.get(status) ?? []).map((epic): EpicProgress => {
      const kids = (children.get(epic.id) ?? []).filter((t) => t.status !== "canceled");
      const assignees = new Map(kids.flatMap((t) => (t.assignee ? [[`${t.assignee.type}:${t.assignee.id}`, t.assignee] as const] : [])));
      return { epic, done: kids.filter((t) => t.status === "done").length, total: kids.length, assignees: [...assignees.values()].slice(0, 3) };
    }),
  })).filter((g) => g.epics.length > 0);
}

function EpicsView({
  groups,
  focusId,
  onOpen,
  onShowTasks,
  onCreate,
  onFocus,
}: {
  groups: { status: TaskStatus; epics: EpicProgress[] }[];
  focusId: string | null;
  onOpen: (t: TaskSummary) => void;
  onShowTasks: (t: TaskSummary) => void;
  onCreate: () => void;
  onFocus: (id: string | null) => void;
}) {
  if (groups.length === 0) {
    return (
      <div className="flex-1">
        <EmptyState icon={<Zap />} title="No epics yet">
          <p>An epic groups related tasks and shows how far along they are.</p>
          <Button icon={<Plus />} onClick={onCreate} className="mt-3">
            New epic
          </Button>
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-36 md:pb-8" role="table">
      {groups.map(({ status, epics }) => (
        <section key={status}>
          <GroupHeader status={status} count={epics.length} sticky className="max-md:bg-page max-md:px-4" />
          {epics.map((e) => (
            <TaskRowMenu key={e.epic.id} task={e.epic} onOpen={() => onOpen(e.epic)} onFocus={() => onFocus(e.epic.id)}>
              <EpicRow progress={e} focused={focusId === e.epic.id} onClick={() => onOpen(e.epic)} onShowTasks={() => onShowTasks(e.epic)} />
            </TaskRowMenu>
          ))}
        </section>
      ))}
    </div>
  );
}

function EpicRow({ progress, focused, onClick, onShowTasks }: { progress: EpicProgress; focused: boolean; onClick: () => void; onShowTasks: () => void }) {
  const { epic, done, total, assignees } = progress;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div
      role="row"
      data-task-id={epic.id}
      onClick={onClick}
      className={cn(
        "flex min-h-10 cursor-default select-none items-center gap-3 px-5 text-sm hover:bg-state-hover max-md:min-h-14 max-md:px-4",
        focused && "bg-state-selected hover:bg-state-selected",
      )}
    >
      <StatusIcon status={epic.status} />
      <span className="w-[60px] shrink-0 truncate text-label font-medium text-ink-subtle max-md:hidden">{epic.key}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-ink max-md:text-base">{epic.title}</span>
        <span className="truncate text-label text-ink-subtle md:hidden">{epic.key}</span>
      </span>
      <span className="flex shrink-0 -space-x-1 max-md:hidden">
        {assignees.map((a) => (
          <AssigneeAvatar key={`${a.type}:${a.id}`} assignee={a} size="xs" className="ring-2 ring-panel" />
        ))}
      </span>
      <button
        type="button"
        title={total ? `${done} of ${total} done · show these tasks` : "No tasks yet"}
        onClick={(ev) => {
          ev.stopPropagation();
          onShowTasks();
        }}
        className="flex shrink-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-state-hover"
      >
        <span className="h-1 w-20 overflow-hidden rounded-full bg-edge max-md:w-12" aria-hidden>
          <span className="block h-full rounded-full bg-ink-muted" style={{ width: `${pct}%` }} />
        </span>
        <span className="w-10 text-right text-label text-ink-subtle">{total ? `${done}/${total}` : "—"}</span>
      </button>
    </div>
  );
}

interface ViewProps {
  projectId: string;
  columns: { status: TaskStatus; tasks: TaskSummary[] }[];
  focusId: string | null;
  onOpen: (t: TaskSummary) => void;
  onCreate: (status: TaskStatus) => void;
  onFocus: (id: string | null) => void;
}

function sortOrderAt(list: TaskSummary[], index: number) {
  const before = list[index - 1];
  const after = list[index];
  if (before && after) return (before.sortOrder + after.sortOrder) / 2;
  if (before) return before.sortOrder + 1;
  if (after) return after.sortOrder - 1;
  return 0;
}

function Board({ projectId, columns, focusId, onOpen, onCreate, onFocus }: ViewProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ status: TaskStatus; index: number } | null>(null);
  const colRefs = useRef(new Map<TaskStatus, HTMLDivElement>());

  const indexAt = (status: TaskStatus, y: number) => {
    const el = colRefs.current.get(status);
    if (!el) return 0;
    const cards = [...el.querySelectorAll<HTMLElement>("[data-task-id]")].filter((c) => c.dataset.taskId !== dragId);
    const i = cards.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i === -1 ? cards.length : i;
  };

  const finish = () => {
    setDragId(null);
    setDrop(null);
  };

  const onDrop = () => {
    if (!dragId || !drop) return finish();
    const task = columns.flatMap((c) => c.tasks).find((t) => t.id === dragId);
    const target = columns.find((c) => c.status === drop.status)?.tasks.filter((t) => t.id !== dragId) ?? [];
    finish();
    if (!task) return;
    const sortOrder = sortOrderAt(target, drop.index);
    if (task.status === drop.status && sortOrder === task.sortOrder) return;
    void updateTask(task, { status: drop.status, sortOrder }, { status: drop.status, sortOrder });
  };

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-5 pb-5 pt-1">
      {columns.map(({ status, tasks }) => {
        const rest = tasks.filter((x) => x.id !== dragId);
        return (
          <div
            key={status}
            ref={(el) => {
              if (el) colRefs.current.set(status, el);
            }}
            className="flex min-w-[248px] flex-1 flex-col"
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const index = indexAt(status, e.clientY);
              if (drop?.status !== status || drop.index !== index) setDrop({ status, index });
            }}
            onDrop={(e) => {
              e.preventDefault();
              onDrop();
            }}
          >
            <div className="flex h-8 shrink-0 items-center gap-2 px-1">
              <StatusIcon status={status} />
              <span className="text-sm font-medium text-ink">{STATUS_LABEL[status]}</span>
              <span className="text-sm text-ink-subtle">{tasks.length}</span>
            </div>
            <ContextArea entries={newTaskEntries(projectId, status)} className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 pb-4 pt-2">
              {tasks.map((t) => {
                const visibleIndex = rest.indexOf(t);
                return (
                  <div key={t.id} className="flex flex-col gap-2">
                    {drop?.status === status && drop.index === visibleIndex && t.id !== dragId && <DropLine />}
                    <TaskRowMenu task={t} onOpen={() => onOpen(t)} onFocus={() => onFocus(t.id)}>
                      <TaskCard
                        task={t}
                        focused={focusId === t.id}
                        dragging={dragId === t.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", t.key);
                          setDragId(t.id);
                        }}
                        onDragEnd={finish}
                        onClick={() => onOpen(t)}
                      />
                    </TaskRowMenu>
                  </div>
                );
              })}
              {drop?.status === status && drop.index >= rest.length && <DropLine />}
              {tasks.length === 0 && !dragId && (
                <button
                  type="button"
                  onClick={() => onCreate(status)}
                  className="flex h-10 items-center justify-center rounded-lg border border-dashed border-edge text-label text-ink-faint hover:text-ink-subtle"
                >
                  No tasks
                </button>
              )}
            </ContextArea>
          </div>
        );
      })}
    </div>
  );
}

function DropLine() {
  return <div className="-my-[5px] h-0.5 rounded-full bg-accent" />;
}

function ListView({ projectId, columns, focusId, onOpen, onFocus }: ViewProps) {
  if (columns.length === 0) {
    return (
      <div className="flex-1">
        <EmptyState title="No tasks match" />
      </div>
    );
  }
  return (
    <ContextArea entries={newTaskEntries(projectId, "todo")} className="min-h-0 flex-1 overflow-y-auto pb-8">
      <div role="table">
        {columns.map(({ status, tasks }) => (
          <ContextArea key={status} entries={newTaskEntries(projectId, status)}>
            <section>
              <GroupHeader status={status} count={tasks.length} sticky />
              {tasks.map((t) => (
                <TaskRowMenu key={t.id} task={t} onOpen={() => onOpen(t)} onFocus={() => onFocus(t.id)}>
                  <TaskRow task={t} focused={focusId === t.id} onClick={() => onOpen(t)} className={cn(focusId === t.id && "bg-state-selected")} />
                </TaskRowMenu>
              ))}
            </section>
          </ContextArea>
        ))}
      </div>
    </ContextArea>
  );
}
