import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Navigate, Outlet, redirect } from "@tanstack/react-router";
import type { SettingsSection } from "./features/settings/SettingsPage";
import { AppShell } from "./features/shell/AppShell";
import { RootRedirect } from "./features/shell/RootRedirect";
import { CapturePage } from "./features/tasks/CapturePage";
import { MyTasksPage } from "./features/tasks/MyTasksPage";
import { TaskPage } from "./features/tasks/TaskPage";
import { TasksPage } from "./features/tasks/TasksPage";
import { DesktopGate } from "./features/desktop/ServerSetup";
import { Toaster } from "./lib/toast";

const rootRoute = createRootRoute({
  component: () => (
    <DesktopGate>
      <Outlet />
      <Toaster />
    </DesktopGate>
  ),
});

const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: RootRedirect });
const setupRoute = createRoute({ getParentRoute: () => rootRoute, path: "/setup", component: lazyRouteComponent(() => import("./features/auth/SetupPage"), "SetupPage") });
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (s: Record<string, unknown>): { next?: string } => ({ next: str(s.next) }),
  component: lazyRouteComponent(() => import("./features/auth/LoginPage"), "LoginPage"),
});
const onboardingRoute = createRoute({ getParentRoute: () => rootRoute, path: "/onboarding", component: lazyRouteComponent(() => import("./features/auth/OnboardingPage"), "OnboardingPage") });
const inviteRoute = createRoute({ getParentRoute: () => rootRoute, path: "/invite/$token", component: lazyRouteComponent(() => import("./features/auth/InvitePage"), "InvitePage") });
const guestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s/$token",
  validateSearch: (s: Record<string, unknown>): { doc?: string } => ({ doc: str(s.doc) }),
  component: lazyRouteComponent(() => import("./features/wiki/GuestPage"), "GuestPage"),
});
const consentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/oauth/consent",
  validateSearch: (s: Record<string, unknown>): { request?: string } => ({ request: str(s.request) }),
  component: lazyRouteComponent(() => import("./features/agents/ConsentPage"), "ConsentPage"),
});

/** Everything inside a workspace: /$ws/... where $ws is the workspace slug. */
export const wsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/$ws", component: AppShell });

const wsIndex = createRoute({
  getParentRoute: () => wsRoute,
  path: "/",
  component: () => <Navigate from="/$ws" to="/$ws/my-tasks" />,
});
const inboxRoute = createRoute({
  getParentRoute: () => wsRoute,
  path: "/inbox",
  validateSearch: (s: Record<string, unknown>): { n?: string } => ({ n: str(s.n) }),
  component: lazyRouteComponent(() => import("./features/inbox/InboxPage"), "InboxPage"),
});
const myTasksRoute = createRoute({
  getParentRoute: () => wsRoute,
  path: "/my-tasks",
  validateSearch: (s: Record<string, unknown>): { tab?: "assigned" | "created" | "agents"; task?: string } => ({
    tab: ["created", "agents"].includes(s.tab as string) ? (s.tab as "created" | "agents") : undefined,
    task: str(s.task),
  }),
  component: MyTasksPage,
});
export type TaskView = "board" | "list";
const tasksRoute = createRoute({
  getParentRoute: () => wsRoute,
  path: "/p/$key/tasks",
  validateSearch: (s: Record<string, unknown>): { view?: TaskView; status?: string; labels?: string; epic?: string; assignee?: string } => ({
    status: str(s.status),
    view: s.view === "list" ? "list" : undefined,
    labels: str(s.labels),
    epic: str(s.epic),
    assignee: str(s.assignee),
  }),
  component: TasksPage,
});
const leadsRoute = createRoute({
  getParentRoute: () => wsRoute,
  path: "/p/$key/leads",
  validateSearch: (s: Record<string, unknown>): { view?: "list" | "pipeline"; lead?: string } => ({
    view: s.view === "pipeline" ? "pipeline" : undefined,
    lead: str(s.lead),
  }),
  component: lazyRouteComponent(() => import("./features/leads/LeadsPage"), "LeadsPage"),
});
const taskRoute = createRoute({ getParentRoute: () => wsRoute, path: "/t/$taskKey", component: TaskPage });
const wikiRoute = createRoute({
  getParentRoute: () => wsRoute,
  path: "/wiki",
  validateSearch: (s: Record<string, unknown>): { project?: string } => ({ project: str(s.project) }),
  component: lazyRouteComponent(() => import("./features/wiki/WikiIndexPage"), "WikiIndexPage"),
});
const docRoute = createRoute({
  getParentRoute: () => wsRoute,
  path: "/wiki/$docId",
  validateSearch: (s: Record<string, unknown>): { history?: boolean; rev?: string } => ({ history: s.history === true || s.history === "1" || s.history === 1 ? true : undefined, rev: str(s.rev) }),
  component: lazyRouteComponent(() => import("./features/wiki/DocPage"), "DocPage"),
});
const trashRoute = createRoute({ getParentRoute: () => wsRoute, path: "/trash", component: lazyRouteComponent(() => import("./features/trash/TrashPage"), "TrashPage") });
const searchRoute = createRoute({
  getParentRoute: () => wsRoute,
  path: "/search",
  validateSearch: (s: Record<string, unknown>): { q?: string } => ({ q: str(s.q) }),
  component: lazyRouteComponent(() => import("./features/search/SearchPage"), "SearchPage"),
});
const captureRoute = createRoute({
  getParentRoute: () => wsRoute,
  path: "/capture",
  validateSearch: (s: Record<string, unknown>): { kind?: "task" | "note" | "lead" } => ({ kind: ["note", "lead"].includes(s.kind as string) ? (s.kind as "note" | "lead") : undefined }),
  component: CapturePage,
});
const settingsRoute = createRoute({
  getParentRoute: () => wsRoute,
  path: "/settings/$section",
  validateSearch: (s: Record<string, unknown>): { id?: string } => ({ id: str(s.id) }),
  component: lazyRouteComponent(() =>
    import("./features/settings/SettingsPage").then((m) => ({
      default: () => {
        const { section } = settingsRoute.useParams();
        return <m.SettingsPage section={section as SettingsSection} />;
      },
    })),
  ),
});
const settingsIndex = createRoute({
  getParentRoute: () => wsRoute,
  path: "/settings",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/$ws/settings/$section", params: { ws: params.ws, section: "account" } });
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  setupRoute,
  loginRoute,
  onboardingRoute,
  inviteRoute,
  guestRoute,
  consentRoute,
  wsRoute.addChildren([
    wsIndex,
    inboxRoute,
    myTasksRoute,
    tasksRoute,
    leadsRoute,
    taskRoute,
    wikiRoute,
    docRoute,
    trashRoute,
    searchRoute,
    captureRoute,
    settingsIndex,
    settingsRoute,
  ]),
]);

export const router = createRouter({ routeTree, defaultPreload: "intent", defaultPreloadDelay: 30, scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
