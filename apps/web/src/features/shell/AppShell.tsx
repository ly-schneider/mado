import { cn, Spinner } from "@mado/ui";
import { Link, Navigate, Outlet, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { BookOpen, Briefcase, CircleCheck, Plus, Search } from "@mado/ui/fluent";
import { useEffect, useState } from "react";
import { isTauri } from "../../lib/platform";
import { useCommands } from "../../lib/shortcuts";
import { setAccent, setTheme, toggleTheme } from "../../lib/theme";
import { openCapture, openPalette, setUi, useUi } from "../../lib/ui";
import { useMe, useWorkspaces } from "../../lib/workspace";
import { DesktopBridge } from "../desktop/DesktopBridge";
import { CommandPalette } from "../palette/CommandPalette";
import { QuickCapture } from "../tasks/QuickCapture";
import { Sidebar } from "./Sidebar";

/**
 * Authenticated layout for /$ws/*. Desktop: 240px sidebar + main. Phone: full-bleed main + floating
 * tab bar with the capture button (iOS PWA designs).
 */
export function AppShell() {
  const { ws: slug } = useParams({ from: "/$ws" });
  const me = useMe();
  const workspaces = useWorkspaces();
  const navigate = useNavigate();
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const path = useRouterState({ select: (s) => s.location.pathname });
  // Captured once: by the time the redirect re-renders this shell, the location already says /login.
  const [requested] = useState(() => location.pathname + location.search);
  const ws = workspaces.data?.find((w) => w.slug === slug);

  useEffect(() => {
    if (ws) localStorage.setItem("mado.lastWorkspace", ws.slug);
  }, [ws]);

  // Theme and accent live on the account; apply them when this device signs in or they change elsewhere.
  useEffect(() => {
    if (!me.data) return;
    setTheme(me.data.theme);
    setAccent(me.data.accent);
  }, [me.data?.theme, me.data?.accent]);

  useCommands(
    ws
      ? [
          { id: "palette", title: "Search or run a command", keys: "$mod+k", hint: "⌘K", group: "Actions", global: true, run: () => openPalette() },
          { id: "search.slash", title: "Search", keys: "/", group: "Actions", run: () => openPalette() },
          { id: "create.task", title: "Create task", subtitle: `in ${ws.projects[0]?.name ?? ws.name}`, keys: "c", hint: "C", group: "Actions", run: () => openCapture("task") },
          { id: "create.lead", title: "Create lead", keys: "l", hint: "L", group: "Actions", run: () => openCapture("lead") },
          { id: "go.inbox", title: "Go to inbox", keys: "g i", hint: "G then I", group: "Navigation", run: () => navigate({ to: "/$ws/inbox", params: { ws: ws.slug } }) },
          {
            id: "go.mine",
            title: "Go to my tasks",
            keys: "g m",
            hint: "G then M",
            group: "Navigation",
            run: () => navigate({ to: "/$ws/my-tasks", params: { ws: ws.slug }, search: { tab: "assigned" } }),
          },
          {
            id: "go.board",
            title: "Go to board",
            keys: "g b",
            hint: "G then B",
            group: "Navigation",
            run: () => navigate({ to: "/$ws/p/$key/tasks", params: { ws: ws.slug, key: ws.projects[0]?.key ?? "" }, search: { view: "board" } }),
          },
          {
            id: "go.list",
            title: "Go to task list",
            keys: "g l",
            hint: "G then L",
            group: "Navigation",
            run: () => navigate({ to: "/$ws/p/$key/tasks", params: { ws: ws.slug, key: ws.projects[0]?.key ?? "" }, search: { view: "list" } }),
          },
          { id: "go.wiki", title: "Go to wiki", keys: "g w", hint: "G then W", group: "Navigation", run: () => navigate({ to: "/$ws/wiki", params: { ws: ws.slug } }) },
          {
            id: "go.leads",
            title: "Go to leads",
            keys: "g c",
            hint: "G then C",
            group: "Navigation",
            run: () => navigate({ to: "/$ws/p/$key/leads", params: { ws: ws.slug, key: ws.projects[0]?.key ?? "" }, search: { view: "list" } }),
          },
          { id: "go.trash", title: "Go to trash", keys: "g t", hint: "G then T", group: "Navigation", run: () => navigate({ to: "/$ws/trash", params: { ws: ws.slug } }) },
          {
            id: "go.agents",
            title: "Connected agents",
            keys: "g a",
            hint: "G then A",
            group: "Settings",
            run: () => navigate({ to: "/$ws/settings/$section", params: { ws: ws.slug, section: "agents" } }),
          },
          {
            id: "go.settings",
            title: "Settings",
            keys: "g s",
            hint: "G then S",
            group: "Settings",
            run: () => navigate({ to: "/$ws/settings/$section", params: { ws: ws.slug, section: "account" } }),
          },
          { id: "toggle.theme", title: "Toggle dark/light theme", group: "Settings", run: toggleTheme },
          { id: "toggle.sidebar", title: "Toggle sidebar", keys: "$mod+Backslash", hint: "⌘\\", group: "Actions", global: true, run: () => setUi((s) => ({ sidebarOpen: !s.sidebarOpen })) },
        ]
      : [],
    [ws?.id, ws?.projects.length],
  );

  if (me.isPending || (me.data && workspaces.isPending)) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!me.data) return <Navigate to="/login" search={{ next: requested }} />;
  if (!ws) return <Navigate to="/" />;

  // Quick capture renders bare: in the Tauri ⌥Space window and as the PWA "New task" shortcut.
  if (path.endsWith("/capture")) {
    return (
      <>
        <Outlet />
        <DesktopBridge />
      </>
    );
  }

  return (
    <div className="flex h-full bg-page">
      <aside
        className={cn(
          "hidden w-60 shrink-0 border-r border-edge bg-panel md:block",
          !sidebarOpen && "md:hidden",
          isTauri && "bg-panel/95",
        )}
      >
        <Sidebar />
      </aside>
      <main className="relative flex min-w-0 flex-1 flex-col">
        <Outlet />
        <MobileTabBar slug={ws.slug} projectKey={ws.projects[0]?.key ?? ""} />
      </main>
      <CommandPalette />
      <QuickCapture />
      <DesktopBridge />
    </div>
  );
}

/** Floating tab bar and capture button from the iOS designs. Hidden from md up. */
function MobileTabBar({ slug, projectKey }: { slug: string; projectKey: string }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const hidden = /\/t\/|\/capture|\/settings\//.test(path);
  if (hidden) return null;
  const tab = (to: string, active: boolean, icon: React.ReactNode, label: string, params: Record<string, string> = { ws: slug }, search?: object) => (
    <Link
      // biome-ignore lint/suspicious/noExplicitAny: typed at call sites
      to={to as any}
      params={params as any}
      search={search as any}
      aria-label={label}
      className={cn(
        "flex size-11 items-center justify-center rounded-full text-ink-subtle [&_svg]:size-5",
        active && "bg-state-selected text-ink",
      )}
    >
      {icon}
    </Link>
  );
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 h-[calc(env(safe-area-inset-bottom)+112px)] bg-gradient-to-t from-page from-55% to-transparent md:hidden" />
      <div className="fixed inset-x-4 bottom-[max(env(safe-area-inset-bottom),12px)] z-30 flex items-center justify-between md:hidden">
        <div className="flex items-center gap-1 rounded-full border border-edge bg-overlay/90 p-1.5 backdrop-blur-xl">
          {tab("/$ws/my-tasks", path.endsWith("/my-tasks") || path.includes("/tasks"), <CircleCheck />, "Tasks", { ws: slug }, { tab: "assigned" })}
          {tab("/$ws/wiki", path.includes("/wiki"), <BookOpen />, "Wiki")}
          {tab("/$ws/p/$key/leads", path.includes("/leads"), <Briefcase />, "Leads", { ws: slug, key: projectKey }, { view: "list" })}
          {tab("/$ws/search", path.endsWith("/search"), <Search />, "Search")}
        </div>
        <button
          type="button"
          aria-label="Capture"
          onClick={() => openCapture("task")}
          className="flex size-14 items-center justify-center rounded-full bg-ink text-on-ink shadow-[0_8px_24px_-6px_rgb(0_0_0/0.5)] active:scale-95"
        >
          <Plus className="size-6" />
        </button>
      </div>
    </>
  );
}
