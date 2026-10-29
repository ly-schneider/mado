import {
  type ExpiryOption,
  type GrantInput,
  type GrantLevel,
  type ResourceType,
  RESOURCE_TYPES,
  TRASH_RETENTION_DAYS,
} from "@mado/contract";
import { Checkbox, cn, Field, Input, Segmented, Select } from "@mado/ui";
import { Clock, Lock, Trash2 } from "lucide-react";
import { Fragment } from "react";

export interface PickerProject {
  id: string;
  key: string;
  name: string;
  workspaceName?: string;
}

/** Client-side state of the privilege picker shared by the consent screen and personal access tokens. */
export interface GrantDraft {
  agentName: string;
  all: boolean;
  allLevel: GrantLevel;
  checked: Record<string, boolean>;
  levels: Record<string, GrantLevel>;
  resourceTypes: ResourceType[];
  expiry: ExpiryOption;
}

export function emptyDraft(agentName = ""): GrantDraft {
  return { agentName, all: false, allLevel: "read", checked: {}, levels: {}, resourceTypes: [...RESOURCE_TYPES], expiry: "30d" };
}

export function draftToInput(d: GrantDraft): GrantInput {
  return {
    agentName: d.agentName.trim(),
    projectScope: d.all ? "all" : "listed",
    allLevel: d.allLevel,
    projects: d.all
      ? []
      : Object.entries(d.checked)
          .filter(([, on]) => on)
          .map(([projectId]) => ({ projectId, level: d.levels[projectId] ?? "read" })),
    resourceTypes: d.resourceTypes,
    expiry: d.expiry,
  };
}

export function grantedCount(d: GrantDraft) {
  return Object.values(d.checked).filter(Boolean).length;
}

export function draftValid(d: GrantDraft) {
  return d.agentName.trim().length > 0 && (d.all || grantedCount(d) > 0) && d.resourceTypes.length > 0;
}

export function grantSummary(d: GrantDraft) {
  if (d.all) return "Grants all projects, including future ones";
  const n = grantedCount(d);
  return n === 0 ? "No projects ticked" : `Grants ${n} project${n === 1 ? "" : "s"}`;
}

export const LEVEL_OPTIONS: { value: GrantLevel; label: string }[] = [
  { value: "read", label: "Read" },
  { value: "write", label: "Write" },
  { value: "delete", label: "Delete" },
];

export const LEVEL_LABEL: Record<GrantLevel, string> = { read: "Read", write: "Write", delete: "Delete" };

export const EXPIRY_LABEL: Record<ExpiryOption, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days", never: "No expiry" };

const RESOURCE_LABEL: Record<ResourceType, string> = { docs: "Docs", tasks: "Tasks", comments: "Comments", crm: "CRM" };

export function LevelSegmented({ value, onChange, disabled, size = "md" }: { value: GrantLevel; onChange: (v: GrantLevel) => void; disabled?: boolean; size?: "sm" | "md" }) {
  return <Segmented value={value} onChange={onChange} options={LEVEL_OPTIONS} disabled={disabled} size={size} className={cn("p-0.5", disabled && "opacity-40")} />;
}

export function AgentNameField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <Field label="Agent name" hint="shown as the actor in the audit log">
      <Input value={value} autoFocus={autoFocus} maxLength={80} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function ProjectLevelTable({ projects, draft, onChange }: { projects: PickerProject[]; draft: GrantDraft; onChange: (d: GrantDraft) => void }) {
  const groups = new Map<string, PickerProject[]>();
  for (const p of projects) {
    const k = p.workspaceName ?? "";
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  // Group headers only help when a workspace holds several projects; one project per workspace reads fine flat.
  const showGroups = groups.size > 1 && [...groups.values()].some((list) => list.length > 1);
  return (
    <div className="flex flex-col">
      <div className="flex h-7 items-center gap-2 text-label">
        <span className="font-medium text-ink">Projects and level</span>
        <span className="ml-auto hidden text-ink-subtle sm:inline">Read · Write · Delete (soft)</span>
      </div>
      <div className="divide-y divide-edge overflow-hidden rounded-lg border border-edge">
        {[...groups.entries()].map(([group, list]) => (
          <Fragment key={group}>
            {showGroups && <div className="flex h-8 items-center bg-page px-3 text-label font-medium text-ink-subtle">{group}</div>}
            {list.map((p) => {
              const on = draft.all || !!draft.checked[p.id];
              const level = draft.all ? draft.allLevel : (draft.levels[p.id] ?? "read");
              return (
                <div key={p.id} className={cn("flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 py-1.5 pl-3 pr-2", draft.all && "opacity-50")}>
                  <Checkbox
                    checked={on}
                    disabled={draft.all}
                    label={`Grant ${p.name}`}
                    onChange={(v) => onChange({ ...draft, checked: { ...draft.checked, [p.id]: v } })}
                  />
                  <button
                    type="button"
                    disabled={draft.all}
                    className="flex min-w-0 flex-1 items-baseline gap-3 text-left outline-none"
                    onClick={() => onChange({ ...draft, checked: { ...draft.checked, [p.id]: !draft.checked[p.id] } })}
                  >
                    <span className={cn("truncate text-sm", on ? "text-ink" : "text-ink-subtle")}>{p.name}</span>
                    <span className="shrink-0 text-label font-medium text-ink-subtle">{p.key}</span>
                  </button>
                  <div className="basis-full pl-7 sm:basis-auto sm:pl-0">
                    <LevelSegmented
                      value={level}
                      disabled={!on || draft.all}
                      onChange={(v) => onChange({ ...draft, levels: { ...draft.levels, [p.id]: v } })}
                    />
                  </div>
                </div>
              );
            })}
          </Fragment>
        ))}
        <div className="flex min-h-10 items-center gap-3 bg-page py-1.5 pl-3 pr-2">
          <Checkbox checked={draft.all} label="All projects, including future ones" onChange={(v) => onChange({ ...draft, all: v })} />
          <button type="button" className="min-w-0 flex-1 truncate text-left text-sm outline-none" onClick={() => onChange({ ...draft, all: !draft.all })}>
            <span className={draft.all ? "text-ink" : "text-ink-subtle"}>All projects, including future ones</span>
          </button>
          {draft.all && <LevelSegmented value={draft.allLevel} onChange={(v) => onChange({ ...draft, allLevel: v })} />}
        </div>
      </div>
    </div>
  );
}

export function ExpiryBlock({ value, onChange }: { value: ExpiryOption; onChange: (v: ExpiryOption) => void }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <div className="flex w-full flex-col gap-1.5 sm:w-[180px] sm:shrink-0">
        <span className="text-label font-medium text-ink">Expiry</span>
        <Select value={value} onChange={onChange} options={(Object.keys(EXPIRY_LABEL) as ExpiryOption[]).map((v) => ({ value: v, label: EXPIRY_LABEL[v] }))} />
      </div>
      <ul className="flex min-w-0 flex-col gap-1.5 text-label text-ink-muted sm:pt-[22px] [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-subtle">
        <li className="flex items-center gap-2">
          <Trash2 />
          Deletes are soft: items stay in the trash for {TRASH_RETENTION_DAYS} days.
        </li>
        <li className="flex items-center gap-2">
          <Lock />
          Purge is never grantable. Only you, in the UI.
        </li>
        <li className="flex items-center gap-2">
          <Clock />
          Access token 15 min, refresh token rotates.
        </li>
      </ul>
    </div>
  );
}

export function ResourceTypesRow({ value, onChange }: { value: ResourceType[]; onChange: (v: ResourceType[]) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-label font-medium text-ink">Resources</span>
      {RESOURCE_TYPES.map((t) => {
        const on = value.includes(t);
        // At least one type stays on; the grant would be useless otherwise.
        const last = on && value.length === 1;
        return (
          <label key={t} className={cn("flex items-center gap-2 text-sm", on ? "text-ink" : "text-ink-subtle", last && "opacity-60")}>
            <Checkbox
              checked={on}
              disabled={last}
              label={RESOURCE_LABEL[t]}
              onChange={(v) => onChange(v ? RESOURCE_TYPES.filter((x) => x === t || value.includes(x)) : value.filter((x) => x !== t))}
            />
            {RESOURCE_LABEL[t]}
          </label>
        );
      })}
    </div>
  );
}
