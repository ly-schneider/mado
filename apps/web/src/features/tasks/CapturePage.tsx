import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { isTauri } from "../../lib/platform";
import { CapturePanel, type CaptureKind } from "./CapturePanel";
import { useIsPhone } from "./data";

async function hideWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

/**
 * Full-page capture for the Tauri capture window (global ⌥Space) and the PWA "New task" shortcut.
 * In Tauri the window is transparent, so only the panel shows; closing hides the window.
 */
export function CapturePage() {
  const search = useSearch({ from: "/$ws/capture" });
  const navigate = useNavigate();
  const isPhone = useIsPhone();
  const [kind, setKind] = useState<CaptureKind>(search.kind ?? "task");
  const [session, setSession] = useState(0);

  useEffect(() => {
    if (!isTauri) return;
    const prev = document.body.style.background;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => {
      document.documentElement.style.background = "";
      document.body.style.background = prev;
    };
  }, []);

  const close = () => {
    if (isTauri) {
      setSession((n) => n + 1);
      void hideWindow();
    } else if (history.length > 1) history.back();
    else navigate({ to: "/" });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[data-open][role=dialog], [data-popup-open]")) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className={isTauri ? "fixed inset-0 z-40 flex items-start justify-center bg-transparent p-3" : "fixed inset-0 z-40 flex items-start justify-center bg-page md:px-4 md:pt-[18vh]"}>
      <div
        className={
          isPhone
            ? "h-full w-full bg-page"
            : "w-full max-w-[680px] overflow-hidden rounded-lg border border-edge bg-overlay shadow-[0_8px_32px_-8px_rgb(0_0_0/0.5)] animate-pop"
        }
      >
        <CapturePanel key={session} kind={kind} setKind={setKind} onClose={close} variant={isPhone ? "sheet" : "panel"} />
      </div>
    </div>
  );
}
