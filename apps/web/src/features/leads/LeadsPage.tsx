import { LEAD_STAGES, type LeadStage, type LeadSummary, type Project, STAGE_LABEL } from "@mado/contract";
import { Avatar, Button, Checkbox, cn, Dialog, Field, IconButton, Input, Popover, Segmented, Select, Spinner, StatusIcon } from "@mado/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ListFilter, Plus } from "@mado/ui/fluent";
import { type DragEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { useCommands, useListNavigation } from "../../lib/shortcuts";
import { shortDate } from "../../lib/time";
import { toast } from "../../lib/toast";
import { pushRecent } from "../../lib/ui";
import { useProject, useWorkspace } from "../../lib/workspace";
import { useIsPhone, useMedia } from "../settings/shared";
import { MobileTitle, PageHeader } from "../shell/PageHeader";
import { RowMenu } from "../tasks/actions";
import { useLeadActions } from "./leadActions";
import { LeadDetail } from "./LeadDetail";
import { byLastContact, LIST_ORDER, STAGE_ICON, useUpdateLead } from "./leadData";

type View = "list" | "pipeline";

export function LeadsPage() {
  const { key } = useParams({ from: "/$ws/p/$key/leads" });
  const project = useProject(key);
  const ws = useWorkspace();
  if (!project) return <Navigate to="/$ws" params={{ ws: ws.slug }} />;
  return <Leads key={project.id} project={project} />;
}

function Leads({ project }: { project: Project }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const search = useSearch({ from: "/$ws/p/$key/leads" });
  const phone = useIsPhone();
  const split = useMedia("(min-width: 1024px)");
  const view: View = phone ? "list" : (search.view ?? "list");
  const selected = search.lead;
  const leads = useQuery(orpc.crm.list.queryOptions({ input: { projectId: project.id } }));
  const [hidden, setHidden] = useState<LeadStage[]>([]);
  const [creating, setCreating] = useState<LeadStage | null>(null);
  const [cursor, setCursor] = useState(0);

  const go = (patch: { view?: View; lead?: string }) =>
    navigate({
      to: "/$ws/p/$key/leads",
      params: { ws: ws.slug, key: project.key },
      search: { view: (patch.view ?? view) === "pipeline" ? "pipeline" : undefined, lead: "lead" in patch ? patch.lead : selected },
      replace: true,
    });
  const open = (l: LeadSummary) => {
    pushRecent({ type: "lead", id: l.id, title: l.company.name, ref: l.id });
    navigate({
      to: "/$ws/p/$key/leads",
      params: { ws: ws.slug, key: project.key },
      search: { view: view === "pipeline" ? "pipeline" : undefined, lead: l.id },
      replace: !phone && !!selected,
    });
  };

  const all = leads.data ?? [];
  const visible = useMemo(() => all.filter((l) => !hidden.includes(l.stage)), [all, hidden]);
  const groups = useMemo(
    () => LIST_ORDER.map((stage) => ({ stage, items: visible.filter((l) => l.stage === stage).sort(byLastContact) })).filter((g) => g.items.length > 0),
    [visible],
  );
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    const i = flat.findIndex((l) => l.id === selected);
    if (i >= 0) setCursor(i);
  }, [selected, flat]);

  useListNavigation(flat, cursor, (i) => {
    setCursor(i);
    const l = flat[i];
    if (l && selected) go({ lead: l.id });
    document.querySelector(`[data-lead="${l?.id}"]`)?.scrollIntoView({ block: "nearest" });
  }, open);

  // The shell binds L to quick capture; re-registering after the first commit puts this page's binding last, so it wins here.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useCommands(
    [
      { id: "leads.new", title: "New lead", subtitle: `in ${project.name}`, keys: "l", hint: "L", group: "Leads", icon: <Plus />, run: () => setCreating("new") },
      { id: "leads.list", title: "Leads: list view", keys: "v l", group: "Leads", run: () => go({ view: "list" }) },
      { id: "leads.pipeline", title: "Leads: pipeline view", keys: "v p", group: "Leads", run: () => go({ view: "pipeline" }) },
    ],
    [mounted, view, selected, project.id],
  );

  const detailOnly = !!selected && !split;
  const crumbs = [{ label: project.name }, { label: "Leads" }];

  const detail = selected && (
    <LeadDetail
      key={selected}
      id={selected}
      projectId={project.id}
      projectKey={project.key}
      fullscreen={!split}
      onClose={() => go({ lead: undefined })}
      onDeleted={() => go({ lead: undefined })}
    />
  );

  if (detailOnly) {
    return <div className="flex min-h-0 flex-1 flex-col pt-safe md:pt-0">{detail}</div>;
  }

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        center={
          <Segmented<View>
            value={view}
            onChange={(v) => go({ view: v })}
            options={[
              { value: "list", label: "List" },
              { value: "pipeline", label: "Pipeline" },
            ]}
          />
        }
        mobileActions={
          <IconButton label="New lead" size="touch" variant="secondary" className="rounded-full" onClick={() => setCreating("new")}>
            <Plus className="size-[18px]" />
          </IconButton>
        }
      >
        <StageFilter hidden={hidden} onChange={setHidden} />
        <Button variant="primary" icon={<Plus />} kbd="L" onClick={() => setCreating("new")}>
          New lead
        </Button>
      </PageHeader>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileTitle title="Leads" />
          {leads.isPending ? (
            <div className="flex flex-1 items-center justify-center">
              <Spinner />
            </div>
          ) : leads.isError ? (
            <p className="px-4 py-16 text-center text-sm text-ink-subtle">{errorMessage(leads.error)}</p>
          ) : all.length === 0 ? (
            <p className="px-4 py-16 text-center text-sm text-ink-subtle">No leads yet.</p>
          ) : view === "list" ? (
            <LeadList groups={groups} selected={selected} cursor={flat[cursor]?.id} onOpen={open} onFocus={(l) => setCursor(flat.indexOf(l))} phone={phone} projectKey={project.key} />
          ) : (
            <Pipeline project={project} leads={visible} selected={selected} onOpen={open} />
          )}
        </div>
        {selected && split && (
          <aside className="flex w-[456px] shrink-0 flex-col border-l border-edge">{detail}</aside>
        )}
      </div>
      <NewLeadDialog
        project={project}
        open={!!creating}
        onOpenChange={(o) => !o && setCreating(null)}
        onCreated={(id) => go({ lead: id })}
        defaultStage={creating ?? "new"}
      />
    </>
  );
}

function StageFilter({ hidden, onChange }: { hidden: LeadStage[]; onChange: (s: LeadStage[]) => void }) {
  return (
    <Popover.Root>
      <Popover.Trigger render={<IconButton label="Filter stages" className={cn(hidden.length > 0 && "text-ink")} />}>
        <ListFilter />
      </Popover.Trigger>
      <Popover.Popup align="end" className="w-52 p-1">
        <div className="px-2 pb-1 pt-1.5 text-label text-ink-subtle">Show stages</div>
        {LEAD_STAGES.map((s) => (
          <button
            key={s}
            type="button"
            className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-sm text-ink outline-none hover:bg-state-active"
            onClick={() => onChange(hidden.includes(s) ? hidden.filter((x) => x !== s) : [...hidden, s])}
          >
            <Checkbox checked={!hidden.includes(s)} label={STAGE_LABEL[s]} onChange={() => onChange(hidden.includes(s) ? hidden.filter((x) => x !== s) : [...hidden, s])} />
            <StatusIcon status={STAGE_ICON[s]} />
            {STAGE_LABEL[s]}
          </button>
        ))}
      </Popover.Popup>
    </Popover.Root>
  );
}

function LeadRowMenu({
  lead,
  projectKey,
  onOpen,
  onFocus,
  className,
  children,
}: {
  lead: LeadSummary;
  projectKey: string;
  onOpen: () => void;
  onFocus?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const entries = useLeadActions(lead, { projectKey, onOpen });
  return (
    <RowMenu entries={entries} onFocus={onFocus} className={className}>
      {children}
    </RowMenu>
  );
}

function OwnerAvatar({ lead }: { lead: LeadSummary }) {
  return <Avatar type={lead.owner.type} initials={lead.owner.initials} size="sm" title={lead.owner.type === "agent" ? `${lead.owner.name} (agent)` : lead.owner.name} />;
}

function LeadList({
  groups,
  selected,
  cursor,
  onOpen,
  onFocus,
  phone,
  projectKey,
}: {
  groups: { stage: LeadStage; items: LeadSummary[] }[];
  selected?: string;
  cursor?: string;
  onOpen: (l: LeadSummary) => void;
  onFocus: (l: LeadSummary) => void;
  phone: boolean;
  projectKey: string;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-32 md:pb-6">
      {groups.map((g) => (
        <div key={g.stage}>
          <div className="sticky top-0 z-[1] flex h-8 items-center gap-2 bg-panel pl-4 pr-3 md:pl-[18px]">
            <StatusIcon status={STAGE_ICON[g.stage]} />
            <span className="text-sm font-medium text-ink">{STAGE_LABEL[g.stage]}</span>
            <span className="text-sm text-ink-subtle">{g.items.length}</span>
          </div>
          {g.items.map((l) => (
            <LeadRowMenu key={l.id} lead={l} projectKey={projectKey} onOpen={() => onOpen(l)} onFocus={() => onFocus(l)}>
              <button
                type="button"
                data-lead={l.id}
                onClick={() => onOpen(l)}
                className={cn(
                  "flex w-full items-center gap-3 pl-4 pr-4 text-left outline-none md:pl-[18px]",
                  phone ? "h-14" : "h-10",
                  selected === l.id ? "bg-state-selected" : cursor === l.id ? "bg-state-hover" : "hover:bg-state-hover",
                  l.stage === "lost" && "opacity-60",
                )}
              >
                {phone ? (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-touch text-ink">{l.company.name}</span>
                    <span className="block truncate text-label text-ink-subtle">
                      {[l.contact?.name, l.lastContactAt && shortDate(l.lastContactAt)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                ) : (
                  <>
                    <span className="min-w-0 shrink truncate text-sm font-medium text-ink">{l.company.name}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-subtle">{l.contact?.name}</span>
                    <span className="w-[52px] shrink-0 text-right text-sm text-ink-subtle">{l.lastContactAt ? shortDate(l.lastContactAt) : "—"}</span>
                  </>
                )}
                <OwnerAvatar lead={l} />
              </button>
            </LeadRowMenu>
          ))}
        </div>
      ))}
    </div>
  );
}

function Pipeline({
  project,
  leads,
  selected,
  onOpen,
}: {
  project: Project;
  leads: LeadSummary[];
  selected?: string;
  onOpen: (l: LeadSummary) => void;
}) {
  const update = useUpdateLead(project.id);
  const [over, setOver] = useState<LeadStage | null>(null);
  const dragging = useRef<string | null>(null);
  const columns = LEAD_STAGES.map((stage) => ({
    stage,
    items: leads.filter((l) => l.stage === stage).sort((a, b) => a.sortOrder - b.sortOrder || byLastContact(a, b)),
  }));

  const drop = (e: DragEvent, stage: LeadStage) => {
    e.preventDefault();
    setOver(null);
    const id = dragging.current ?? e.dataTransfer.getData("text/plain");
    dragging.current = null;
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.stage === stage) return;
    const top = columns.find((c) => c.stage === stage)?.items[0];
    update.mutate({ id, patch: { stage, sortOrder: top ? top.sortOrder - 1 : 0 } });
    toast(`${lead.company.name} → ${STAGE_LABEL[stage]}`);
  };

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 py-3">
      {columns.map((c) => (
        <div
          key={c.stage}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (over !== c.stage) setOver(c.stage);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
          }}
          onDrop={(e) => drop(e, c.stage)}
          className={cn("flex w-[264px] shrink-0 flex-col rounded-lg", over === c.stage && "bg-state-hover")}
        >
          <div className="flex h-9 items-center gap-2 px-2">
            <StatusIcon status={STAGE_ICON[c.stage]} />
            <span className="text-sm font-medium text-ink">{STAGE_LABEL[c.stage]}</span>
            <span className="text-sm text-ink-subtle">{c.items.length}</span>
          </div>
          <div className="flex min-h-24 flex-1 flex-col gap-1.5 overflow-y-auto px-1 pb-3">
            {c.items.map((l) => (
              <LeadRowMenu key={l.id} lead={l} projectKey={project.key} onOpen={() => onOpen(l)} className="flex flex-col">
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    dragging.current = l.id;
                    e.dataTransfer.setData("text/plain", l.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setOver(null)}
                  onClick={() => onOpen(l)}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg bg-raised px-3 py-2.5 text-left outline-none active:scale-[0.99]",
                    selected === l.id && "bg-state-selected shadow-[inset_0_0_0_1px_var(--color-accent)]",
                    l.stage === "lost" && "opacity-60",
                  )}
                >
                  <span className="truncate text-sm font-medium text-ink">{l.company.name}</span>
                  {l.contact?.name && <span className="truncate text-label text-ink-subtle">{l.contact.name}</span>}
                </button>
              </LeadRowMenu>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function NewLeadDialog({
  project,
  open,
  onOpenChange,
  onCreated,
  defaultStage,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
  defaultStage: LeadStage;
}) {
  const phone = useIsPhone();
  const empty = { company: "", contact: "", email: "", stage: defaultStage };
  const [f, setF] = useState(empty);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the dialog opens
  useEffect(() => {
    if (open) setF(empty);
  }, [open]);
  const listKey = orpc.crm.list.queryKey({ input: { projectId: project.id } });

  const create = useMutation({
    mutationFn: (v: typeof f & { clientId: string }) =>
      client.crm.create({
        projectId: project.id,
        clientId: v.clientId,
        company: { name: v.company.trim(), location: "", details: "" },
        contact: v.contact.trim() || v.email.trim() ? { name: v.contact.trim() || v.email.trim(), email: v.email.trim(), role: "" } : undefined,
        stage: v.stage,
        source: "",
        notes: "",
      }),
    onMutate: (v) => {
      const prev = queryClient.getQueryData<LeadSummary[]>(listKey);
      const me = queryClient.getQueryData<{ id: string; name: string; initials: string } | null>(orpc.auth.me.queryKey());
      const now = new Date().toISOString();
      const optimistic: LeadSummary = {
        id: v.clientId,
        projectId: project.id,
        stage: v.stage,
        source: "",
        company: { id: "", name: v.company.trim(), location: "", details: "", website: "" },
        contact: v.contact.trim() ? { id: "", name: v.contact.trim(), email: v.email.trim(), role: "", phone: "" } : null,
        lastContactAt: null,
        owner: { type: "user", id: me?.id ?? "", name: me?.name ?? "", initials: me?.initials ?? null },
        sortOrder: Math.min(0, ...(prev ?? []).map((l) => l.sortOrder)) - 1,
        updatedAt: now,
      };
      queryClient.setQueryData(listKey, [...(prev ?? []), optimistic]);
      onOpenChange(false);
      return { prev };
    },
    onError: (e, _v, ctx) => {
      queryClient.setQueryData(listKey, ctx?.prev);
      toast.error(`Couldn't create lead: ${errorMessage(e)}`);
    },
    onSuccess: (lead) => onCreated(lead.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: listKey }),
  });

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New lead" position={phone ? "sheet" : "top"} className="max-md:top-auto md:max-w-[480px]">
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (f.company.trim()) create.mutate({ ...f, clientId: crypto.randomUUID() });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.requestSubmit();
        }}
      >
        <h2 className="text-base font-semibold text-ink">New lead</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company">
            <Input autoFocus required touch={phone} placeholder="Bistro Musterplatz" value={f.company} onChange={set("company")} />
          </Field>
          <Field label="Contact">
            <Input touch={phone} placeholder="Jonas Muster" value={f.contact} onChange={set("contact")} />
          </Field>
          <Field label="Email">
            <Input touch={phone} type="email" placeholder="hallo@bistro-musterplatz.example" value={f.email} onChange={set("email")} />
          </Field>
          <Field label="Stage">
            <Select<LeadStage> value={f.stage} onChange={(stage) => setF({ ...f, stage })} options={LEAD_STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size={phone ? "touch" : "md"} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size={phone ? "touch" : "md"} kbd={phone ? undefined : "⌘↵"} disabled={!f.company.trim()}>
            Create lead
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
