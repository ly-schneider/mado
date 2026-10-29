import type { TaskStatus, TaskSummary } from "@mado/contract";
import { Button, cn, EmptyState, Menu, Segmented, Spinner, StatusIcon } from "@mado/ui";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Ellipsis, EyeOff, ListFilter, Plus, SquareKanban } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TaskView } from "../../router";
import { useCommands } from "../../lib/shortcuts";
import { openCapture, pushRecent } from "../../lib/ui";
import { useProject, useWorkspace } from "../../lib/workspace";
import { MobileTitle, PageHeader } from "../shell/PageHeader";
import { ACTIVE_FIRST, groupByStatus, setDisplay, STATUS_LABEL, updateTask, useDisplay, useProjectTasks, noOverlay } from "./data";
import { DisplayMenu, FilterBar, ghostButton, hasFilters, type TaskFilters, useFilterPredicate } from "./FilterBar";
import { PickerHost, useTaskHotkeys } from "./pickers";
import { GroupHeader, TaskCard, TaskRow, TaskRowPhone } from "./TaskBits";

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

  const visible: TaskStatus[] = useMemo(() => {
    const order = view === "board" ? (["backlog", ...BOARD_CORE, "done", "canceled"] as TaskStatus[]) : ACTIVE_FIRST;
    // A status filter names the columns explicitly, overriding the Display toggles.
    if (filters.status) return order.filter((s) => filters.status!.split(",").includes(s));
    return order.filter((s) => (s === "backlog" ? display.showBacklog : s === "done" ? display.showDone : s === "canceled" ? display.showCanceled : true));
  }, [view, display, filters.status]);

  const hiddenText = useMemo(() => {
    const parts: string[] = [];
    for (const s of ["backlog", "done", "canceled"] as TaskStatus[]) {
      const n = groups.get(s)?.length ?? 0;
      if (!visible.includes(s) && n > 0) parts.push(`${STATUS_LABEL[s]} ${n}`);
    }
    return parts.length ? `${parts.join(" · ")} hidden` : null;
  }, [groups, visible]);

  /** Board columns, or list groups with tasks, in on-screen order. */
  const columns = useMemo(
    () => visible.map((s) => ({ status: s, tasks: groups.get(s) ?? [] })).filter((c) => view === "board" || c.tasks.length > 0),
    [visible, groups, view],
  );
  const flat = useMemo(() => columns.flatMap((c) => c.tasks), [columns]);
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
  const setView = (v: TaskView) => navigate({ search: (s) => ({ ...s, view: v === "list" ? "list" : undefined }), replace: true });
  const create = (status?: TaskStatus) => project && openCapture("task", { projectId: project.id, status });

  const move = (dir: 1 | -1) => {
    if (!flat.length) return;
    if (!focused) return setFocusId(flat[dir === 1 ? 0 : flat.length - 1]!.id);
    if (view === "list") {
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
      { id: "tasks.create", title: "Create task", subtitle: project ? `in ${project.name}` : undefined, keys: "c", hint: "C", group: "Actions", run: () => create() },
      { id: "tasks.view.board", title: "Show as board", keys: "v b", hint: "V then B", group: "Tasks", run: () => setView("board") },
      { id: "tasks.view.list", title: "Show as list", keys: "v l", hint: "V then L", group: "Tasks", run: () => setView("list") },
      { id: "tasks.filter", title: "Add filter", keys: "f", hint: "F", group: "Tasks", run: () => setAddOpen(true) },
      { id: "tasks.filter.clear", title: "Clear filters", group: "Tasks", run: () => setFilters({ labels: undefined, epic: undefined, assignee: undefined }), when: () => hasFilters(filters) },
      { id: "tasks.backlog", title: display.showBacklog ? "Hide backlog" : "Show backlog", group: "Tasks", run: () => setDisplay({ showBacklog: !display.showBacklog }) },
      { id: "tasks.canceled", title: display.showCanceled ? "Hide canceled" : "Show canceled", group: "Tasks", run: () => setDisplay({ showCanceled: !display.showCanceled }) },
    ],
    [flat, focused, view, project?.id, display, search],
  );
  useTaskHotkeys(() => focused, { onDeleted: () => move(1) }, [focused]);

  if (!project) {
    return <EmptyState icon={<SquareKanban />} title="Project not found">There is no project with the key {key} in this workspace.</EmptyState>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumbs={[{ label: ws.name }, { label: "Tasks" }]}
        center={
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "board", label: "Board" },
              { value: "list", label: "List" },
            ]}
          />
        }
        mobileActions={null}
      >
        <button type="button" className={ghostButton} onClick={() => setAddOpen(true)}>
          <ListFilter />
          Filter
        </button>
        <DisplayMenu />
        <Button variant="primary" icon={<Plus />} kbd="C" onClick={() => create()}>
          New task
        </Button>
      </PageHeader>
      <MobileTitle title={project.name} subtitle={`${filtered.filter((t) => t.status !== "done" && t.status !== "canceled").length} open`} />
      <FilterBar projectId={project.id} filters={filters} onChange={setFilters} addOpen={addOpen} setAddOpen={setAddOpen} hiddenText={hiddenText} />

      {tasks.isPending && !tasks.data ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="hidden min-h-0 flex-1 md:flex">
            {view === "board" ? (
              <Board columns={columns} focusId={focusId} onOpen={open} onCreate={create} onFocus={setFocusId} />
            ) : (
              <ListView columns={columns} focusId={focusId} onOpen={open} onCreate={create} onFocus={setFocusId} />
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-32 md:hidden">
            {ACTIVE_FIRST.filter((s) => s !== "canceled").map((s) => {
              const list = groups.get(s) ?? [];
              if (!list.length) return null;
              return (
                <section key={s}>
                  <GroupHeader status={s} count={list.length} className="bg-page px-4" />
                  {list.map((t) => (
                    <TaskRowPhone key={t.id} task={t} onClick={() => open(t)} />
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

interface ViewProps {
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

function Board({ columns, focusId, onOpen, onCreate }: ViewProps) {
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
            <div className="group flex h-8 shrink-0 items-center gap-2 pl-1 pr-1">
              <StatusIcon status={status} />
              <span className="text-label font-medium text-ink">{STATUS_LABEL[status]}</span>
              <span className="text-label text-ink-subtle">{tasks.length}</span>
              <div className="flex-1" />
              <button type="button" aria-label={`New task in ${STATUS_LABEL[status]}`} onClick={() => onCreate(status)} className="rounded-md p-1 text-ink-subtle hover:bg-state-hover hover:text-ink">
                <Plus className="size-4" />
              </button>
              <ColumnMenu status={status} onCreate={() => onCreate(status)} />
            </div>
            <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 pb-4 pt-2">
              {tasks.map((t) => {
                const visibleIndex = rest.indexOf(t);
                return (
                  <div key={t.id} className="flex flex-col gap-2">
                    {drop?.status === status && drop.index === visibleIndex && t.id !== dragId && <DropLine />}
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
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DropLine() {
  return <div className="-my-[5px] h-0.5 rounded-full bg-accent" />;
}

function ColumnMenu({ status, onCreate }: { status: TaskStatus; onCreate: () => void }) {
  const hideKey = status === "backlog" ? "showBacklog" : status === "done" ? "showDone" : status === "canceled" ? "showCanceled" : null;
  return (
    <Menu.Root>
      <Menu.Trigger aria-label={`${STATUS_LABEL[status]} options`} className="rounded-md p-1 text-ink-subtle outline-none hover:bg-state-hover hover:text-ink data-[popup-open]:bg-state-active">
        <Ellipsis className="size-4" />
      </Menu.Trigger>
      <Menu.Popup align="end">
        <Menu.Item icon={<Plus />} onClick={onCreate}>
          New task in {STATUS_LABEL[status]}
        </Menu.Item>
        {hideKey && (
          <Menu.Item icon={<EyeOff />} onClick={() => setDisplay({ [hideKey]: false })}>
            Hide column
          </Menu.Item>
        )}
      </Menu.Popup>
    </Menu.Root>
  );
}

function ListView({ columns, focusId, onOpen, onCreate }: ViewProps) {
  if (columns.length === 0) {
    return (
      <div className="flex-1">
        <EmptyState icon={<SquareKanban />} title="No tasks match">
          Change the filters or press C to create a task.
        </EmptyState>
      </div>
    );
  }
  return (
    <div role="table" className="min-h-0 flex-1 overflow-y-auto pb-8">
      {columns.map(({ status, tasks }) => (
        <section key={status}>
          <GroupHeader status={status} count={tasks.length} onAdd={() => onCreate(status)} sticky />
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} focused={focusId === t.id} onClick={() => onOpen(t)} className={cn(focusId === t.id && "bg-state-selected")} />
          ))}
        </section>
      ))}
    </div>
  );
}
