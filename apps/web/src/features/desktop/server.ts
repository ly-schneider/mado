import { useSyncExternalStore } from "react";
import { isTauri } from "../../lib/platform";

const KEY = "mado.server";
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** The server the desktop app talks to. Always set on the web, where the SPA uses its own origin. */
export function useDesktopServer(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (isTauri ? read() : location.origin),
  );
}

export function setDesktopServer(origin: string | null) {
  if (origin) localStorage.setItem(KEY, origin);
  else localStorage.removeItem(KEY);
  for (const l of listeners) l();
}

/** Accepts "mado.example.ch", "https://mado.example.ch/" or a full URL and returns the origin. */
export function normalizeServer(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `${/^(localhost|127\.|\[::1\])/.test(raw) ? "http" : "https"}://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}
