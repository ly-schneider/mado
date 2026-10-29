import { findTaskKeys } from "@mado/contract";
import { useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import { isTauri } from "../../lib/platform";
import { isTyping } from "../../lib/shortcuts";
import { openCapture, openPalette, setUi } from "../../lib/ui";
import { setDesktopServer } from "./server";

/** True inside the small always-on-top ⌥Space window. The shell renders the capture page bare there. */
export function isCaptureWindow() {
  if (!isTauri) return false;
  try {
    return getCurrentWindow().label === "capture";
  } catch {
    return false;
  }
}

/** Fired on window when ⌥Space shows the capture window again, so the page can reset and refocus. */
export const CAPTURE_OPEN_EVENT = "mado:capture-open";

/**
 * Native glue for the desktop app. Mount once inside the /$ws shell; renders nothing on the web.
 * Handles menu commands, mado:// deep links, the capture window and window dragging.
 */
export function DesktopBridge() {
  if (!isTauri) return null;
  return isCaptureWindow() ? <CaptureWindowBridge /> : <MainWindowBridge />;
}

function useDragRegions() {
  useEffect(() => {
    // WKWebView ignores -webkit-app-region, so `.drag-region` elements start a native drag here.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (!target.closest(".drag-region") || target.closest(".no-drag, button, a, input, textarea, select, [role=button], [contenteditable]")) return;
      e.preventDefault();
      const win = getCurrentWindow();
      if (e.detail === 2) win.toggleMaximize();
      else win.startDragging();
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);
}

/** Runs `subscribe` and unlistens on unmount, even if unmount happens before listen() resolves. */
function useTauriListener(subscribe: () => Promise<() => void>, deps: unknown[]) {
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    subscribe().then((fn) => {
      if (cancelled) fn();
      else stop = fn;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, deps);
}

function MainWindowBridge() {
  const { ws } = useParams({ from: "/$ws" });
  const navigate = useNavigate();
  const nav = useRef(navigate);
  nav.current = navigate;
  useDragRegions();

  useTauriListener(async () => {
    const openLinks = async () => {
      const urls = await invoke<string[]>("take_deep_links");
      for (const url of urls) {
        const rest = url.replace(/^mado:\/\//i, "").replace(/\/+$/, "");
        if (/^capture\b/i.test(rest)) {
          openCapture("task");
          continue;
        }
        const [key] = findTaskKeys(rest, { caseInsensitive: true });
        if (key) nav.current({ to: "/$ws/t/$taskKey", params: { ws, taskKey: key } });
      }
    };
    await openLinks();

    const stops = await Promise.all([
      listen("deep-link", openLinks),
      listen<string>("menu", ({ payload }) => {
        switch (payload) {
          case "new-task":
            return openCapture("task");
          case "command-palette":
            return openPalette();
          case "toggle-sidebar":
            return setUi((s) => ({ sidebarOpen: !s.sidebarOpen }));
          case "shortcuts":
            return openPalette("");
          case "settings":
            return nav.current({ to: "/$ws/settings", params: { ws } });
          case "change-server":
            setDesktopServer(null);
            return;
        }
      }),
      // The capture window hands navigation (e.g. "create and open") over to the main window.
      listen<string>("open-path", ({ payload }) => nav.current({ href: payload })),
    ]);
    return () => {
      for (const stop of stops) stop();
    };
  }, [ws]);

  return null;
}

function CaptureWindowBridge() {
  const { ws } = useParams({ from: "/$ws" });
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.href });
  const capturePath = `/${ws}/capture`;

  useEffect(() => {
    document.documentElement.dataset.window = "capture";
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  // Anything other than the capture page belongs in the main window.
  useEffect(() => {
    if (path.startsWith(capturePath)) return;
    const isInitialRedirect = path === "/" || /^\/[^/]+\/my-tasks/.test(path);
    if (!isInitialRedirect) {
      emitTo("main", "open-path", path);
      invoke("hide_capture");
    }
    navigate({ to: "/$ws/capture", params: { ws }, replace: true });
  }, [path, capturePath, ws, navigate]);

  useTauriListener(
    () =>
      listen("capture:open", () => {
        navigate({ to: "/$ws/capture", params: { ws }, replace: true });
        window.dispatchEvent(new Event(CAPTURE_OPEN_EVENT));
      }),
    [ws],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (isTyping(e) && (e.target as HTMLElement).closest("[role=listbox], [role=menu]")) return;
      invoke("hide_capture");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
