import { Button, Field, Input, Spinner } from "@mado/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { errorMessage, orpc, queryClient } from "../../lib/orpc";
import { useIsPhone } from "../settings/shared";
import { AuthScreen, FormError } from "./AuthLayout";

export const MIN_PASSWORD = 10;

export function SetupPage() {
  const navigate = useNavigate();
  const phone = useIsPhone();
  const status = useQuery(orpc.auth.setupStatus.queryOptions());
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);

  const setup = useMutation(
    orpc.auth.setup.mutationOptions({
      onSuccess: (user) => {
        queryClient.setQueryData(orpc.auth.me.queryKey(), user);
        queryClient.setQueryData(orpc.auth.setupStatus.queryKey(), { needsSetup: false });
        navigate({ to: "/onboarding", replace: true });
      },
    }),
  );

  if (status.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (status.data && !status.data.needsSetup && !setup.isSuccess) return <Navigate to="/login" search={{ next: undefined }} />;

  const short = password.length < MIN_PASSWORD;
  return (
    <AuthScreen title="Set up mado" description="Create the owner account.">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (short) return;
          setup.mutate({ name: name.trim(), email: email.trim(), password });
        }}
      >
        <Field label="Name">
          <Input autoComplete="name" autoFocus required touch={phone} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" autoComplete="email" required touch={phone} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" hint={`at least ${MIN_PASSWORD} characters`}>
          <Input
            type="password"
            autoComplete="new-password"
            required
            touch={phone}
            value={password}
            onBlur={() => password && setTouched(true)}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <FormError>{touched && short ? `Use at least ${MIN_PASSWORD} characters.` : setup.error ? errorMessage(setup.error) : null}</FormError>
        <Button type="submit" variant="primary" size={phone ? "touch" : "md"} loading={setup.isPending} className="w-full">
          Create account
        </Button>
      </form>
    </AuthScreen>
  );
}
