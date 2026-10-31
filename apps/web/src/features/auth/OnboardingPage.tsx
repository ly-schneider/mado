import { PROJECT_KEY_RE } from "@mado/contract";
import { Button, Field, Input, Spinner } from "@mado/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { Check, X } from "@mado/ui/fluent";
import { useEffect, useState } from "react";
import { errorMessage, orpc, queryClient } from "../../lib/orpc";
import { useMe } from "../../lib/workspace";
import { useIsPhone } from "../settings/shared";
import { AuthScreen, FormError } from "./AuthLayout";

/** "mado" → "MAD", "Q4 launch" → "Q4L". */
export function suggestKey(name: string) {
  const clean = name.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^[0-9]+/, "");
  return clean.slice(0, 3);
}

export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Live availability of a project key. IDs are never reused, so the check is instance-wide. */
export function useKeyCheck(key: string) {
  const valid = PROJECT_KEY_RE.test(key);
  const debounced = useDebounced(key);
  const q = useQuery(orpc.project.keyAvailable.queryOptions({ input: { key: debounced }, enabled: valid && debounced === key, staleTime: 5_000 }));
  const state: "empty" | "invalid" | "checking" | "taken" | "free" | "unknown" =
    !key ? "empty" : !valid ? "invalid" : debounced !== key ? "checking" : q.isError ? "unknown" : q.isPending ? "checking" : q.data?.available === false ? "taken" : "free";
  return state;
}

export function KeyStatus({ state }: { state: ReturnType<typeof useKeyCheck> }) {
  if (state === "empty") return <span className="text-label text-ink-subtle">2–5 capitals, digits allowed after the first</span>;
  if (state === "invalid") return <span className="text-label text-danger">2–5 capitals, starting with a letter</span>;
  if (state === "checking") return <span className="text-label text-ink-subtle">Checking…</span>;
  if (state === "unknown") return <span className="text-label text-ink-subtle">Couldn't check availability. The server checks again on create.</span>;
  if (state === "taken")
    return (
      <span className="flex items-center gap-1 text-label text-danger">
        <X className="size-3.5" /> Already used on this server
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-label text-ink-muted">
      <Check className="size-3.5" /> Available
    </span>
  );
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const phone = useIsPhone();
  const me = useMe();
  const [workspace, setWorkspace] = useState("");
  const [project, setProject] = useState("");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const keyState = useKeyCheck(key);

  const create = useMutation(
    orpc.workspace.create.mutationOptions({
      onSuccess: async (ws) => {
        // The list isn't observed on this screen, so invalidating alone would leave stale data for the next one.
        await queryClient.fetchQuery(orpc.workspace.list.queryOptions({ staleTime: 0 }));
        navigate({ to: "/$ws/my-tasks", params: { ws: ws.slug }, search: { tab: "assigned" }, replace: true });
      },
    }),
  );

  if (me.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!me.data) return <Navigate to="/login" search={{ next: "/onboarding" }} />;

  const canSubmit = workspace.trim() && project.trim() && (keyState === "free" || keyState === "unknown");
  return (
    <AuthScreen title="Create your workspace">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          create.mutate({ name: workspace.trim(), project: { name: project.trim(), key } });
        }}
      >
        <Field label="Workspace name">
          <Input autoFocus required placeholder="Acme" touch={phone} value={workspace} onChange={(e) => setWorkspace(e.target.value)} />
        </Field>
        <Field label="First project">
          <Input
            required
            placeholder="mado"
            touch={phone}
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              if (!keyEdited) setKey(suggestKey(e.target.value));
            }}
          />
        </Field>
        <div className="flex flex-col gap-1.5">
          <Field label="Key" hint="prefixes every task ID">
            <Input
              required
              maxLength={5}
              placeholder="MAD"
              touch={phone}
              value={key}
              className="uppercase"
              onChange={(e) => {
                setKeyEdited(true);
                setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5));
              }}
            />
          </Field>
          {keyState !== "empty" && <KeyStatus state={keyState} />}
        </div>
        <FormError>{create.error ? errorMessage(create.error) : null}</FormError>
        <Button type="submit" variant="primary" size={phone ? "touch" : "md"} disabled={!canSubmit} loading={create.isPending} className="w-full">
          Create workspace
        </Button>
      </form>
    </AuthScreen>
  );
}
