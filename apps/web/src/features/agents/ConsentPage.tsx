import { Avatar, Badge, Button, Spinner } from "@mado/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Navigate, useSearch } from "@tanstack/react-router";
import { Bot, Globe, KeyRound, ShieldCheck } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { errorMessage, orpc } from "../../lib/orpc";
import { modKey } from "../../lib/platform";
import { useCommands } from "../../lib/shortcuts";
import { ago } from "../../lib/time";
import { useMe, useWorkspaces } from "../../lib/workspace";
import { AuthFrame, FormError, LogoTile } from "../auth/AuthLayout";
import {
  AgentNameField,
  draftToInput,
  draftValid,
  emptyDraft,
  ExpiryBlock,
  type GrantDraft,
  grantSummary,
  ProjectLevelTable,
  ResourceTypesRow,
} from "./GrantPicker";

/** OAuth consent (Web 05). The agent gets exactly what is ticked here, never more than the user's own rights. */
export function ConsentPage() {
  const { request } = useSearch({ from: "/oauth/consent" });
  const me = useMe();

  if (me.isPending) return <Center><Spinner /></Center>;
  // Built from the request ID, not the live location: while the redirect is pending the location already points at /login.
  if (!me.data) return <Navigate to="/login" search={{ next: `/oauth/consent${request ? `?request=${encodeURIComponent(request)}` : ""}` }} />;
  if (!request) {
    return (
      <AuthFrame>
        <Message title="No authorization request">Start the connection from your agent again. This page only opens as part of an OAuth sign-in.</Message>
      </AuthFrame>
    );
  }
  return <Consent requestId={request} />;
}

function Consent({ requestId }: { requestId: string }) {
  const consent = useQuery(orpc.oauth.consent.queryOptions({ input: { requestId }, retry: false, staleTime: Infinity }));
  const { data: workspaces = [] } = useWorkspaces();
  const [draft, setDraft] = useState<GrantDraft | null>(null);

  useEffect(() => {
    if (consent.data && !draft) setDraft(emptyDraft(consent.data.client.name));
  }, [consent.data, draft]);

  const leave = ({ redirectTo }: { redirectTo: string }) => {
    window.location.href = redirectTo;
  };
  const approve = useMutation(orpc.oauth.approve.mutationOptions({ onSuccess: leave }));
  const deny = useMutation(orpc.oauth.deny.mutationOptions({ onSuccess: leave }));
  const busy = approve.isPending || deny.isPending || approve.isSuccess || deny.isSuccess;
  const canApprove = !!draft && draftValid(draft) && !busy;

  const submit = () => {
    if (draft && canApprove) approve.mutate({ requestId, grant: draftToInput(draft) });
  };

  useCommands(
    [
      { id: "consent.approve", title: "Approve agent", keys: "$mod+Enter", hint: `${modKey}↵`, group: "Actions", global: true, run: submit },
      { id: "consent.deny", title: "Deny agent", group: "Actions", run: () => !busy && deny.mutate({ requestId }) },
    ],
    [canApprove, draft],
  );

  if (consent.isPending || (consent.data && !draft)) return <Center><Spinner /></Center>;
  if (consent.isError || !consent.data || !draft) {
    return (
      <AuthFrame>
        <Message title="This request is no longer valid">
          It may have expired or been answered already. Start the connection from your agent again.
          <span className="mt-2 block text-ink-faint">{errorMessage(consent.error)}</span>
        </Message>
      </AuthFrame>
    );
  }

  const c = consent.data;
  // Projects from the consent request carry their workspace; fall back to the workspace list if the server omits them.
  const projects =
    c.projects.length > 0
      ? c.projects.map((p) => ({ id: p.id, key: p.key, name: p.name, workspaceName: p.workspaceName }))
      : workspaces.flatMap((w) => w.projects.map((p) => ({ id: p.id, key: p.key, name: p.name, workspaceName: w.name })));
  const role = c.user.role === "owner" ? "Owner" : "Member";
  const firstWs = workspaces[0]?.slug;

  return (
    <AuthFrame className="gap-4 px-3 sm:px-4">
      <form
        className="flex w-full max-w-[600px] animate-fade flex-col gap-5 rounded-xl border border-edge bg-panel px-4 pb-6 pt-6 sm:px-8 sm:pt-7"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-center gap-3">
          <Avatar type="agent" size="lg" />
          <span className="flex gap-[3px]" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-[3px] rounded-full bg-ink-subtle" />
            ))}
          </span>
          <LogoTile />
        </div>

        <div className="flex flex-col gap-1.5">
          <h1 className="text-title text-ink">{c.client.name} wants to connect to mado</h1>
          <p className="text-sm text-ink-muted">
            Signed in as <span className="font-medium text-ink">{c.user.name}</span> ({role}). The agent gets exactly what you tick below — never more than
            your own rights. Every action is logged under its name.
          </p>
        </div>

        <div className="divide-y divide-edge overflow-hidden rounded-lg border border-edge">
          <ClientRow icon={<Bot />} label="Client">
            <span className="truncate text-sm text-ink">{c.client.name}</span>
            {!c.client.verified && <Badge className="text-ink-muted">unverified</Badge>}
          </ClientRow>
          <ClientRow icon={<Globe />} label="Redirect">
            <span className="truncate text-label font-medium text-ink-muted">{c.client.redirectUri}</span>
          </ClientRow>
          <ClientRow icon={<KeyRound />} label="Registered">
            <span className="truncate text-sm text-ink-muted">Dynamic client registration · {ago(c.client.registeredAt, { long: true })}</span>
          </ClientRow>
        </div>

        <AgentNameField value={draft.agentName} onChange={(agentName) => setDraft({ ...draft, agentName })} />
        <ProjectLevelTable projects={projects} draft={draft} onChange={setDraft} />
        <ExpiryBlock value={draft.expiry} onChange={(expiry) => setDraft({ ...draft, expiry })} />
        <ResourceTypesRow value={draft.resourceTypes} onChange={(resourceTypes) => setDraft({ ...draft, resourceTypes })} />

        <FormError>{approve.error ? errorMessage(approve.error) : deny.error ? errorMessage(deny.error) : null}</FormError>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="flex items-center gap-1.5 text-label text-ink-subtle">
            <ShieldCheck className="size-4" />
            {grantSummary(draft)}
          </span>
          <div className="ml-auto flex gap-2">
            <Button disabled={busy} loading={deny.isPending} onClick={() => deny.mutate({ requestId })}>
              Deny
            </Button>
            <Button type="submit" variant="primary" kbd={`${modKey}↵`} disabled={!canApprove} loading={approve.isPending}>
              Approve
            </Button>
          </div>
        </div>
      </form>
      <p className="text-center text-label text-ink-subtle">
        Change or revoke this later in{" "}
        {firstWs ? (
          <a href={`/${firstWs}/settings/agents`} className="text-accent">
            Settings › Connected agents
          </a>
        ) : (
          <span className="text-accent">Settings › Connected agents</span>
        )}
        .
      </p>
    </AuthFrame>
  );
}

function ClientRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex h-9 items-center gap-2.5 px-3 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-ink-subtle">
      {icon}
      <span className="w-[76px] shrink-0 text-label text-ink-subtle">{label}</span>
      <span className="flex min-w-0 items-center gap-2">{children}</span>
    </div>
  );
}

function Message({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex w-full max-w-[420px] flex-col items-center gap-3 text-center">
      <LogoTile className="size-10 rounded-[9px]" />
      <h1 className="text-title text-ink">{title}</h1>
      <p className="text-sm text-ink-subtle">{children}</p>
    </div>
  );
}

function Center({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center">{children}</div>;
}
