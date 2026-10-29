import { isTauri } from "./platform";

/** Web links leave the app: a new tab on the web, the default browser in the desktop app. */
export async function openExternal(url: string) {
  if (!isTauri) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

/**
 * The desktop webview won't open target=_blank or mailto: on its own, so plain anchors in rendered
 * Markdown, settings and lead drafts are routed through the opener.
 */
export function routeExternalLinksInDesktop() {
  if (!isTauri) return;
  document.addEventListener(
    "click",
    (e) => {
      const a = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a[href]");
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      if (!/^(https?:|mailto:)/i.test(href)) return;
      e.preventDefault();
      void openExternal(href);
    },
    true,
  );
}
