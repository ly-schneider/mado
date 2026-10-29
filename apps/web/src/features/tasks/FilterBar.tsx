import { STATUS_LABEL, TASK_STATUSES, type TaskStatus, type TaskSummary } from "@mado/contract";
import { Avatar, cn, Popover, StatusIcon, Switch } from "@mado/ui";
import { ChevronLeft, CircleDashed, CircleUser, ListFilter, Tag, X, Zap } from "@mado/ui/fluent";
import { type ReactNode, useMemo, useState } from "react";
import { useMe } from "../../lib/workspace";
import { type DisplaySettings, setDisplay, useAssigneeOptions, useDisplay, useEpics, useLabels } from "./data";
import { PickerList } from "./pickers";

export interface TaskFilters {
  status?: string;
  labels?: string;
  epic?: string;
  assignee?: string;
}
type Field = "status" | "labels" | "epic" | "assignee";

const split = (v: string | undefined) => (v ? v.split(",").filter(Boolean) : []);
const join = (list: string[]) => (list.length ? list.join(",") : undefined);

export function hasFilters(f: TaskFilters) {
  return !!(f.status || f.labels || f.epic || f.assignee);
}

/** URL filters → predicate. Labels by name (readable URLs), epic by key, assignee by "me" / "none" / "user:<id>" / "agent:<id>". */
export function useFilterPredicate(f: TaskFilters) {
  const me = useMe().data;
  return useMemo(() => {
    const labels = split(f.labels).map((s) => s.toLowerCase());
    const assignees = split(f.assignee);
    const statuses = split(f.status);
    return (t: TaskSummary) => {
      if (statuses.length && !statuses.includes(t.status)) return false;
      if (labels.length && !t.labels.some((l) => labels.includes(l.name.toLowerCase()))) return false;
      if (f.epic && t.epic?.key !== f.epic) return false;
      if (assignees.length) {
        const v = t.assignee ? `${t.assignee.type}:${t.assignee.id}` : "none";
        const ok = assignees.some((a) => a === v || (a === "me" && me && v === `user:${me.id}`));
        if (!ok) return false;
      }
      return true;
    };
  }, [f.status, f.labels, f.epic, f.assignee, me]);
}

function useFieldItems(projectId: string, field: Field) {
  const labels = useLabels(projectId);
  const epics = useEpics(projectId);
  const assignees = useAssigneeOptions();
  const me = useMe().data;
  return useMemo(() => {
    if (field === "status") return TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s], icon: <StatusIcon status={s} /> }));
    if (field === "labels") return (labels.data ?? []).map((l) => ({ value: l.name, label: l.name, icon: <span className="size-2 rounded-full bg-ink-subtle" /> }));
    if (field === "epic") return (epics.data ?? []).map((e) => ({ value: e.key, label: e.title, keywords: e.key, icon: <Zap className="size-4 text-ink-subtle" />, meta: <span className="text-label text-ink-subtle">{e.key}</span> }));
    return [
      { value: "me", label: `Me${me ? ` (${me.name.split(" ")[0]})` : ""}`, icon: <Avatar type="user" initials={me?.initials} size="sm" /> },
      { value: "none", label: "No assignee", icon: <span className="size-5 rounded-full border border-dashed border-ink-faint" /> },
      ...assignees.filter((a) => a.id !== me?.id).map((a) => ({ value: a.value, label: a.name, icon: <Avatar type={a.type} initials={a.initials} size="sm" /> })),
    ];
  }, [field, labels.data, epics.data, assignees, me]);
}

function FieldPicker({ projectId, field, filters, onChange, onClose }: { projectId: string; field: Field; filters: TaskFilters; onChange: (f: TaskFilters) => void; onClose: () => void }) {
  const items = useFieldItems(projectId, field);
  const selected = field === "epic" ? split(filters.epic) : split(filters[field]);
  return (
    <PickerList
      items={items}
      selected={selected}
      multi={field !== "epic"}
      onClose={onClose}
      placeholder={field === "status" ? "Filter by status…" : field === "labels" ? "Filter by label…" : field === "epic" ? "Filter by epic…" : "Filter by assignee…"}
      onPick={(v) => {
        if (field === "epic") onChange({ ...filters, epic: filters.epic === v ? undefined : v });
        else onChange({ ...filters, [field]: join(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]) });
      }}
    />
  );
}

const FIELD_META: Record<Field, { icon: ReactNode; name: string }> = {
  status: { icon: <CircleDashed />, name: "Status" },
  labels: { icon: <Tag />, name: "Label" },
  epic: { icon: <Zap />, name: "Epic" },
  assignee: { icon: <CircleUser />, name: "Assignee" },
};

/** "Label | is any of | Backend, Frontend | ×" from the Board design. */
function FilterChip({ projectId, field, filters, onChange, display }: { projectId: string; field: Field; filters: TaskFilters; onChange: (f: TaskFilters) => void; display: string }) {
  const [open, setOpen] = useState(false);
  const values = split(filters[field]);
  const op = field === "epic" ? "is" : values.length > 1 ? "is any of" : "is";
  const seg = "flex h-full items-center px-2";
  return (
    <div className="flex h-7 shrink-0 items-center divide-x divide-edge rounded-md border border-edge text-label">
      <span className={cn(seg, "gap-1.5 font-medium text-ink-muted [&_svg]:size-4 [&_svg]:text-ink-subtle")}>
        {FIELD_META[field].icon}
        {FIELD_META[field].name}
      </span>
      <span className={cn(seg, "text-ink-subtle")}>{op}</span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger className={cn(seg, "max-w-72 truncate font-medium text-ink outline-none hover:bg-state-hover")}>{display}</Popover.Trigger>
        <Popover.Popup className="w-64 overflow-hidden">
          {open && <FieldPicker projectId={projectId} field={field} filters={filters} onChange={onChange} onClose={() => setOpen(false)} />}
        </Popover.Popup>
      </Popover.Root>
      <button type="button" aria-label={`Remove ${FIELD_META[field].name} filter`} onClick={() => onChange({ ...filters, [field]: undefined })} className={cn(seg, "w-8 justify-center text-ink-subtle hover:bg-state-hover hover:text-ink")}>
        <X className="size-4" />
      </button>
    </div>
  );
}

/** The single header filter button: add-filter picker on top, Display toggles below. */
export function FilterMenu({ projectId, filters, onChange, open, onOpenChange }: { projectId: string; filters: TaskFilters; onChange: (f: TaskFilters) => void; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [field, setField] = useState<Field | null>(null);
  const display = useDisplay();
  const row = (key: keyof DisplaySettings, label: string) => (
    <label className="flex h-8 items-center justify-between gap-4 rounded-md px-2 text-sm text-ink">
      {label}
      <Switch checked={display[key]} onChange={(v) => setDisplay({ [key]: v })} label={label} />
    </label>
  );
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setField(null);
      }}
    >
      <Popover.Trigger
        aria-label="Filter and display (F)"
        title="Filter and display (F)"
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-subtle outline-none hover:bg-state-hover hover:text-ink active:bg-state-active data-[popup-open]:bg-state-active [&_svg]:size-4",
          hasFilters(filters) && "text-ink",
        )}
      >
        <ListFilter />
      </Popover.Trigger>
      <Popover.Popup align="end" className="w-64 overflow-hidden">
        {open && !field && (
          <div className="p-1">
            <div className="px-2 pb-1 pt-1.5 text-label text-ink-subtle">Filter</div>
            {(Object.keys(FIELD_META) as Field[]).map((f) => (
              <button
                key={f}
                type="button"
                autoFocus={f === "status"}
                onClick={() => setField(f)}
                className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm text-ink outline-none hover:bg-state-active focus:bg-state-active [&_svg]:size-4 [&_svg]:text-ink-subtle"
              >
                {FIELD_META[f].icon}
                <span className="flex-1">{FIELD_META[f].name}</span>
                {filters[f] && <span className="text-label text-ink-subtle">{split(filters[f]).length}</span>}
              </button>
            ))}
            <div className="mx-1 my-1 h-px bg-edge" />
            <div className="px-2 pb-1 pt-1.5 text-label text-ink-subtle">Display</div>
            {row("showBacklog", "Show backlog")}
            {row("showDone", "Show done")}
            {row("showCanceled", "Show canceled")}
          </div>
        )}
        {open && field && (
          <>
            <button type="button" onClick={() => setField(null)} className="flex h-7 w-full items-center gap-1 border-b border-edge px-2 text-label text-ink-subtle hover:text-ink">
              <ChevronLeft className="size-3.5" />
              {FIELD_META[field].name}
            </button>
            <FieldPicker projectId={projectId} field={field} filters={filters} onChange={onChange} onClose={() => onOpenChange(false)} />
          </>
        )}
      </Popover.Popup>
    </Popover.Root>
  );
}

/** Active filter chips; renders nothing when no filter is set. */
export function FilterBar({ projectId, filters, onChange }: { projectId: string; filters: TaskFilters; onChange: (f: TaskFilters) => void }) {
  const labels = useLabels(projectId);
  const epics = useEpics(projectId);
  const assignees = useAssigneeOptions();
  if (!hasFilters(filters)) return null;
  const labelNames = split(filters.labels).map((n) => labels.data?.find((l) => l.name.toLowerCase() === n.toLowerCase())?.name ?? n);
  const epic = epics.data?.find((e) => e.key === filters.epic);
  const assigneeNames = split(filters.assignee).map((a) => (a === "me" ? "Me" : a === "none" ? "No assignee" : (assignees.find((x) => x.value === a)?.name ?? "Unknown")));
  return (
    <div className="hidden h-11 shrink-0 items-center gap-2 overflow-x-auto px-5 md:flex">
      {filters.status && (
        <FilterChip
          projectId={projectId}
          field="status"
          filters={filters}
          onChange={onChange}
          display={split(filters.status)
            .map((s) => STATUS_LABEL[s as TaskStatus] ?? s)
            .join(", ")}
        />
      )}
      {filters.labels && <FilterChip projectId={projectId} field="labels" filters={filters} onChange={onChange} display={labelNames.join(", ")} />}
      {filters.epic && <FilterChip projectId={projectId} field="epic" filters={filters} onChange={onChange} display={epic ? `${epic.key} ${epic.title}` : filters.epic} />}
      {filters.assignee && <FilterChip projectId={projectId} field="assignee" filters={filters} onChange={onChange} display={assigneeNames.join(", ")} />}
      <button
        type="button"
        onClick={() => onChange({ status: undefined, labels: undefined, epic: undefined, assignee: undefined })}
        className="inline-flex h-7 shrink-0 items-center rounded-md px-2 text-label font-medium text-ink-subtle hover:bg-state-hover hover:text-ink"
      >
        Clear
      </button>
    </div>
  );
}
