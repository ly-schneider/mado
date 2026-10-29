import { Avatar, Button, Field, Input, Spinner } from "@mado/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { client, errorMessage, orpc, queryClient } from "../../lib/orpc";
import { useMe } from "../../lib/workspace";
import { useIsPhone } from "../settings/shared";
import { AuthScreen, FormError } from "./AuthLayout";
import { MIN_PASSWORD } from "./SetupPage";

export function InvitePage() {
  const { token } = useParams({ from: "/invite/$token" });
  const navigate = useNavigate();
  const phone = useIsPhone();
  const me = useMe();
  const preview = useQuery(orpc.workspace.previewInvite.queryOptions({ input: { token }, retry: false }));
  const [name, setName] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);

  const accept = useMutation(
    orpc.workspace.acceptInvite.mutationOptions({
      onSuccess: async ({ workspaceId }) => {
        // A new account was signed in by the accept call.
        const user = await client.auth.me();
        queryClient.setQueryData(orpc.auth.me.queryKey(), user);
        const list = await queryClient.fetchQuery(orpc.workspace.list.queryOptions({ staleTime: 0 }));
        const ws = list.find((w) => w.id === workspaceId);
        if (ws) navigate({ to: "/$ws/my-tasks", params: { ws: ws.slug }, search: { tab: "assigned" }, replace: true });
        else navigate({ to: "/", replace: true });
      },
    }),
  );

  if (preview.isPending || me.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (preview.isError || !preview.data) {
    return (
      <AuthScreen title="Invite not found" description="This link is wrong or was revoked. Ask whoever sent it for a new one.">
        <Button className="w-full" size={phone ? "touch" : "md"} onClick={() => navigate({ to: "/" })}>
          Go to mado
        </Button>
      </AuthScreen>
    );
  }

  const inv = preview.data;
  const role = inv.role === "owner" ? "Owner" : "Member";
  const title = `Join ${inv.workspaceName}`;
  const description = (
    <>
      <span className="font-medium text-ink-muted">{inv.invitedBy}</span> invited you to <span className="font-medium text-ink-muted">{inv.workspaceName}</span> as {role}.
    </>
  );

  if (inv.expired) {
    return (
      <AuthScreen title="This invite has expired" description={<>Ask {inv.invitedBy} to send a new link to {inv.workspaceName}.</>}>
        <Button className="w-full" size={phone ? "touch" : "md"} onClick={() => navigate({ to: "/" })}>
          Go to mado
        </Button>
      </AuthScreen>
    );
  }

  if (me.data) {
    const user = me.data;
    return (
      <AuthScreen title={title} description={description}>
        <div className="flex items-center gap-3 rounded-lg border border-edge bg-panel px-3 py-2.5">
          <Avatar type="user" initials={user.initials} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink">{user.name}</div>
            <div className="truncate text-label text-ink-subtle">{user.email}</div>
          </div>
        </div>
        <FormError>{accept.error ? errorMessage(accept.error) : null}</FormError>
        <Button variant="primary" size={phone ? "touch" : "md"} className="w-full" loading={accept.isPending} autoFocus onClick={() => accept.mutate({ token })}>
          Accept invite
        </Button>
        <p className="text-center text-label text-ink-subtle">
          Not {user.name.split(" ")[0]}?{" "}
          <button
            type="button"
            className="text-accent"
            onClick={async () => {
              await client.auth.logout();
              queryClient.setQueryData(orpc.auth.me.queryKey(), null);
            }}
          >
            Log out
          </button>
        </p>
      </AuthScreen>
    );
  }

  const emailValue = email ?? inv.email ?? "";
  const short = password.length < MIN_PASSWORD;
  return (
    <AuthScreen
      title={title}
      description={description}
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" search={{ next: `/invite/${token}` }} className="text-accent">
            Log in
          </Link>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (short) return;
          accept.mutate({ token, account: { name: name.trim(), email: emailValue.trim(), password } });
        }}
      >
        <Field label="Name">
          <Input autoComplete="name" autoFocus required touch={phone} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" autoComplete="email" required touch={phone} value={emailValue} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" hint={`at least ${MIN_PASSWORD} characters`}>
          <Input type="password" autoComplete="new-password" required touch={phone} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <FormError>{touched && short ? `Use at least ${MIN_PASSWORD} characters.` : accept.error ? errorMessage(accept.error) : null}</FormError>
        <Button type="submit" variant="primary" size={phone ? "touch" : "md"} loading={accept.isPending} className="w-full">
          Create account and join
        </Button>
      </form>
    </AuthScreen>
  );
}
