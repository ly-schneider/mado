import { type AgentGrant, type AgentSession, type AuditEntry, type ExpiryOption, expiryToDate, type GrantLevel, TASK_KEY_RE } from "@mado/contract";
import { Avatar, Badge, Button, cn, Dialog, EmptyState, IconButton, Menu, Spinner } from "@mado/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  ArrowRight,
  Bot,
  ChevronDown,
  ChevronLeft,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { useCommands, useListNavigation } from "../../lib/shortcuts";
import { ago, clock, dayGroup, shortDate } from "../../lib/time";
import { toast } from "../../lib/toast";
import { useWorkspace, useWorkspaces } from "../../lib/workspace";
import { ConfirmDialog, CopyField, useIsPhone } from "../settings/shared";
import {
  AgentNameField,
  draftToInput,
  draftValid,
  EXPIRY_LABEL,
  ExpiryBlock,
  emptyDraft,
  type GrantDraft,
  grantSummary,
  LEVEL_LABEL,
  LevelSegmented,
  ProjectLevelTable,
  ResourceTypesRow,
} from "./GrantPicker";

const DAY = 86_400_000;

export function grantShortId(id: string) {
  return id.startsWith("g_") ? id : `g_${id.replace(/-/g, "").slice(0, 4)}`;
}

function sessionShortId(id: string) {
  return id.replace(/^s(ession)?_/, "").replace(/-/g, "").slice(0, 4);
}

function subtitle(g: AgentGrant) {
  if (g.kind === "builtin") return "Built-in · OpenRouter";
  if (g.kind === "pat") return "Personal access token";
  return g.clientVerified ? g.clientName : `${g.clientName} · unverified`;
}

function projectsLabel(g: AgentGrant) {
  if (g.projectScope === "all") return "All + future";
  return g.projects.map((p) => p.key).join("  ") || "—";
}

function levelLabel(g: AgentGrant) {
  if (g.projectScope === "all") return LEVEL_LABEL[g.allLevel];
  const levels = [...new Set(g.projects.map((p) => p.level))];
  return levels.map((l) => LEVEL_LABEL[l]).join(" · ") || "—";
}

function expiresLabel(g: AgentGrant) {
  if (g.status === "revoked") return "revoked";
  if (g.status === "expired") return "expired";
  if (!g.expiresAt) return "never";
  const days = Math.ceil((new Date(g.expiresAt).getTime() - Date.now()) / DAY);
  return days <= 1 ? "today" : `in ${days} days`;
}

function patchGrantCaches(id: string, patch: (g: AgentGrant) => AgentGrant) {
  const listKey = orpc.agents.list.queryKey();
  const getKey = orpc.agents.get.queryKey({ input: { id } });
  const prevList = queryClient.getQueryData<AgentGrant[]>(listKey);
  const prevGet = queryClient.getQueryData<AgentGrant>(getKey);
  if (prevList) queryClient.setQueryData(listKey, prevList.map((g) => (g.id === id ? patch(g) : g)));
  if (prevGet) queryClient.setQueryData(getKey, patch(prevGet));
  return () => {
    queryClient.setQueryData(listKey, prevList);
    queryClient.setQueryData(getKey, prevGet);
  };
}

/** Settings › Connected agents (Desktop 04): grants table left, detail panel right for ?id=. */
export function ConnectedAgents({ openToken }: { openToken?: boolean }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const { id } = useSearch({ strict: false }) as { id?: string };
  const list = useQuery(orpc.agents.list.queryOptions());
  const [tokenOpen, setTokenOpen] = useState(!!openToken);
  const grants = useMemo(() => {
    const order = { active: 0, expired: 1, revoked: 2 } as const;
    return [...(list.data ?? [])].sort((a, b) => order[a.status] - order[b.status]);
  }, [list.data]);
  const [cursor, setCursor] = useState(0);

  const select = (grantId: string | undefined) =>
    navigate({ to: "/$ws/settings/$section", params: { ws: ws.slug, section: "agents" }, search: grantId ? { id: grantId } : {}, replace: !phone });

  useEffect(() => {
    const i = grants.findIndex((g) => g.id === id);
    if (i >= 0) setCursor(i);
  }, [id, grants]);

  useListNavigation(grants, cursor, (i) => {
    setCursor(i);
    if (id && grants[i]) select(grants[i].id);
  }, (g) => select(g.id));
  useCommands(
    [
      { id: "agents.token", title: "Create personal access token", group: "Settings", icon: <Plus />, run: () => setTokenOpen(true) },
      { id: "agents.close", title: "Close agent details", keys: "Escape", group: "Settings", when: () => !!id && !document.querySelector('[role="dialog"], [role="menu"]'), run: () => select(undefined) },
    ],
    [id],
  );

  const showList = !(phone && id);
  return (
    <div className="flex min-h-0 flex-1">
      {showList && (
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4 px-4 pb-32 pt-2 md:px-6 md:pb-10 md:pt-7">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <h1 className="text-title text-ink">Connected agents</h1>
                <p className="mt-1 max-w-[420px] text-sm text-ink-muted">
                  Each agent holds one grant. Edits apply on its next MCP call; revoking kills both tokens at once.
                </p>
              </div>
              <Button icon={<Plus />} onClick={() => setTokenOpen(true)} className="self-start sm:self-auto">
                Personal access token
              </Button>
            </div>

            {list.isPending ? (
              <div className="flex justify-center py-16">
                <Spinner />
              </div>
            ) : list.isError ? (
              <EmptyState icon={<Bot />} title="Couldn't load agents">
                {errorMessage(list.error)}
              </EmptyState>
            ) : grants.length === 0 ? (
              <div className="rounded-lg border border-edge">
                <EmptyState icon={<Bot />} title="No agents connected yet">
                  Add mado to Claude Code with <span className="font-medium text-ink-muted">claude mcp add --transport http mado &lt;server&gt;/mcp</span>, or
                  create a personal access token.
                </EmptyState>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-edge" role="table">
                <div
                  role="row"
                  className="hidden h-8 grid-cols-[minmax(0,1fr)_84px_92px_80px_72px] items-center gap-2 border-b border-edge px-3 text-label text-ink-subtle md:grid"
                >
                  <span>Agent</span>
                  <span>Projects</span>
                  <span>Level</span>
                  <span>Last used</span>
                  <span>Expires</span>
                </div>
                <div className="divide-y divide-edge">
                  {grants.map((g, i) => (
                    <button
                      key={g.id}
                      type="button"
                      role="row"
                      onClick={() => select(g.id)}
                      onMouseMove={() => cursor !== i && setCursor(i)}
                      className={cn(
                        "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left outline-none md:h-[52px] md:grid-cols-[minmax(0,1fr)_84px_92px_80px_72px] md:gap-2 md:py-0",
                        id === g.id ? "bg-state-selected" : cursor === i && "bg-state-hover",
                        g.status !== "active" && "opacity-50",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Avatar type="agent" size="md" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-ink">{g.agentName}</span>
                          <span className="block truncate text-label text-ink-subtle">{subtitle(g)}</span>
                        </span>
                      </span>
                      <span className="text-right text-label text-ink-subtle md:hidden">
                        {levelLabel(g)}
                        <br />
                        {expiresLabel(g)}
                      </span>
                      <span className="hidden truncate text-label font-medium text-ink-muted md:block">{projectsLabel(g)}</span>
                      <span className="hidden truncate text-label text-ink-muted md:block">{levelLabel(g)}</span>
                      <span className="hidden truncate text-label text-ink-muted md:block">{g.lastUsedAt ? ago(g.lastUsedAt, { long: true }) : "—"}</span>
                      <span className="hidden truncate text-label text-ink-muted md:block">{expiresLabel(g)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="flex items-start gap-2 text-label text-ink-subtle">
              <ShieldCheck className="mt-px size-4 shrink-0" />
              A grant never exceeds your own rights. Missing privileges return insufficient_scope — agents ask, they never escalate.
            </p>
          </div>
        </div>
      )}
      {id && <AgentDetail key={id} grantId={id} onClose={() => select(undefined)} />}
      <TokenDialog open={tokenOpen} onOpenChange={setTokenOpen} />
    </div>
  );
}

function AgentDetail({ grantId, onClose }: { grantId: string; onClose: () => void }) {
  const phone = useIsPhone();
  const fromList = queryClient.getQueryData<AgentGrant[]>(orpc.agents.list.queryKey())?.find((g) => g.id === grantId);
  const grant = useQuery(orpc.agents.get.queryOptions({ input: { id: grantId }, placeholderData: fromList }));
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const update = useMutation({
    mutationFn: (patch: Parameters<typeof client.agents.update>[0]["grant"]) => client.agents.update({ id: grantId, grant: patch }),
    onError: (e) => toast.error(`Couldn't save: ${errorMessage(e)}`),
    onSuccess: (g) => {
      queryClient.setQueryData(orpc.agents.get.queryKey({ input: { id: grantId } }), g);
      queryClient.invalidateQueries({ queryKey: orpc.agents.list.key() });
    },
  });

  const revoke = useMutation({
    mutationFn: () => client.agents.revoke({ id: grantId }),
    onMutate: () => ({ rollback: patchGrantCaches(grantId, (g) => ({ ...g, status: "revoked", revokedAt: new Date().toISOString() })) }),
    onError: (e, _v, ctx) => {
      ctx?.rollback();
      toast.error(`Couldn't revoke: ${errorMessage(e)}`);
    },
    onSuccess: () => {
      toast(`${g?.agentName ?? "Agent"} revoked`);
      queryClient.invalidateQueries({ queryKey: orpc.agents.list.key() });
    },
  });

  const g = grant.data;
  const setLevel = (projectId: string | null, level: GrantLevel) => {
    if (!g) return;
    if (projectId === null) {
      const rollback = patchGrantCaches(grantId, (x) => ({ ...x, allLevel: level }));
      update.mutate({ allLevel: level }, { onError: rollback });
      return;
    }
    const projects = g.projects.map((p) => ({ projectId: p.projectId, level: p.projectId === projectId ? level : p.level }));
    const rollback = patchGrantCaches(grantId, (x) => ({ ...x, projects: x.projects.map((p) => (p.projectId === projectId ? { ...p, level } : p)) }));
    update.mutate({ projects, projectScope: "listed" }, { onError: rollback });
  };
  const setExpiry = (expiry: ExpiryOption) => {
    const rollback = patchGrantCaches(grantId, (x) => ({ ...x, expiresAt: expiryToDate(expiry)?.toISOString() ?? null, status: x.status === "expired" ? "active" : x.status }));
    update.mutate({ expiry }, { onError: rollback });
  };

  useCommands(
    g && g.status !== "revoked"
      ? [
          { id: "agent.revoke", title: `Revoke ${g.agentName}`, group: "Settings", icon: <X />, run: () => setRevokeOpen(true) },
          { id: "agent.edit", title: `Edit privileges of ${g.agentName}`, keys: "e", hint: "E", group: "Settings", icon: <SlidersHorizontal />, run: () => setEditOpen(true) },
        ]
      : [],
    [g?.id, g?.status],
  );

  const readOnly = !g || g.status === "revoked";
  return (
    <aside className={cn("flex min-h-0 flex-col bg-page md:w-[352px] md:shrink-0 md:border-l md:border-edge", phone && "flex-1")}>
      {!g ? (
        <div className="flex flex-1 items-center justify-center">{grant.isError ? <span className="text-sm text-ink-subtle">Agent not found</span> : <Spinner />}</div>
      ) : (
        <>
          <div className="flex items-start gap-3 border-b border-edge px-5 py-4">
            {phone && (
              <IconButton label="Back" size="touch" variant="secondary" className="-ml-1 rounded-full" onClick={onClose}>
                <ChevronLeft className="size-[18px]" />
              </IconButton>
            )}
            <Avatar type="agent" size="lg" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold text-ink">{g.agentName}</div>
              <div className="truncate text-label text-ink-subtle">
                Connected {shortDate(g.createdAt)} · grant {grantShortId(g.id)}
              </div>
            </div>
            {!phone && (
              <IconButton label="Close (Esc)" size="sm" onClick={onClose}>
                <X />
              </IconButton>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <section className="flex flex-col gap-2 border-b border-edge px-5 py-4">
              <div className="flex items-center">
                <h3 className="text-sm font-medium text-ink">Privileges</h3>
                {!readOnly && (
                  <Button size="sm" variant="ghost" className="-mr-2 ml-auto" onClick={() => setEditOpen(true)}>
                    Edit
                  </Button>
                )}
              </div>
              {g.projectScope === "all" ? (
                <PrivilegeRow name="All projects" sub="incl. future">
                  <LevelSegmented value={g.allLevel} disabled={readOnly} onChange={(v) => setLevel(null, v)} />
                </PrivilegeRow>
              ) : (
                g.projects.map((p) => (
                  <PrivilegeRow key={p.projectId} name={p.name} sub={p.key}>
                    <LevelSegmented value={p.level} disabled={readOnly} onChange={(v) => setLevel(p.projectId, v)} />
                  </PrivilegeRow>
                ))
              )}
              <div className="flex h-8 items-center">
                <span className="text-sm text-ink">Expiry</span>
                <Menu.Root>
                  <Menu.Trigger
                    disabled={readOnly}
                    className="-mr-2 ml-auto flex h-7 items-center gap-1.5 rounded-md px-2 text-label text-ink-muted outline-none hover:bg-state-hover disabled:opacity-50"
                  >
                    {g.expiresAt ? `${g.status === "expired" ? "Expired" : expiresLabel(g).replace(/^in /, "")} · ${shortDate(g.expiresAt)}` : "No expiry"}
                    <ChevronDown className="size-4 text-ink-subtle" />
                  </Menu.Trigger>
                  <Menu.Popup align="end">
                    <Menu.Label>Extend from today</Menu.Label>
                    {(Object.keys(EXPIRY_LABEL) as ExpiryOption[]).map((e) => {
                      const d = expiryToDate(e);
                      return (
                        <Menu.Item key={e} onClick={() => setExpiry(e)}>
                          {EXPIRY_LABEL[e]}
                          {d && <span className="ml-1.5 text-ink-subtle">· {shortDate(d)}</span>}
                        </Menu.Item>
                      );
                    })}
                  </Menu.Popup>
                </Menu.Root>
              </div>
            </section>
            <Activity grantId={grantId} />
          </div>

          <div className="flex min-h-14 items-center gap-3 border-t border-edge py-2 pl-5 pr-2 pb-[max(env(safe-area-inset-bottom),8px)]">
            <span className="min-w-0 flex-1 truncate text-label text-ink-subtle">
              {g.status === "revoked"
                ? `Revoked ${ago(g.revokedAt, { long: true })}`
                : g.lastUsedAt
                  ? `Last call ${ago(g.lastUsedAt, { long: true })}${g.lastIp ? ` from ${g.lastIp}` : ""}`
                  : "Never used"}
            </span>
            {g.status !== "revoked" && (
              <Button icon={<X />} onClick={() => setRevokeOpen(true)}>
                Revoke
              </Button>
            )}
          </div>

          <ConfirmDialog
            open={revokeOpen}
            onOpenChange={setRevokeOpen}
            title={`Revoke ${g.agentName}?`}
            confirmLabel="Revoke"
            danger
            onConfirm={() => {
              setRevokeOpen(false);
              revoke.mutate();
            }}
          >
            Its access and refresh tokens stop working immediately. To connect it again, the agent has to sign in once more. Its past writes stay in the audit
            log.
          </ConfirmDialog>
          {editOpen && <EditGrantDialog grant={g} onClose={() => setEditOpen(false)} />}
        </>
      )}
    </aside>
  );
}

function PrivilegeRow({ name, sub, children }: { name: string; sub: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-2">
      <span className="truncate text-sm text-ink">{name}</span>
      <span className="shrink-0 text-label font-medium text-ink-subtle">{sub}</span>
      <span className="ml-auto">{children}</span>
    </div>
  );
}

function entryIcon(e: AuditEntry) {
  const a = e.action.toLowerCase();
  if (a.includes("delete")) return <Trash2 />;
  if (a.includes("comment")) return <MessageSquare />;
  if (a.includes("create")) return <Plus />;
  if (a.includes("revert") || a.includes("restore")) return <Undo2 />;
  if (a.includes("move") || a.includes("status") || e.text.includes("→")) return <ArrowRight />;
  return <Pencil />;
}

/** Task keys in audit text become links; everything else stays plain. */
export function LinkedText({ text, wsSlug }: { text: string; wsSlug: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(new RegExp(TASK_KEY_RE.source, "g"))) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <Link key={at} to="/$ws/t/$taskKey" params={{ ws: wsSlug, taskKey: m[0] }} className="text-accent">
        {m[0]}
      </Link>,
    );
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function Activity({ grantId }: { grantId: string }) {
  const ws = useWorkspace();
  const sessions = useQuery(orpc.agents.sessions.queryOptions({ input: { grantId } }));
  const [confirm, setConfirm] = useState<AgentSession | null>(null);

  const revert = useMutation({
    mutationFn: (s: AgentSession) => client.agents.revertSession({ sessionId: s.id }),
    onSuccess: (r) => {
      toast(`Reverted ${r.reverted} write${r.reverted === 1 ? "" : "s"}${r.skipped ? ` · ${r.skipped} skipped (changed since)` : ""}`);
      queryClient.invalidateQueries({ queryKey: orpc.agents.sessions.key() });
      queryClient.invalidateQueries({ queryKey: orpc.audit.list.key() });
      queryClient.invalidateQueries({ queryKey: orpc.task.key() });
      queryClient.invalidateQueries({ queryKey: orpc.doc.key() });
      queryClient.invalidateQueries({ queryKey: orpc.crm.key() });
      queryClient.invalidateQueries({ queryKey: orpc.trash.key() });
    },
    onError: (e) => toast.error(`Couldn't revert: ${errorMessage(e)}`),
  });

  return (
    <section className="flex flex-col gap-3 px-5 py-4">
      <h3 className="text-sm font-medium text-ink">
        Activity <span className="ml-1 text-label font-normal text-ink-subtle">audit log, this agent only</span>
      </h3>
      {sessions.isPending ? (
        <Spinner className="my-4 self-center" />
      ) : sessions.isError ? (
        <p className="text-label text-ink-subtle">Couldn't load activity. {errorMessage(sessions.error)}</p>
      ) : sessions.data.length === 0 ? (
        <p className="text-label text-ink-subtle">No writes yet.</p>
      ) : (
        sessions.data.map((s) => (
          <div key={s.id} className="flex flex-col gap-1.5">
            <div className="flex h-7 items-center gap-2">
              <Badge>session {sessionShortId(s.id)}</Badge>
              <span className="min-w-0 truncate text-label text-ink-subtle">
                {dayGroup(s.startedAt) === "Today" ? `today ${clock(s.startedAt)}` : dayGroup(s.startedAt)} · {s.writes} write{s.writes === 1 ? "" : "s"}
              </span>
              {s.revertedAt ? (
                <span className="ml-auto text-label text-ink-subtle">Reverted</span>
              ) : s.writes > 0 ? (
                <button
                  type="button"
                  className="-mr-1 ml-auto flex h-7 items-center gap-1.5 rounded-md px-1.5 text-label font-medium text-accent outline-none hover:bg-state-hover active:scale-[0.98] disabled:opacity-50"
                  disabled={revert.isPending}
                  onClick={() => setConfirm(s)}
                >
                  <RotateCcw className="size-3.5" />
                  Revert
                </button>
              ) : null}
            </div>
            {s.entries.length > 0 && (
              <ul className={cn("ml-[9px] flex flex-col gap-1.5 border-l border-edge pl-3", s.revertedAt && "opacity-60")}>
                {s.entries.map((e) => (
                  <li key={e.id} className="flex items-start gap-2 text-label text-ink-muted [&>svg]:mt-px [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-ink-subtle">
                    {entryIcon(e)}
                    <span className={cn("min-w-0", e.revertedAt && "line-through decoration-ink-faint")}>
                      <LinkedText text={e.text} wsSlug={ws.slug} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))
      )}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Revert session ${confirm ? sessionShortId(confirm.id) : ""}?`}
        confirmLabel="Revert session"
        onConfirm={() => {
          if (confirm) revert.mutate(confirm);
          setConfirm(null);
        }}
      >
        Undoes all {confirm?.writes} writes of this run as a new change by you. Items edited by someone else since are skipped. Nothing is overwritten: every reverted item gets a new revision.
      </ConfirmDialog>
    </section>
  );
}

function draftFromGrant(g: AgentGrant): GrantDraft {
  return {
    agentName: g.agentName,
    all: g.projectScope === "all",
    allLevel: g.allLevel,
    checked: Object.fromEntries(g.projects.map((p) => [p.projectId, true])),
    levels: Object.fromEntries(g.projects.map((p) => [p.projectId, p.level])),
    resourceTypes: g.resourceTypes,
    expiry: "30d",
  };
}

function usePickerProjects() {
  const { data: workspaces = [] } = useWorkspaces();
  return workspaces.flatMap((w) => w.projects.map((p) => ({ id: p.id, key: p.key, name: p.name, workspaceName: w.name })));
}

function EditGrantDialog({ grant, onClose }: { grant: AgentGrant; onClose: () => void }) {
  const projects = usePickerProjects();
  const [draft, setDraft] = useState(() => draftFromGrant(grant));
  const save = useMutation({
    mutationFn: () => {
      const { expiry: _keep, ...rest } = draftToInput(draft);
      return client.agents.update({ id: grant.id, grant: rest });
    },
    onSuccess: (g) => {
      queryClient.setQueryData(orpc.agents.get.queryKey({ input: { id: grant.id } }), g);
      queryClient.invalidateQueries({ queryKey: orpc.agents.list.key() });
      toast("Privileges saved. They apply on the agent's next call.");
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Edit ${grant.agentName}`} className="max-w-[600px]">
      <form
        className="flex min-h-0 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (draftValid(draft)) save.mutate();
        }}
      >
        <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-5">
          <h2 className="text-base font-semibold text-ink">Edit privileges</h2>
          <AgentNameField value={draft.agentName} onChange={(agentName) => setDraft({ ...draft, agentName })} />
          <ProjectLevelTable projects={projects} draft={draft} onChange={setDraft} />
          <ResourceTypesRow value={draft.resourceTypes} onChange={(resourceTypes) => setDraft({ ...draft, resourceTypes })} />
          {save.error && <p className="text-label text-danger">{errorMessage(save.error)}</p>}
        </div>
        <div className="flex items-center gap-2 border-t border-edge px-5 py-3">
          <span className="flex items-center gap-1.5 text-label text-ink-subtle">
            <ShieldCheck className="size-4" />
            {grantSummary(draft)}
          </span>
          <Button className="ml-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!draftValid(draft)} loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Fallback when OAuth isn't an option: same picker, the token is shown once. */
function TokenDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const projects = usePickerProjects();
  const { data: info } = useQuery(orpc.settings.instance.queryOptions({ staleTime: 300_000 }));
  const [draft, setDraft] = useState(() => emptyDraft("Personal token"));
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const create = useMutation({
    mutationFn: () => client.agents.createToken(draftToInput(draft)),
    onSuccess: (r) => {
      setCreated({ token: r.token, name: r.grant.agentName });
      queryClient.invalidateQueries({ queryKey: orpc.agents.list.key() });
    },
  });
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setCreated(null);
      setDraft(emptyDraft("Personal token"));
      create.reset();
    }
  };
  const mcpUrl = info?.mcpUrl ?? `${location.origin}/mcp`;
  return (
    <Dialog open={open} onOpenChange={close} title="Personal access token" className="max-w-[600px]">
      {created ? (
        <div className="flex flex-col gap-4 p-5">
          <div>
            <h2 className="text-base font-semibold text-ink">Token for {created.name}</h2>
            <p className="mt-1 text-sm text-ink-muted">Copy it now. It is shown only once; mado stores a hash.</p>
          </div>
          <CopyField value={created.token} label="Copy token" />
          <div className="flex flex-col gap-1.5">
            <span className="text-label font-medium text-ink">Add to Claude Code</span>
            <CopyField multiline label="Copy command" value={`claude mcp add --transport http mado ${mcpUrl} --header "Authorization: Bearer ${created.token}"`} />
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => close(false)}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (draftValid(draft)) create.mutate();
          }}
        >
          <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-5">
            <div>
              <h2 className="text-base font-semibold text-ink">Personal access token</h2>
              <p className="mt-1 text-sm text-ink-muted">For agents that can't do OAuth. Same grant as a connected agent: you can change or revoke it later.</p>
            </div>
            <AgentNameField autoFocus value={draft.agentName} onChange={(agentName) => setDraft({ ...draft, agentName })} />
            <ProjectLevelTable projects={projects} draft={draft} onChange={setDraft} />
            <ExpiryBlock value={draft.expiry} onChange={(expiry) => setDraft({ ...draft, expiry })} />
            <ResourceTypesRow value={draft.resourceTypes} onChange={(resourceTypes) => setDraft({ ...draft, resourceTypes })} />
            {create.error && <p className="text-label text-danger">{errorMessage(create.error)}</p>}
          </div>
          <div className="flex items-center gap-2 border-t border-edge px-5 py-3">
            <span className="flex items-center gap-1.5 text-label text-ink-subtle">
              <ShieldCheck className="size-4" />
              {grantSummary(draft)}
            </span>
            <Button className="ml-auto" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!draftValid(draft)} loading={create.isPending}>
              Create token
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
