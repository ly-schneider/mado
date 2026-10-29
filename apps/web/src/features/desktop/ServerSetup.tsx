import type { Contract } from "@mado/contract";
import { Button, Field, Input } from "@mado/ui";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { queryClient } from "../../lib/orpc";
import { isTauri } from "../../lib/platform";
import { AuthScreen, FormError } from "../auth/AuthLayout";
import { normalizeServer, setDesktopServer, useDesktopServer } from "./server";

/** Probes the server with a real oRPC call, so CORS and cookies for tauri:// are checked too. */
async function probe(origin: string) {
  const client: ContractRouterClient<Contract> = createORPCClient(
    new RPCLink({ url: `${origin}/rpc`, fetch: (request, init) => globalThis.fetch(request, { ...init, credentials: "include" }) }),
  );
  await client.auth.setupStatus();
}

/** First-run screen of the desktop app: which mado server to talk to. */
export function ServerSetup() {
  const current = useDesktopServer();
  const [value, setValue] = useState(current ?? "");
  const [invalid, setInvalid] = useState(false);

  const connect = useMutation({
    mutationFn: async (origin: string) => {
      await probe(origin);
      return origin;
    },
    onSuccess: async (origin) => {
      // Cached data belongs to the previous server.
      queryClient.clear();
      setDesktopServer(origin);
      location.replace("/");
    },
  });

  return (
    <AuthScreen title="Connect to your server">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const origin = normalizeServer(value);
          setInvalid(!origin);
          if (origin) connect.mutate(origin);
        }}
      >
        <Field label="Server URL">
          <Input
            autoFocus
            required
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="mado.example.ch"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <FormError>
          {invalid
            ? "That doesn't look like an address."
            : connect.isError
              ? `Couldn't reach mado at ${normalizeServer(value)}.`
              : null}
        </FormError>
        <Button type="submit" variant="primary" loading={connect.isPending} className="w-full">
          Connect
        </Button>
      </form>
    </AuthScreen>
  );
}

/** Wrap the root outlet with this: in the desktop app nothing else renders until a server is set. */
export function DesktopGate({ children }: { children: ReactNode }) {
  const server = useDesktopServer();
  if (isTauri && !server) return <ServerSetup />;
  return children;
}
