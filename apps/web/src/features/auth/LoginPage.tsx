import { Button, Field, Input, Spinner } from "@mado/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { errorMessage, orpc, queryClient } from "../../lib/orpc";
import { useMe } from "../../lib/workspace";
import { useIsPhone } from "../settings/shared";
import { AuthScreen, FormError, safeNext } from "./AuthLayout";

export function LoginPage() {
  const { next } = useSearch({ from: "/login" });
  const target = safeNext(next);
  const navigate = useNavigate();
  const router = useRouter();
  const phone = useIsPhone();
  const setup = useQuery(orpc.auth.setupStatus.queryOptions());
  const me = useMe();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation(
    orpc.auth.login.mutationOptions({
      onSuccess: async (user) => {
        queryClient.setQueryData(orpc.auth.me.queryKey(), user);
        // The list isn't observed on this screen, so invalidating alone would leave stale data for the next one.
        await queryClient.fetchQuery(orpc.workspace.list.queryOptions({ staleTime: 0 }));
        if (target) router.history.replace(target);
        else navigate({ to: "/", replace: true });
      },
    }),
  );

  if (setup.data?.needsSetup) return <Navigate to="/setup" />;
  if (me.data && !login.isPending && !login.isSuccess) {
    return target ? <RedirectTo href={target} /> : <Navigate to="/" replace />;
  }
  if (me.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <AuthScreen title="Log in to mado" description={target?.startsWith("/oauth/") ? "An agent is waiting for your approval." : undefined}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate({ email: email.trim(), password });
        }}
      >
        <Field label="Email">
          <Input type="email" autoComplete="email" autoFocus required touch={phone} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required touch={phone} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <FormError>{login.error ? loginError(login.error) : null}</FormError>
        <Button type="submit" variant="primary" size={phone ? "touch" : "md"} loading={login.isPending} className="w-full">
          Log in
        </Button>
      </form>
      <p className="text-center text-label text-ink-subtle">No account? Ask the workspace owner for an invite link.</p>
    </AuthScreen>
  );
}

function loginError(error: unknown) {
  const code = (error as { code?: string }).code;
  if (code === "UNAUTHORIZED" || code === "BAD_REQUEST") return "Email or password is wrong.";
  if (code === "TOO_MANY_REQUESTS") return "Too many attempts. Wait a minute and try again.";
  return errorMessage(error);
}

function RedirectTo({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => router.history.replace(href), [router, href]);
  return null;
}
