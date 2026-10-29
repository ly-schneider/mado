import { type Lead, LEAD_STAGES, type LeadSummary, STAGE_LABEL } from "@mado/contract";
import { Badge, Button, cn, IconButton, Menu, Spinner, StatusIcon } from "@mado/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Building2, CalendarDays, ChevronLeft, Copy, Link2, Mail, MoreHorizontal, RotateCcw, Sparkles, Trash2, User, X } from "@mado/ui/fluent";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { useCommands } from "../../lib/shortcuts";
import { shortDate } from "../../lib/time";
import { toast } from "../../lib/toast";
import { useWorkspace } from "../../lib/workspace";
import { LinkedText } from "../agents/ConnectedAgents";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { MarkdownView } from "../editor/MarkdownView";
import { copyText } from "../settings/shared";
import { STAGE_ICON, useUpdateLead } from "./leadData";

export const noOverlay = () => !document.querySelector('[role="dialog"], [role="menu"]');

export function LeadDetail({
  id,
  projectId,
  projectKey,
  onClose,
  onDeleted,
  fullscreen,
}: {
  id: string;
  projectId: string;
  projectKey: string;
  onClose: () => void;
  onDeleted: () => void;
  fullscreen?: boolean;
}) {
  const ws = useWorkspace();
  const summary = queryClient.getQueryData<LeadSummary[]>(orpc.crm.list.queryKey({ input: { projectId } }))?.find((l) => l.id === id);
  const lead = useQuery(
    orpc.crm.get.queryOptions({
      input: { id },
      placeholderData: summary
        ? { ...summary, notes: "", lastContactNote: "", analysis: null, analyzedAt: null, draft: null, draftedAt: null }
        : undefined,
    }),
  );
  const update = useUpdateLead(projectId);
  const listKey = orpc.crm.list.queryKey({ input: { projectId } });

  const remove = useMutation({
    mutationFn: () => client.crm.delete({ id }),
    onMutate: () => {
      const prev = queryClient.getQueryData<LeadSummary[]>(listKey);
      if (prev) queryClient.setQueryData(listKey, prev.filter((l) => l.id !== id));
      onDeleted();
      return { prev };
    },
    onError: (e, _v, ctx) => {
      queryClient.setQueryData(listKey, ctx?.prev);
      toast.error(`Couldn't delete: ${errorMessage(e)}`);
    },
    onSuccess: () => {
      const name = lead.data?.company.name ?? "Lead";
      queryClient.invalidateQueries({ queryKey: orpc.trash.key() });
      toast(`${name} moved to the trash`, {
        action: {
          label: "Undo",
          run: () => client.trash.restore({ entityType: "lead", id }).then(() => queryClient.invalidateQueries({ queryKey: listKey })),
        },
      });
    },
  });

  const l = lead.data;
  useCommands(
    l
      ? [
          { id: "lead.close", title: "Close lead", keys: "Escape", group: "Leads", when: noOverlay, run: onClose },
          { id: "lead.delete", title: `Delete ${l.company.name}`, group: "Leads", icon: <Trash2 />, run: () => remove.mutate() },
          ...LEAD_STAGES.map((s) => ({
            id: `lead.stage.${s}`,
            title: `Move to ${STAGE_LABEL[s]}`,
            group: "Leads" as const,
            icon: <StatusIcon status={STAGE_ICON[s]} />,
            run: () => update.mutate({ id, patch: { stage: s } }),
          })),
        ]
      : [],
    [l?.id, l?.company.name],
  );

  if (!l) {
    return (
      <div className="flex flex-1 items-center justify-center">
        {lead.isError ? <span className="text-sm text-ink-subtle">{errorMessage(lead.error)}</span> : <Spinner />}
      </div>
    );
  }

  const patch = (p: Parameters<typeof update.mutate>[0]["patch"]) => update.mutate({ id, patch: p });
  const placeholder = lead.isPlaceholderData;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start gap-3 px-5 pb-3 pt-4">
        {fullscreen && (
          <IconButton label="Back" size="touch" variant="secondary" className="-ml-1 rounded-full" onClick={onClose}>
            <ChevronLeft className="size-[18px]" />
          </IconButton>
        )}
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-edge bg-raised text-ink-subtle">
          <Building2 className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <FlatInput
            label="Company"
            value={l.company.name}
            required
            className="-ml-1 h-7 text-base font-semibold"
            onSave={(name) => patch({ company: { name } })}
          />
          <FlatInput
            label="Location and details"
            value={[l.company.location, l.company.details].filter(Boolean).join(" · ")}
            placeholder="Location · details"
            className="-ml-1 h-6 text-label text-ink-subtle"
            onSave={(v) => {
              const [location = "", ...rest] = v.split("·").map((s) => s.trim());
              patch({ company: { location, details: rest.join(" · ") } });
            }}
          />
        </div>
        <Menu.Root>
          <Menu.Trigger className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-edge bg-raised px-2.5 text-label font-medium text-ink outline-none hover:bg-state-hover">
            <StatusIcon status={STAGE_ICON[l.stage]} />
            {STAGE_LABEL[l.stage]}
          </Menu.Trigger>
          <Menu.Popup align="end">
            {LEAD_STAGES.map((s) => (
              <Menu.Item key={s} icon={<StatusIcon status={STAGE_ICON[s]} />} selected={s === l.stage} onClick={() => patch({ stage: s })}>
                {STAGE_LABEL[s]}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Root>
        <Menu.Root>
          <Menu.Trigger render={<IconButton label="More" size="sm" />}>
            <MoreHorizontal />
          </Menu.Trigger>
          <Menu.Popup align="end">
            <Menu.Item icon={<Link2 />} onClick={() => copyText(`${location.origin}/${ws.slug}/p/${projectKey}/leads?lead=${id}`, "Link copied")}>
              Copy link
            </Menu.Item>
            {!fullscreen && (
              <Menu.Item icon={<X />} kbd="Esc" onClick={onClose}>
                Close
              </Menu.Item>
            )}
            <Menu.Separator />
            <Menu.Item icon={<Trash2 />} danger onClick={() => remove.mutate()}>
              Delete lead
            </Menu.Item>
          </Menu.Popup>
        </Menu.Root>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-32 md:pb-6">
        <div className="flex flex-col">
          <FieldRow icon={<User />} label="Contact">
            <FlatInput
              label="Contact"
              placeholder="Name · role"
              value={l.contact ? [l.contact.name, l.contact.role].filter(Boolean).join(" · ") : ""}
              onSave={(v) => {
                const [name = "", ...role] = v.split("·").map((s) => s.trim());
                patch({ contact: { name, role: role.join(" · ") } });
              }}
            />
          </FieldRow>
          <FieldRow icon={<Mail />} label="Email">
            <FlatInput label="Email" type="email" placeholder="name@company.ch" value={l.contact?.email ?? ""} onSave={(email) => patch({ contact: { email } })} />
          </FieldRow>
          <FieldRow icon={<Link2 />} label="Source">
            <FlatInput
              label="Source"
              placeholder={l.owner.type === "agent" ? `via ${l.owner.name}` : "Referral, event, walk-in…"}
              value={l.source}
              onSave={(source) => patch({ source })}
            />
          </FieldRow>
          <FieldRow icon={<CalendarDays />} label="Last contact">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <DateButton value={l.lastContactAt} onChange={(v) => patch({ lastContactAt: v })} />
              <span className="text-ink-faint">·</span>
              <FlatInput label="Last contact note" placeholder="what happened" value={l.lastContactNote} onSave={(lastContactNote) => patch({ lastContactNote })} />
            </div>
          </FieldRow>
        </div>

        <Notes
          key={l.id}
          value={l.notes}
          loading={placeholder}
          wsSlug={ws.slug}
          workspaceId={ws.id}
          onSave={(notes) => patch({ notes })}
        />

        <div className="mt-3 flex flex-col gap-3">
          <AnalysisCard lead={l} disabled={placeholder} />
          <DraftCard lead={l} disabled={placeholder} />
        </div>
        <p className="mt-4 text-label text-ink-faint">
          {l.owner.type === "agent" ? `Created by ${l.owner.name} (agent)` : `Owner ${l.owner.name}`}
          {l.updatedAt && ` · updated ${shortDate(l.updatedAt)}`}
        </p>
      </div>
    </div>
  );
}

/** Shows "Oct 28" like the design and opens the native date picker on click. */
function DateButton({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="relative shrink-0">
      <button
        type="button"
        className={cn("h-7 rounded-md border border-transparent px-1 text-sm outline-none hover:border-edge", value ? "text-ink" : "text-ink-faint")}
        onClick={() => {
          try {
            ref.current?.showPicker();
          } catch {
            ref.current?.focus();
          }
        }}
      >
        {value ? shortDate(value) : "Set date"}
      </button>
      <input
        ref={ref}
        type="date"
        tabIndex={-1}
        aria-label="Last contact date"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="pointer-events-none absolute inset-0 opacity-0"
      />
    </span>
  );
}

function FieldRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-2.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-ink-subtle">
      {icon}
      <span className="w-[96px] shrink-0 text-sm text-ink-subtle">{label}</span>
      {children}
    </div>
  );
}

/** Borderless inline edit: looks like text until hovered or focused. Saves on blur and Enter. */
function FlatInput({
  value,
  onSave,
  label,
  placeholder,
  className,
  type = "text",
  required,
}: {
  value: string;
  onSave: (v: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
  type?: string;
  required?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      aria-label={label}
      type={type}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        const v = draft.trim();
        if (v === value.trim() || (required && !v)) setDraft(value);
        else onSave(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          cancelled.current = true;
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-sm text-ink outline-none placeholder:text-ink-faint hover:border-edge focus:border-accent focus:bg-panel",
        className,
      )}
    />
  );
}

function Notes({
  value,
  onSave,
  loading,
  wsSlug,
  workspaceId,
}: {
  value: string;
  onSave: (v: string) => void;
  loading: boolean;
  wsSlug: string;
  workspaceId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };
  if (loading) return <div className="mt-3 h-12 rounded-md bg-state-hover" />;
  if (editing) {
    return (
      <div className="mt-3 rounded-md border border-accent bg-panel px-2.5 py-2">
        <MarkdownEditor variant="compact" autoFocus value={draft} onChange={setDraft} onBlur={commit} onSubmit={commit} placeholder="Notes" workspaceId={workspaceId} />
      </div>
    );
  }
  return (
    <button type="button" className="mt-3 -mx-1 block w-[calc(100%+8px)] rounded-md px-1 py-1 text-left outline-none hover:bg-state-hover" onClick={() => setEditing(true)}>
      {value ? (
        <MarkdownView markdown={value} wsSlug={wsSlug} workspaceId={workspaceId} className="text-sm text-ink-muted" />
      ) : (
        <span className="text-sm text-ink-faint">Add notes…</span>
      )}
    </button>
  );
}

function useAiReady() {
  return useQuery(orpc.settings.ai.queryOptions({ staleTime: 60_000 }));
}

function NeedsKey() {
  const ws = useWorkspace();
  return (
    <p className="text-label text-ink-subtle">
      Needs an OpenRouter key.{" "}
      <Link to="/$ws/settings/$section" params={{ ws: ws.slug, section: "ai" }} className="text-accent">
        Settings › AI
      </Link>
    </p>
  );
}

function setLead(l: Lead) {
  queryClient.setQueryData(orpc.crm.get.queryKey({ input: { id: l.id } }), l);
}

function AnalysisCard({ lead, disabled }: { lead: Lead; disabled: boolean }) {
  const ws = useWorkspace();
  const ai = useAiReady();
  const analyze = useMutation({
    mutationFn: () => client.crm.analyze({ id: lead.id }),
    onSuccess: setLead,
    onError: (e) => toast.error(`Analysis failed: ${errorMessage(e)}`),
  });
  const a = lead.analysis;
  return (
    <section className="rounded-lg border border-edge">
      <header className="flex h-10 items-center gap-2 px-3.5">
        <Sparkles className="size-4 text-ink-subtle" />
        <span className="text-sm font-medium text-ink">AI analysis</span>
        <span className="ml-auto flex items-center gap-2 text-label text-ink-subtle">
          {a && (
            <IconButton label="Analyse again" size="sm" className="-mr-1.5" disabled={analyze.isPending} onClick={() => analyze.mutate()}>
              {analyze.isPending ? <Spinner className="size-3.5" /> : <RotateCcw />}
            </IconButton>
          )}
        </span>
      </header>
      <div className="px-3.5 pb-3">
        {a ? (
          <dl className="flex flex-col gap-1.5">
            {a.rows.map((r) => (
              <div key={r.label} className="flex gap-3 text-label">
                <dt className="w-[60px] shrink-0 text-ink-subtle">{r.label}</dt>
                <dd className="min-w-0 text-ink-muted">
                  <LinkedText text={r.text} wsSlug={ws.slug} />
                </dd>
              </div>
            ))}
          </dl>
        ) : ai.data && !ai.data.hasKey ? (
          <NeedsKey />
        ) : (
          <div className="flex items-center gap-3">
            <p className="flex-1 text-label text-ink-subtle">Fit, timing and risk from the notes and linked tasks.</p>
            <Button size="sm" icon={<Sparkles />} disabled={disabled} loading={analyze.isPending} onClick={() => analyze.mutate()}>
              Analyse
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function DraftCard({ lead, disabled }: { lead: Lead; disabled: boolean }) {
  const ai = useAiReady();
  const [language, setLanguage] = useState<"de" | "en">((lead.draft?.language as "de" | "en") ?? "de");
  const draft = useMutation({
    mutationFn: (lang: "de" | "en") => client.crm.draftEmail({ id: lead.id, language: lang }),
    onSuccess: setLead,
    onError: (e) => toast.error(`Draft failed: ${errorMessage(e)}`),
  });
  const d = lead.draft;
  const email = lead.contact?.email ?? "";
  const mailto = d ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}` : "";
  const subjectLabel = d?.language === "de" ? "Betreff" : "Subject";

  return (
    <section className="flex flex-col rounded-lg border border-edge">
      <header className="flex h-10 items-center gap-2 border-b border-edge px-3.5">
        <Mail className="size-4 text-ink-subtle" />
        <span className="text-sm font-medium text-ink">Draft</span>
        {d && <Badge>{d.language.toUpperCase()} · personal</Badge>}
        {d && (
          <IconButton label="Write again" size="sm" className="-mr-1.5 ml-auto" disabled={draft.isPending} onClick={() => draft.mutate(language)}>
            {draft.isPending ? <Spinner className="size-3.5" /> : <RotateCcw />}
          </IconButton>
        )}
      </header>
      {d ? (
        <>
          <div className="flex flex-col gap-2 px-3.5 py-3">
            <div className="text-label text-ink-subtle">
              {subjectLabel}: <span className="font-medium text-ink">{d.subject}</span>
            </div>
            <div className="whitespace-pre-wrap text-sm text-ink-muted">{d.body}</div>
          </div>
          <footer className="flex flex-wrap items-center gap-2 border-t border-edge py-2 pl-3.5 pr-2">
            <Button variant="ghost" className="ml-auto" onClick={() => window.open(mailto, "_self")} title={email ? `Opens your mail app addressed to ${email}` : "No email on this lead"}>
              Open in Mail
            </Button>
            <Button icon={<Copy />} onClick={() => copyText(`${subjectLabel}: ${d.subject}\n\n${d.body}`, "Draft copied")}>
              Copy
            </Button>
          </footer>
        </>
      ) : (
        <div className="px-3.5 py-3">
          {ai.data && !ai.data.hasKey ? (
            <NeedsKey />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 text-label text-ink-subtle">A short personal email with an opt-out line. You send it yourself.</p>
              <select
                aria-label="Language"
                value={language}
                onChange={(e) => setLanguage(e.target.value as "de" | "en")}
                className="h-7 rounded-md border border-edge bg-panel px-1.5 text-label text-ink outline-none focus:border-accent"
              >
                <option value="de">Deutsch</option>
                <option value="en">English</option>
              </select>
              <Button size="sm" icon={<Mail />} disabled={disabled} loading={draft.isPending} onClick={() => draft.mutate(language)}>
                Draft email
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
