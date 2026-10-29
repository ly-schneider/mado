export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const isStandalone =
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);

/**
 * Web and PWA talk to their own origin. The desktop app is served from tauri://, so it talks to the
 * configured server (Settings › Desktop), stored locally.
 */
export function apiOrigin(): string {
  if (!isTauri) return location.origin;
  try {
    return localStorage.getItem("mado.server") ?? "http://localhost:4100";
  } catch {
    return "http://localhost:4100";
  }
}

export const modKey = isMac ? "⌘" : "Ctrl";
