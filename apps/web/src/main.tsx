import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { preloadEditor } from "./features/editor/MarkdownEditor";
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
