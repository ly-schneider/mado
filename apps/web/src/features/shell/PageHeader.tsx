import { cn, IconButton, Menu } from "@mado/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Bell, ChevronDown, ChevronLeft, ChevronRight, Moon, PanelLeft, Settings2, Sun } from "@mado/ui/fluent";
import { Fragment, type ReactNode } from "react";
import { orpc } from "../../lib/orpc";
import { isTauri } from "../../lib/platform";
import { toggleTheme, useTheme } from "../../lib/theme";
import { setUi, useUi } from "../../lib/ui";
import { useWorkspace, useWorkspaces, workspaceInitials } from "../../lib/workspace";

export interface Crumb {
  label: ReactNode;
  to?: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
}

/**
 * The 52px header from the web and desktop designs: breadcrumb left, the 2–3 main actions right.
 * On phones it becomes the small nav row: back chevron or workspace switcher left, icon actions
 * right (the inbox bell unless the screen passes its own). Screens render <MobileTitle> below it.
 */
export function PageHeader({
  crumbs,
  children,
  center,
  className,
  mobileBack,
  mobileLabel,
  mobileActions,
  mobile = true,
}: {
  crumbs: Crumb[];
  children?: ReactNode;
  center?: ReactNode;
  className?: string;
  /** Show a back chevron on phones instead of the workspace switcher. */
  mobileBack?: boolean;
  /** Label of the phone workspace switcher (e.g. the project); defaults to the workspace name. */
  mobileLabel?: ReactNode;
  /** `undefined` shows the inbox bell, `null` shows nothing. */
  mobileActions?: ReactNode;
  /** False when the screen draws its own phone nav row. */
  mobile?: boolean;
}) {
  const router = useRouter();
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  return (
    <>
      <header
        className={cn(
          "hidden h-[52px] shrink-0 items-center gap-3 border-b border-edge px-5 md:flex",
          isTauri && "drag-region",
          // Clear the macOS traffic lights, which sit over the content once the sidebar is hidden.
          isTauri && !sidebarOpen && "pl-[84px]",
          className,
        )}
      >
        {!sidebarOpen && (
          <IconButton label="Show sidebar (⌘\)" size="sm" className="no-drag -ml-1.5" onClick={() => setUi({ sidebarOpen: true })}>
            <PanelLeft />
          </IconButton>
        )}
        <nav className="no-drag flex min-w-0 items-center gap-2 text-sm" aria-label="Breadcrumb">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <Fragment key={i}>
                {i > 0 && <ChevronRight className="size-4 shrink-0 text-ink-faint" />}
                {c.to && !last ? (
                  <Link
                    // biome-ignore lint/suspicious/noExplicitAny: typed by callers
                    to={c.to as any}
                    params={c.params as any}
                    search={c.search as any}
                    className="truncate text-ink-subtle hover:text-ink"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span className={cn("truncate", last ? "font-medium text-ink" : "text-ink-subtle")}>{c.label}</span>
                )}
              </Fragment>
            );
          })}
        </nav>
        {center && <div className="no-drag">{center}</div>}
        <div className="no-drag ml-auto flex items-center gap-3">{children}</div>
      </header>
      {mobile && (
        <header className="relative flex h-[52px] shrink-0 items-center gap-2 px-4 pt-safe md:hidden">
          {mobileBack ? (
            <IconButton label="Back" size="touch" variant="secondary" className="rounded-full" onClick={() => router.history.back()}>
              <ChevronLeft className="size-[18px]" />
            </IconButton>
          ) : (
            <WorkspaceSwitcher label={mobileLabel} />
          )}
          {mobileBack && crumbs.length > 1 && <MobileNavTitle>{crumbs[crumbs.length - 2]!.label}</MobileNavTitle>}
          <div className="min-w-0 flex-1" />
          <div className="flex items-center gap-2">{mobileActions === undefined ? <InboxBell /> : mobileActions}</div>
        </header>
      )}
    </>
  );
}

/** Parent title centred in a phone nav row, clear of the buttons either side. */
export function MobileNavTitle({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-24 bottom-0 top-[env(safe-area-inset-top)] flex items-center justify-center">
      <span className="flex min-w-0 items-center truncate text-sm font-medium text-ink-subtle [&_*]:truncate">{children}</span>
    </div>
  );
}

/** Phone counterpart of the sidebar workspace menu. */
function WorkspaceSwitcher({ label }: { label?: ReactNode }) {
  const ws = useWorkspace();
  const { data: workspaces = [] } = useWorkspaces();
  const navigate = useNavigate();
  const { resolved } = useTheme();
  return (
    <Menu.Root>
      <Menu.Trigger className="flex h-9 min-w-0 items-center gap-2 rounded-full border border-edge bg-raised pl-1.5 pr-3 text-sm font-medium text-ink outline-none">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-[10px] font-medium text-on-ink">{workspaceInitials(ws.name)}</span>
        <span className="truncate">{label ?? ws.name}</span>
        <ChevronDown className="size-3.5 shrink-0 text-ink-subtle" />
      </Menu.Trigger>
      <Menu.Popup align="start" className="w-64">
        <Menu.Label>Workspaces</Menu.Label>
        {workspaces.map((w) => (
          <Menu.Item key={w.id} selected={w.id === ws.id} onClick={() => navigate({ to: "/$ws/my-tasks", params: { ws: w.slug }, search: { tab: "assigned" } })}>
            {w.name}
          </Menu.Item>
        ))}
        <Menu.Separator />
        <Menu.Item icon={<Settings2 />} onClick={() => navigate({ to: "/$ws/settings", params: { ws: ws.slug } })}>
          Settings
        </Menu.Item>
        <Menu.Item icon={resolved === "dark" ? <Moon /> : <Sun />} onClick={toggleTheme}>
          Theme: {resolved}
        </Menu.Item>
      </Menu.Popup>
    </Menu.Root>
  );
}

function InboxBell() {
  const ws = useWorkspace();
  const { data: unread } = useQuery(orpc.inbox.unread.queryOptions());
  return (
    <Link to="/$ws/inbox" params={{ ws: ws.slug }} aria-label="Inbox" className="relative flex size-9 items-center justify-center rounded-full border border-edge bg-raised text-ink-muted">
      <Bell className="size-[18px]" />
      {!!unread?.count && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent" />}
    </Link>
  );
}

/** iOS large title with an optional one-line count. */
export function MobileTitle({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="px-4 pb-3 pt-2 md:hidden">
      <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.021em] text-ink">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-ink-subtle">{subtitle}</p>}
    </div>
  );
}
