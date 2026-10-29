import type { Invite, Member, ShareLink, Workspace } from "@mado/contract";
import { Avatar, Badge, Button, Card, CardRow, cn, EmptyState, Input, Select, Spinner } from "@mado/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { History, Link2, Lock, Plus, Users } from "lucide-react";
import { useState } from "react";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { useCommands } from "../../lib/shortcuts";
import { ago, shortDate } from "../../lib/time";
import { toast } from "../../lib/toast";
import { useMe, useWorkspace } from "../../lib/workspace";
import { LinkedText } from "../agents/ConnectedAgents";
import { ConfirmDialog, CopyField, InlineInput, SettingsGroup } from "./shared";

export function WorkspaceSection() {
  const ws = useWorkspace();
  const owner = ws.role === "owner";
  const rename = useMutation({
    mutationFn: (name: string) => client.workspace.update({ id: ws.id, name }),
    onMutate: (name) => {
      const key = orpc.workspace.list.queryKey();
      const prev = queryClient.getQueryData<Workspace[]>(key);
      if (prev) queryClient.setQueryData(key, prev.map((w) => (w.id === ws.id ? { ...w, name } : w)));
      return { prev };
    },
    onError: (e, _n, ctx) => {
      queryClient.setQueryData(orpc.workspace.list.queryKey(), ctx?.prev);
      toast.error(`Couldn't rename: ${errorMessage(e)}`);
    },
    onSuccess: () => toast("Workspace renamed"),
  });
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typedName, setTypedName] = useState("");
  const remove = useMutation({
    mutationFn: () => client.workspace.delete({ id: ws.id, confirmName: typedName }),
    onSuccess: async () => {
      setConfirmDelete(false);
      localStorage.removeItem("mado.lastWorkspace");
      await queryClient.invalidateQueries({ queryKey: orpc.workspace.list.key() });
      toast(`Deleted ${ws.name}`);
      navigate({ to: "/" });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <SettingsGroup title="General">
        <Card>
          <CardRow title="Name" description={owner ? "Shown in the sidebar and in invites." : "Only the owner can rename the workspace."}>
            <InlineInput label="Workspace name" className="w-56" value={ws.name} disabled={!owner} onSave={(name) => rename.mutate(name)} />
          </CardRow>
          <CardRow title="URL" description="The workspace slug in every link.">
            <span className="truncate text-sm text-ink-muted">/{ws.slug}</span>
          </CardRow>
          <CardRow title="Your role" description={owner ? "Everything, including purge from trash." : "Read and write docs and tasks in this workspace."}>
            <Badge>{owner ? "Owner" : "Member"}</Badge>
          </CardRow>
        </Card>
      </SettingsGroup>

      {owner && (
        <SettingsGroup title="Danger zone" description="Nothing in mado is deleted at once. Deleted projects go to the trash for 30 days.">
          <Card>
            <CardRow title="Delete a project" description="Moves its tasks, pages and leads to the trash.">
              <Link to="/$ws/settings/$section" params={{ ws: ws.slug, section: "projects" }} className="text-sm text-accent">
                Projects
              </Link>
            </CardRow>
            <CardRow title="Delete workspace" description="Removes it for every member. Its data stays in the database and in backups.">
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete workspace
              </Button>
            </CardRow>
          </Card>
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={(open) => {
              setConfirmDelete(open);
              if (!open) setTypedName("");
            }}
            title={`Delete ${ws.name}?`}
            confirmLabel="Delete workspace"
            danger
            focusConfirm={false}
            loading={remove.isPending}
            onConfirm={() => typedName.trim() === ws.name && remove.mutate()}
          >
            <p className="mb-3">
              Every project, page, task and lead in it disappears for all members, and connected agents lose access to it. Type{" "}
              <strong className="text-ink">{ws.name}</strong> to confirm.
            </p>
            <Input autoFocus value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder={ws.name} aria-label="Workspace name" />
          </ConfirmDialog>
        </SettingsGroup>
      )}
    </>
  );
}

function pending(i: Invite) {
  return !i.acceptedAt && !i.revokedAt && new Date(i.expiresAt).getTime() > Date.now();
}

export function MembersSection() {
  const ws = useWorkspace();
  const { data: me } = useMe();
  const owner = ws.role === "owner";
  const members = useQuery(orpc.workspace.members.queryOptions({ input: { workspaceId: ws.id } }));
  const invites = useQuery(orpc.workspace.invites.queryOptions({ input: { workspaceId: ws.id }, enabled: owner }));
  const [removing, setRemoving] = useState<Member | null>(null);
  const [fresh, setFresh] = useState<Invite | null>(null);
  const membersKey = orpc.workspace.members.queryKey({ input: { workspaceId: ws.id } });
  const invitesKey = orpc.workspace.invites.queryKey({ input: { workspaceId: ws.id } });

  const remove = useMutation({
    mutationFn: (m: Member) => client.workspace.removeMember({ workspaceId: ws.id, userId: m.userId }),
    onMutate: (m) => {
      const prev = queryClient.getQueryData<Member[]>(membersKey);
      if (prev) queryClient.setQueryData(membersKey, prev.filter((x) => x.userId !== m.userId));
      return { prev };
    },
    onError: (e, _m, ctx) => {
      queryClient.setQueryData(membersKey, ctx?.prev);
      toast.error(`Couldn't remove: ${errorMessage(e)}`);
    },
    onSuccess: (_r, m) => toast(`${m.name} removed from ${ws.name}`),
  });

  const create = useMutation({
    mutationFn: () => client.workspace.createInvite({ workspaceId: ws.id, role: "member" }),
    onSuccess: (inv) => {
      setFresh(inv);
      queryClient.invalidateQueries({ queryKey: invitesKey });
    },
    onError: (e) => toast.error(`Couldn't create invite: ${errorMessage(e)}`),
  });

  const revoke = useMutation({
    mutationFn: (inv: Invite) => client.workspace.revokeInvite({ id: inv.id }),
    onMutate: (inv) => {
      const prev = queryClient.getQueryData<Invite[]>(invitesKey);
      if (prev) queryClient.setQueryData(invitesKey, prev.map((x) => (x.id === inv.id ? { ...x, revokedAt: new Date().toISOString() } : x)));
      if (fresh?.id === inv.id) setFresh(null);
      return { prev };
    },
    onError: (e, _i, ctx) => {
      queryClient.setQueryData(invitesKey, ctx?.prev);
      toast.error(`Couldn't revoke: ${errorMessage(e)}`);
    },
    onSuccess: () => toast("Invite revoked"),
  });

  useCommands(owner ? [{ id: "members.invite", title: "Create invite link", group: "Settings", icon: <Plus />, run: () => create.mutate() }] : [], [owner]);

  const open = (invites.data ?? []).filter(pending);
  return (
    <>
      <SettingsGroup title="Members" description={members.data ? `${members.data.length} ${members.data.length === 1 ? "person" : "people"}` : undefined}>
        {members.isPending ? (
          <Spinner className="self-center" />
        ) : members.isError ? (
          <p className="text-label text-ink-subtle">{errorMessage(members.error)}</p>
        ) : (
          <Card>
            {members.data.map((m) => (
              <div key={m.userId} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                <Avatar type="user" initials={m.initials} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">
                    {m.name}
                    {m.userId === me?.id && <span className="ml-1.5 font-normal text-ink-subtle">you</span>}
                  </div>
                  <div className="truncate text-label text-ink-subtle">
                    {m.email} · joined {shortDate(m.joinedAt)}
                  </div>
                </div>
                <Badge>{m.role === "owner" ? "Owner" : "Member"}</Badge>
                {owner && m.userId !== me?.id && (
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(m)}>
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </Card>
        )}
      </SettingsGroup>

      {owner && (
        <SettingsGroup
          title="Invites"
          description="Each link lets one person join as a member: they can read and write docs and tasks here."
          action={
            <Button icon={<Link2 />} loading={create.isPending} onClick={() => create.mutate()}>
              Create invite link
            </Button>
          }
        >
          {fresh?.url && (
            <div className="flex animate-pop flex-col gap-2 rounded-lg border border-edge bg-panel p-4">
              <span className="text-sm font-medium text-ink">New invite link</span>
              <CopyField value={fresh.url} label="Copy invite link" />
              <span className="text-label text-ink-subtle">Send it to one person. It's shown only now; revoke it below if it leaks.</span>
            </div>
          )}
          {open.length === 0 ? (
            <div className="rounded-lg border border-dashed border-edge px-4 py-5 text-center text-label text-ink-subtle">No pending invites.</div>
          ) : (
            <Card>
              {open.map((i) => (
                <CardRow
                  key={i.id}
                  title={i.email ?? "Anyone with the link"}
                  description={`Created ${ago(i.createdAt, { long: true })} · expires ${shortDate(i.expiresAt)} · ${i.role === "owner" ? "Owner" : "Member"}`}
                >
                  <Button size="sm" onClick={() => revoke.mutate(i)}>
                    Revoke
                  </Button>
                </CardRow>
              ))}
            </Card>
          )}
        </SettingsGroup>
      )}

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name} from ${ws.name}?`}
        confirmLabel="Remove"
        danger
        onConfirm={() => {
          if (removing) remove.mutate(removing);
          setRemoving(null);
        }}
      >
        They lose access to every project in this workspace at once, and so do agents they connected. Their tasks, pages and comments stay.
      </ConfirmDialog>
    </>
  );
}

function shareActive(s: ShareLink) {
  return !s.revokedAt && (!s.expiresAt || new Date(s.expiresAt).getTime() > Date.now());
}

export function SharingSection() {
  const ws = useWorkspace();
  const links = useQuery(orpc.share.list.queryOptions({ input: { workspaceId: ws.id } }));
  const key = orpc.share.list.queryKey({ input: { workspaceId: ws.id } });
  const [confirm, setConfirm] = useState<ShareLink | null>(null);
  const revoke = useMutation({
    mutationFn: (s: ShareLink) => client.share.revoke({ id: s.id }),
    onMutate: (s) => {
      const prev = queryClient.getQueryData<ShareLink[]>(key);
      if (prev) queryClient.setQueryData(key, prev.map((x) => (x.id === s.id ? { ...x, revokedAt: new Date().toISOString() } : x)));
      return { prev };
    },
    onError: (e, _s, ctx) => {
      queryClient.setQueryData(key, ctx?.prev);
      toast.error(`Couldn't revoke: ${errorMessage(e)}`);
    },
    onSuccess: (_r, s) => toast(`“${s.name}” revoked`),
  });

  if (links.isPending) return <Spinner className="self-center" />;
  if (links.isError) return <p className="text-label text-ink-subtle">{errorMessage(links.error)}</p>;
  const sorted = [...links.data].sort((a, b) => Number(shareActive(b)) - Number(shareActive(a)) || b.createdAt.localeCompare(a.createdAt));
  if (sorted.length === 0) {
    return (
      <div className="rounded-lg border border-edge">
        <EmptyState icon={<Link2 />} title="No share links">
          Share a wiki page from its ⋯ menu. Guests get a link, optionally with a PIN, and never see the rest of the workspace.
        </EmptyState>
      </div>
    );
  }
  return (
    <>
      <Card>
        {sorted.map((s) => {
          const active = shareActive(s);
          return (
            <div key={s.id} className={cn("flex min-h-14 items-center gap-3 px-4 py-2.5", !active && "opacity-50")}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 truncate text-sm font-medium text-ink">
                  {s.name}
                  <Badge>{s.type === "edit" ? "Can edit" : "View"}</Badge>
                  {s.hasPin && <Lock className="size-3.5 shrink-0 text-ink-subtle" aria-label="PIN protected" />}
                </div>
                <div className="truncate text-label text-ink-subtle">
                  <Link to="/$ws/wiki/$docId" params={{ ws: ws.slug, docId: s.docId }} className="text-accent">
                    {s.docTitle}
                  </Link>
                  {" · "}
                  {s.revokedAt
                    ? `revoked ${ago(s.revokedAt, { long: true })}`
                    : !active
                      ? "expired"
                      : s.expiresAt
                        ? `expires ${shortDate(s.expiresAt)}`
                        : "no expiry"}
                  {" · "}
                  {s.lastUsedAt ? `opened ${ago(s.lastUsedAt, { long: true })}` : "never opened"}
                </div>
              </div>
              {active && (
                <Button size="sm" onClick={() => setConfirm(s)}>
                  Revoke
                </Button>
              )}
            </div>
          );
        })}
      </Card>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Revoke “${confirm?.name}”?`}
        confirmLabel="Revoke link"
        danger
        onConfirm={() => {
          if (confirm) revoke.mutate(confirm);
          setConfirm(null);
        }}
      >
        Anyone using this link to {confirm?.docTitle} loses access at once. Edits guests already made stay in the revision history.
      </ConfirmDialog>
    </>
  );
}

export function AuditSection() {
  const ws = useWorkspace();
  const [grantId, setGrantId] = useState("all");
  const agents = useQuery(orpc.agents.list.queryOptions());
  const log = useQuery(
    orpc.audit.list.queryOptions({ input: { workspaceId: ws.id, grantId: grantId === "all" ? undefined : grantId, limit: 200 } }),
  );
  return (
    <>
      <div className="flex items-center gap-3">
        <Select
          className="w-64"
          value={grantId}
          onChange={setGrantId}
          options={[{ value: "all", label: "Everyone" }, ...(agents.data ?? []).map((a) => ({ value: a.id, label: a.agentName }))]}
        />
        <span className="text-label text-ink-subtle">{log.data ? `Latest ${log.data.length} entries` : null}</span>
      </div>
      {log.isPending ? (
        <Spinner className="self-center" />
      ) : log.isError ? (
        <p className="text-label text-ink-subtle">{errorMessage(log.error)}</p>
      ) : log.data.length === 0 ? (
        <div className="rounded-lg border border-edge">
          <EmptyState icon={<History />} title="Nothing logged yet" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-edge bg-panel">
          <div className="hidden h-8 grid-cols-[160px_minmax(0,1fr)_140px_64px] items-center gap-3 border-b border-edge px-4 text-label text-ink-subtle md:grid">
            <span>Actor</span>
            <span>Action</span>
            <span>Entity</span>
            <span className="text-right">When</span>
          </div>
          <div className="divide-y divide-edge">
            {log.data.map((e) => (
              <div
                key={e.id}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2 md:min-h-10 md:grid-cols-[160px_minmax(0,1fr)_140px_64px] md:py-1.5",
                  e.revertedAt && "opacity-50",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar type={e.actor.type} initials={e.actor.initials} size="sm" />
                  <span className="truncate text-label font-medium text-ink">{e.actor.name}</span>
                </span>
                <span className="text-right text-label text-ink-subtle md:order-last">{ago(e.createdAt)}</span>
                <span className={cn("col-span-2 min-w-0 truncate text-label text-ink-muted md:col-span-1", e.revertedAt && "line-through")}>
                  <LinkedText text={e.text} wsSlug={ws.slug} />
                </span>
                <span className="hidden truncate text-label text-ink-subtle md:block">{e.entityLabel}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="flex items-center gap-2 text-label text-ink-subtle">
        <Users className="size-4" />
        Agents always appear as themselves, never as the person who connected them.
      </p>
    </>
  );
}
