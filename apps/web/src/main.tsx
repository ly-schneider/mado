import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { preloadEditor } from "./features/editor/MarkdownEditor";
import { routeExternalLinksInDesktop } from "./lib/external";
import { persister, queryClient, shouldPersist } from "./lib/orpc";
import { router } from "./router";
import "./lib/theme";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 7 * 86_400_000, buster: "1", dehydrateOptions: { shouldDehydrateQuery: shouldPersist } }}>
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD && !("__TAURI_INTERNALS__" in window)) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500));
idle(preloadEditor);

// Right-click opens our menu where one exists and does nothing elsewhere. The browser's menu stays where
// it helps: text fields and the editor (spellcheck, paste) and selected text (copy).
document.addEventListener("contextmenu", (e) => {
  if (e.defaultPrevented) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest("input, textarea, select, [contenteditable='true'], .cm-editor")) return;
  if (window.getSelection()?.toString()) return;
  e.preventDefault();
});

routeExternalLinksInDesktop();
