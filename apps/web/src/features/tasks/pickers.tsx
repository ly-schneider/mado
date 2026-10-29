import type { Priority, TaskStatus, TaskSummary } from "@mado/contract";
import { PRIORITIES, PRIORITY_LABEL } from "@mado/contract";
import { Avatar, Badge, cn, Dialog, Popover, PriorityIcon, StatusIcon } from "@mado/ui";
import { Check, Plus, Search, Zap } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { useCommands } from "../../lib/shortcuts";
import { toast } from "../../lib/toast";
import { deleteTask, STATUS_LABEL, STATUS_ORDER, type TaskPatch, updateTask, useAssigneeOptions, useEpics, useLabels } from "./data";

export type PickerKind = "status" | "priority" | "assignee" | "labels" | "epic";

interface Item {
  value: string;
  label: string;
  icon?: ReactNode;
  meta?: ReactNode;
  keywords?: string;
}

/** Filterable list used by every property picker, in popovers and in the keyboard dialog. */
export function PickerList({
  items,
  selected,
  multi,
  onPick,
  onClose,
  placeholder,
  onCreate,
  touch,
}: {
  items: Item[];
  selected: string[];
  multi?: boolean;
  onPick: (value: string) => void;
  onClose?: () => void;
  placeholder: string;
  onCreate?: (name: string) => void;
  touch?: boolean;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((i) => `${i.label} ${i.keywords ?? ""}`.toLowerCase().includes(s));
  }, [items, q]);
  const canCreate = !!onCreate && q.trim().length > 0 && !items.some((i) => i.label.toLowerCase() === q.trim().toLowerCase());
  const total = filtered.length + (canCreate ? 1 : 0);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (i: number) => {
    if (i === filtered.length && canCreate) {
      onCreate?.(q.trim());
      setQ("");
      return;
    }
    const item = filtered[i];
    if (!item) return;
    onPick(item.value);
    if (!multi) onClose?.();
  };

  return (
    <div className="flex flex-col">
      <div className="flex h-10 items-center gap-2 border-b border-edge px-3">
        <Search className="size-4 shrink-0 text-ink-subtle" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className={cn("h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint", touch && "text-touch")}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
              e.preventDefault();
              setActive((a) => Math.min(total - 1, a + 1));
            } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(active);
            } else if (e.key === "Escape") {
              e.stopPropagation();
              onClose?.();
            }
          }}
        />
      </div>
      <div ref={listRef} role="listbox" className="max-h-72 overflow-y-auto p-1">
        {filtered.map((item, i) => (
          <button
            key={item.value}
            type="button"
            role="option"
            aria-selected={selected.includes(item.value)}
            data-index={i}
            onMouseMove={() => setActive(i)}
            onClick={() => pick(i)}
            className={cn(
              "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm text-ink outline-none [&_svg]:shrink-0",
              touch && "h-11 text-touch",
              i === active && "bg-state-active",
            )}
          >
            {item.icon && <span className="flex size-5 items-center justify-center">{item.icon}</span>}
            <span className="flex-1 truncate">{item.label}</span>
            {item.meta}
            {selected.includes(item.value) && <Check className="size-4 text-ink-subtle" />}
          </button>
        ))}
        {canCreate && (
          <button
            type="button"
            data-index={filtered.length}
            onMouseMove={() => setActive(filtered.length)}
            onClick={() => pick(filtered.length)}
            className={cn("flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm text-ink-muted", active === filtered.length && "bg-state-active")}
          >
            <Plus className="size-4 text-ink-subtle" />
            Create label “{q.trim()}”
          </button>
        )}
        {total === 0 && <div className="px-2 py-3 text-center text-label text-ink-subtle">No matches</div>}
      </div>
    </div>
  );
}

/** The fields a picker reads. Tasks satisfy it, and so does the quick-capture draft. */
export type PickerTarget = Pick<TaskSummary, "projectId" | "status" | "priority" | "assignee" | "labels" | "epic">;

const PLACEHOLDER: Record<PickerKind, string> = {
  status: "Change status…",
  priority: "Set priority…",
  assignee: "Assign to…",
  labels: "Add labels…",
  epic: "Move to epic…",
};

/** One property picker. `onChange` gets the wire patch and the optimistic fields. */
export function PropertyList({
  kind,
  target,
  onChange,
  onClose,
  touch,
}: {
  kind: PickerKind;
  target: PickerTarget;
  onChange: (patch: TaskPatch, optimistic: Partial<TaskSummary>) => void;
  onClose?: () => void;
  touch?: boolean;
}) {
  const assignees = useAssigneeOptions();
  const labels = useLabels(kind === "labels" ? target.projectId : undefined);
  const epics = useEpics(kind === "epic" ? target.projectId : undefined);

  let items: Item[] = [];
  let selected: string[] = [];
  let pick: (v: string) => void = () => {};
  let onCreate: ((name: string) => void) | undefined;

  if (kind === "status") {
    items = STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s], icon: <StatusIcon status={s} /> }));
    selected = [target.status];
    pick = (v) => onChange({ status: v as TaskStatus }, { status: v as TaskStatus });
  } else if (kind === "priority") {
    items = PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p], icon: <PriorityIcon priority={p} /> }));
    selected = [target.priority];
    pick = (v) => onChange({ priority: v as Priority }, { priority: v as Priority });
  } else if (kind === "assignee") {
    items = [
      { value: "none", label: "No assignee", icon: <span className="size-5 rounded-full border border-dashed border-ink-faint" /> },
      ...assignees.map((a) => ({
        value: a.value,
        label: a.name,
        icon: <Avatar type={a.type} initials={a.initials} size="sm" />,
        meta: a.type === "agent" ? <Badge>agent</Badge> : undefined,
      })),
    ];
    selected = [target.assignee ? `${target.assignee.type}:${target.assignee.id}` : "none"];
    pick = (v) => {
      const a = assignees.find((x) => x.value === v) ?? null;
      onChange({ assignee: a ? a.value : null }, { assignee: a ? { type: a.type, id: a.id, name: a.name, initials: a.initials } : null });
    };
  } else if (kind === "labels") {
    const all = labels.data ?? [];
    items = all.map((l) => ({ value: l.id, label: l.name, icon: <span className="size-2 rounded-full bg-ink-subtle" /> }));
    selected = target.labels.map((l) => l.id);
    const setLabels = (next: PickerTarget["labels"]) => onChange({ labelIds: next.map((l) => l.id) }, { labels: next });
    pick = (v) => {
      const on = target.labels.some((l) => l.id === v);
      const label = all.find((l) => l.id === v);
      if (!label) return;
      setLabels(on ? target.labels.filter((l) => l.id !== v) : [...target.labels, { id: label.id, name: label.name, color: label.color }]);
    };
    onCreate = async (name) => {
      try {
        const created = await client.project.createLabel({ projectId: target.projectId, name, color: "grey" });
        queryClient.setQueryData(orpc.project.labels.queryKey({ input: { projectId: target.projectId } }), (old: typeof all | undefined) => [...(old ?? []), created]);
        setLabels([...target.labels, { id: created.id, name: created.name, color: created.color }]);
      } catch (e) {
        toast.error(errorMessage(e));
      }
    };
  } else {
    items = [
      { value: "none", label: "No epic", icon: <Zap className="size-4 text-ink-faint" /> },
      ...(epics.data ?? []).map((e) => ({ value: e.id, label: e.title, keywords: e.key, icon: <Zap className="size-4 text-ink-subtle" />, meta: <span className="text-label text-ink-subtle">{e.key}</span> })),
    ];
    selected = [target.epic?.id ?? "none"];
    pick = (v) => {
      const e = epics.data?.find((x) => x.id === v);
      onChange({ epicId: e ? e.id : null }, { epic: e ? { id: e.id, key: e.key, title: e.title } : null });
    };
  }

  return (
    <PickerList
      items={items}
      selected={selected}
      multi={kind === "labels"}
      onPick={pick}
      onClose={onClose}
      onCreate={onCreate}
      placeholder={PLACEHOLDER[kind]}
      touch={touch}
    />
  );
}

/** A property picker anchored to its trigger (pills, properties panel, capture pills). */
export function PickerPopover({
  kind,
  target,
  onChange,
  children,
  className,
  align = "start",
  label,
}: {
  kind: PickerKind;
  target: PickerTarget;
  onChange: (patch: TaskPatch, optimistic: Partial<TaskSummary>) => void;
  children: ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger aria-label={label} className={className}>
        {children}
      </Popover.Trigger>
      <Popover.Popup align={align} className="w-64 overflow-hidden">
        {open && <PropertyList kind={kind} target={target} onChange={onChange} onClose={() => setOpen(false)} />}
      </Popover.Popup>
    </Popover.Root>
  );
}

/** Applies a picker change to a real task. */
export const applyToTask = (task: Pick<TaskSummary, "id" | "key">) => (patch: TaskPatch, optimistic: Partial<TaskSummary>) => {
  void updateTask(task, patch, optimistic);
};

// ── Keyboard pickers: s / p / a / l on the focused task ─────────────────

let pickerState: { kind: PickerKind; task: TaskSummary } | null = null;
const pickerListeners = new Set<() => void>();
function setPicker(next: typeof pickerState) {
  pickerState = next;
  for (const l of pickerListeners) l();
}
export const openPicker = (kind: PickerKind, task: TaskSummary) => setPicker({ kind, task });

/** Mount once per screen that uses the task hotkeys. */
export function PickerHost() {
  const state = useSyncExternalStore(
    (l) => {
      pickerListeners.add(l);
      return () => pickerListeners.delete(l);
    },
    () => pickerState,
  );
  const [task, setTask] = useState(state?.task);
  useEffect(() => setTask(state?.task), [state]);
  const close = () => setPicker(null);
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && close()} position="top" title={state ? PLACEHOLDER[state.kind] : "Picker"} className="max-w-[420px]">
      {state && task && (
        <>
          <div className="flex h-8 items-center gap-2 border-b border-edge px-3 text-label text-ink-subtle">
            <span className="shrink-0">{task.key}</span>
            <span className="truncate">{task.title}</span>
          </div>
          <PropertyList
            kind={state.kind}
            target={task}
            onClose={close}
            onChange={(patch, optimistic) => {
              setTask((t) => (t ? { ...t, ...optimistic } : t));
              void updateTask(task, patch, optimistic);
            }}
          />
        </>
      )}
    </Dialog>
  );
}

/** s status · p priority · a assign · l labels · ⌫ delete, on whatever task the screen has focused. */
export function useTaskHotkeys(getTask: () => TaskSummary | undefined, opts: { onDeleted?: () => void } = {}, deps: unknown[] = []) {
  const withTask = (fn: (t: TaskSummary) => void) => () => {
    const t = getTask();
    if (t) fn(t);
  };
  useCommands(
    [
      { id: "task.status", title: "Change status", keys: "s", hint: "S", group: "Tasks", run: withTask((t) => openPicker("status", t)) },
      { id: "task.priority", title: "Set priority", keys: "p", hint: "P", group: "Tasks", run: withTask((t) => openPicker("priority", t)) },
      { id: "task.assign", title: "Assign to…", keys: "a", hint: "A", group: "Tasks", run: withTask((t) => openPicker("assignee", t)) },
      { id: "task.labels", title: "Change labels", keys: "l", hint: "L", group: "Tasks", run: withTask((t) => openPicker("labels", t)) },
      { id: "task.epic", title: "Move to epic", keys: "Shift+E", hint: "⇧E", group: "Tasks", run: withTask((t) => openPicker("epic", t)) },
      {
        id: "task.delete",
        title: "Delete task",
        keys: "Backspace, Delete, $mod+Backspace",
        hint: "⌫",
        group: "Tasks",
        run: withTask(async (t) => {
          if (await deleteTask(t)) opts.onDeleted?.();
        }),
      },
    ],
    deps,
  );
}
