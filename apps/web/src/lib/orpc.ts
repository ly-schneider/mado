import type { Contract } from "@mado/contract";
import { createORPCClient, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { type Query, QueryClient } from "@tanstack/react-query";
import { del, get, set } from "idb-keyval";
import { apiOrigin, isTauri } from "./platform";

const SESSION_HEADER = "x-mado-session";
const SESSION_KEY = "mado.desktopSession";

/**
 * The desktop app can't rely on cookies (WebKit blocks them cross-site from tauri://), so the API
 * returns the session in a header on login and the app sends it back on every call.
 */
async function desktopFetch(request: Request, init?: RequestInit) {
  const headers = new Headers(request.headers);
  const token = localStorage.getItem(SESSION_KEY);
  if (token) headers.set(SESSION_HEADER, token);
  const res = await globalThis.fetch(new Request(request, { headers }), init);
  const issued = res.headers.get(SESSION_HEADER);
  if (issued) localStorage.setItem(SESSION_KEY, issued);
  if (request.url.endsWith("/auth/logout")) localStorage.removeItem(SESSION_KEY);
  return res;
}

const link = new RPCLink({
  url: () => `${apiOrigin()}/rpc`,
  fetch: (request, init) => (isTauri ? desktopFetch(request, init) : globalThis.fetch(request, { ...init, credentials: "include" })),
  interceptors: [
    onError((error) => {
      if ((error as { code?: string }).code === "UNAUTHORIZED" && !location.pathname.startsWith("/login")) {
        queryClient.setQueryData(orpc.auth.me.queryKey(), null);
      }
    }),
  ],
});

export const client: ContractRouterClient<Contract> = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // Persisted cache is what makes cached pages open in < 100 ms; keep it for a week.
      gcTime: 7 * 86_400_000,
      retry: (count, error) => count < 2 && !["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"].includes((error as { code?: string }).code ?? ""),
      refetchOnWindowFocus: true,
    },
    mutations: { retry: 0 },
  },
});

export const persister = createAsyncStoragePersister({
  storage: { getItem: (k) => get(k), setItem: (k, v) => set(k, v), removeItem: (k) => del(k) },
  key: "mado.cache.v1",
  throttleTime: 1000,
});

/**
 * Who is signed in must always come from the server: a persisted "signed out" written just before
 * login would bounce a quick reload back to /login. Guest pages carry PINs, so they stay out too.
 */
export function shouldPersist(query: Query) {
  if (query.state.status !== "success") return false;
  const path = (query.queryKey[0] as unknown[] | undefined)?.[0];
  return path !== "auth" && path !== "guest";
}

export function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) return String((error as { message: string }).message);
  return "Something went wrong";
}
