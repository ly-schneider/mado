import type { DocNode, Workspace } from "@mado/contract";
import { cn, IconButton, Menu } from "@mado/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  Briefcase,
  ChevronsUpDown,
  CircleCheck,
  FileText,
  Folder,
  FolderOpen,
  Inbox,
  LogOut,
  Moon,
  PanelLeft,
  Plus,
  Search,
  Settings2,
  SquareKanban,
  SquarePen,
  Sun,
} from "@mado/ui/fluent";
import { type ReactNode, useMemo, useState } from "react";
import { client, orpc, queryClient } from "../../lib/orpc";
import { isTauri } from "../../lib/platform";
import { toggleTheme, useTheme } from "../../lib/theme";
import { openCapture, openPalette, setUi } from "../../lib/ui";
import { useMe, useWorkspace, useWorkspaces, workspaceInitials } from "../../lib/workspace";

function NavItem({
  to,
  params,
  search,
  icon,
  children,
  count,
  indent = 0,
  active,
  onClick,
}: {
  to?: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
  icon: ReactNode;
  children: ReactNode;
  count?: number | string;
  indent?: number;
  active?: boolean;
  onClick?: () => void;
}) {
  const cls = cn(
    "flex h-8 w-full items-center gap-2 rounded-md pr-2 text-sm font-medium text-ink-muted outline-none hover:bg-state-hover active:bg-state-active [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-subtle",
    active && "bg-state-selected text-ink hover:bg-state-selected [&_svg]:text-ink",
  );
  const style = { paddingLeft: 8 + indent * 16 };
  const inner = (
    <>
      {icon}
      <span className="flex-1 truncate text-left">{children}</span>
      {count !== undefined && count !== 0 && <span className="text-label font-normal text-ink-subtle">{count}</span>}
    </>
  );
  if (!to) {
    return (
      <button type="button" className={cls} style={style} onClick={onClick}>
        {inner}
      </button>
    );
  }
  return (
    // biome-ignore lint/suspicious/noExplicitAny: route paths are checked at the call sites
    <Link to={to as any} params={params as any} search={search as any} className={cls} style={style} onClick={onClick}>
      {inner}
    </Link>
  );
}

function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="group flex items-center gap-2 px-2 pb-1 pt-4 text-label font-medium">
      <div className="flex flex-1 items-center gap-2 truncate">{children}</div>
      {action && <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100">{action}</div>}
    </div>
  );
}

function usePath() {
  return useRouterState({ select: (s) => s.location.pathname });
}

function PageTree({ ws, onNavigate }: { ws: Workspace; onNavigate?: () => void }) {
  const path = usePath();
  const { data: tree = [] } = useQuery(orpc.doc.tree.queryOptions({ input: { workspaceId: ws.id } }));
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(`mado.tree.${ws.id}`) ?? "{}");
    } catch {
      return {};
    }
  });
  const children = useMemo(() => {
    const map = new Map<string | null, DocNode[]>();
    for (const n of tree) {
      const list = map.get(n.parentId) ?? [];
      list.push(n);
      map.set(n.parentId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
    return map;
  }, [tree]);

  const activeId = path.match(/\/wiki\/([0-9a-f-]{36})/)?.[1];
  // Keep the ancestors of the open page expanded.
  const ancestors = useMemo(() => {
    const set = new Set<string>();
    const byId = new Map(tree.map((n) => [n.id, n]));
    let cur = activeId ? byId.get(activeId) : undefined;
    while (cur?.parentId) {
      set.add(cur.parentId);
      cur = byId.get(cur.parentId);
    }
    return set;
  }, [tree, activeId]);

  const toggle = (id: string) => {
    const next = { ...open, [id]: !(open[id] ?? false) };
    setOpen(next);
    try {
      localStorage.setItem(`mado.tree.${ws.id}`, JSON.stringify(next));
    } catch {}
  };

  const render = (parentId: string | null, depth: number): ReactNode =>
    (children.get(parentId) ?? []).map((node) => {
      const isOpen = open[node.id] ?? ancestors.has(node.id);
      const icon = node.hasChildren ? isOpen ? <FolderOpen /> : <Folder /> : <FileText />;
      return (
        <div key={node.id}>
          <div className="group/page relative">
            <NavItem
              to="/$ws/wiki/$docId"
              params={{ ws: ws.slug, docId: node.id }}
              icon={
                node.hasChildren ? (
                  <span
                    role="button"
                    tabIndex={-1}
                    className="flex"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggle(node.id);
                    }}
                  >
                    {icon}
                  </span>
                ) : (
                  icon
                )
              }
              indent={depth}
              active={activeId === node.id}
              onClick={() => {
                if (node.hasChildren && !isOpen) toggle(node.id);
                onNavigate?.();
              }}
            >
              {node.title || "Untitled"}
            </NavItem>
          </div>
          {node.hasChildren && isOpen && render(node.id, depth + 1)}
        </div>
      );
    });

  return <>{render(null, 0)}</>;
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const ws = useWorkspace();
  const { data: workspaces = [] } = useWorkspaces();
  const { data: me } = useMe();
  const path = usePath();
  const navigate = useNavigate();
  const { resolved } = useTheme();
  const { data: unread } = useQuery(orpc.inbox.unread.queryOptions({ refetchInterval: 30_000 }));

  const createPage = async () => {
    const node = await client.doc.create({ workspaceId: ws.id, projectId: ws.projects[0]?.id ?? null, title: "Untitled" });
    await queryClient.invalidateQueries({ queryKey: orpc.doc.tree.key() });
    navigate({ to: "/$ws/wiki/$docId", params: { ws: ws.slug, docId: node.id } });
    onNavigate?.();
  };

  return (
    <nav className="flex h-full w-full flex-col gap-px overflow-hidden px-2 pb-3 pt-2" aria-label="Sidebar">
      {isTauri && (
        <div className="drag-region -mx-2 -mt-2 flex h-11 shrink-0 items-center justify-end px-3">
          <IconButton label="Toggle sidebar" size="sm" className="no-drag" onClick={() => setUi((s) => ({ sidebarOpen: !s.sidebarOpen }))}>
            <PanelLeft />
          </IconButton>
        </div>
      )}
      <div className="flex h-9 shrink-0 items-center gap-2 px-1">
        <Menu.Root>
          <Menu.Trigger className="flex h-8 min-w-0 items-center gap-2 rounded-md px-1 outline-none hover:bg-state-hover">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-ink text-[11px] font-medium leading-4 text-on-ink">
              {workspaceInitials(ws.name)}
            </span>
            <span className="truncate text-sm font-medium text-ink">{ws.name}</span>
            <ChevronsUpDown className="size-4 shrink-0 text-ink-subtle" />
          </Menu.Trigger>
          <Menu.Popup className="w-64">
            {me && (
              <div className="flex flex-col px-2 pb-1.5 pt-1 text-label leading-[18px]">
                <span className="truncate font-medium text-ink">{me.name}</span>
                <span className="truncate text-ink-subtle">{me.email}</span>
              </div>
            )}
            <Menu.Separator />
            <Menu.Label>Workspaces</Menu.Label>
            {workspaces.map((w) => (
              <Menu.Item
                key={w.id}
                selected={w.id === ws.id}
                icon={
                  <span className="flex size-4 items-center justify-center rounded-[4px] bg-ink text-[9px] font-medium text-on-ink">
                    {workspaceInitials(w.name)}
                  </span>
                }
                onClick={() => navigate({ to: "/$ws/my-tasks", params: { ws: w.slug }, search: { tab: "assigned" } })}
              >
                {w.name}
              </Menu.Item>
            ))}
            <Menu.Item icon={<Plus />} onClick={() => navigate({ to: "/onboarding" })}>
              Create workspace
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item icon={<Settings2 />} onClick={() => navigate({ to: "/$ws/settings/$section", params: { ws: ws.slug, section: "workspace" } })}>
              Workspace settings
            </Menu.Item>
            <Menu.Item icon={resolved === "dark" ? <Moon /> : <Sun />} onClick={toggleTheme}>
              Theme: {resolved}
            </Menu.Item>
            <Menu.Item
              icon={<LogOut />}
              onClick={async () => {
                await client.auth.logout();
                queryClient.clear();
                navigate({ to: "/login", search: { next: undefined } });
              }}
            >
              Log out
            </Menu.Item>
          </Menu.Popup>
        </Menu.Root>
        <div className="flex flex-1 items-center justify-end gap-0.5">
          <IconButton label="Search (⌘K)" size="sm" onClick={() => openPalette()}>
            <Search />
          </IconButton>
          <IconButton label="New task (C)" size="sm" onClick={() => openCapture("task")}>
            <SquarePen />
          </IconButton>
        </div>
      </div>

      <div className="h-1.5 shrink-0" />
      <div className="-mx-2 flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2">
        <NavItem to="/$ws/inbox" params={{ ws: ws.slug }} icon={<Inbox />} count={unread?.count} active={path.endsWith("/inbox")} onClick={onNavigate}>
          Inbox
        </NavItem>
        <NavItem
          to="/$ws/my-tasks"
          params={{ ws: ws.slug }}
          search={{ tab: "assigned" }}
          icon={<CircleCheck />}
          active={path.endsWith("/my-tasks")}
          onClick={onNavigate}
        >
          My tasks
        </NavItem>

        {ws.projects.map((p) => (
          <div key={p.id} className="flex flex-col gap-px">
            <SectionLabel>
              <span className="text-ink-subtle">{p.name}</span>
              <span className="text-ink-faint">{p.key}</span>
            </SectionLabel>
            <NavItem
              to="/$ws/p/$key/tasks"
              params={{ ws: ws.slug, key: p.key }}
              icon={<SquareKanban />}
              active={path.includes(`/p/${p.key}/tasks`) || path.includes(`/t/${p.key}-`)}
              onClick={onNavigate}
            >
              Tasks
            </NavItem>
            <NavItem
              to="/$ws/wiki"
              params={{ ws: ws.slug }}
              search={{ project: p.key }}
              icon={<BookOpen />}
              active={path.endsWith("/wiki")}
              onClick={onNavigate}
            >
              Wiki
            </NavItem>
            <NavItem
              to="/$ws/p/$key/leads"
              params={{ ws: ws.slug, key: p.key }}
              icon={<Briefcase />}
              active={path.includes(`/p/${p.key}/leads`)}
              onClick={onNavigate}
            >
              Leads
            </NavItem>
          </div>
        ))}

        <SectionLabel
          action={
            <IconButton label="New page" size="sm" className="-my-1 size-6" onClick={createPage}>
              <Plus />
            </IconButton>
          }
        >
          <span className="text-ink-subtle">Pages</span>
        </SectionLabel>
        <PageTree ws={ws} onNavigate={onNavigate} />
        <div className="h-4 shrink-0" />
      </div>

      <NavItem
        to="/$ws/settings/$section"
        params={{ ws: ws.slug, section: "account" }}
        icon={<Settings2 />}
        active={path.includes("/settings/") || path.endsWith("/trash")}
        onClick={onNavigate}
      >
        Settings
      </NavItem>
    </nav>
  );
}
