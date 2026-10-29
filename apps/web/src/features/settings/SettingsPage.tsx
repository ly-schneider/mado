import { cn } from "@mado/ui";
import { Link, Navigate, useNavigate, useSearch } from "@tanstack/react-router";
import { Bot, Brain, Building2, ChevronRight, FolderKanban, History, Link2, Monitor, Palette, Trash2, User, Users } from "@mado/ui/fluent";
import { type ReactNode, useState } from "react";
import { isTauri } from "../../lib/platform";
import { useCommands } from "../../lib/shortcuts";
import { useWorkspace } from "../../lib/workspace";
import { ConnectedAgents } from "../agents/ConnectedAgents";
import { type Crumb, PageHeader } from "../shell/PageHeader";
import { AccountSection, AppearanceSection, DesktopSection } from "./AccountSections";
import { AiSection } from "./AiSection";
import { ProjectsSection } from "./ProjectsSection";
import { TitleSlotProvider, useIsPhone } from "./shared";
import { AuditSection, MembersSection, SharingSection, WorkspaceSection } from "./WorkspaceSections";

export type SettingsSection =
  | "menu"
  | "account"
  | "appearance"
  | "workspace"
  | "members"
  | "projects"
  | "agents"
  | "tokens"
  | "ai"
  | "sharing"
  | "audit"
  | "desktop";

interface SectionMeta {
  /** "trash" is its own route, listed here because the sidebar no longer links it. */
  id: Exclude<SettingsSection, "menu" | "tokens"> | "trash";
  title: string;
  icon: ReactNode;
}

const GROUPS: { label: string; items: SectionMeta[] }[] = [
  {
    label: "You",
    items: [
      { id: "account", title: "Account", icon: <User /> },
      { id: "appearance", title: "Appearance", icon: <Palette /> },
      { id: "desktop", title: "Desktop app", icon: <Monitor /> },
    ],
  },
  {
    label: "Workspace",
    items: [
      { id: "workspace", title: "Workspace", icon: <Building2 /> },
      { id: "members", title: "Members", icon: <Users /> },
      { id: "projects", title: "Projects", icon: <FolderKanban /> },
      { id: "sharing", title: "Share links", icon: <Link2 /> },
      { id: "audit", title: "Audit log", icon: <History /> },
      { id: "trash", title: "Trash", icon: <Trash2 /> },
    ],
  },
  {
    label: "Agents",
    items: [
      { id: "agents", title: "Connected agents", icon: <Bot /> },
      { id: "ai", title: "AI", icon: <Brain /> },
    ],
  },
];

const visible = (s: SectionMeta) => s.id !== "desktop" || isTauri;
type SectionPage = SectionMeta & { id: Exclude<SectionMeta["id"], "trash"> };
const ALL = GROUPS.flatMap((g) => g.items).filter((s): s is SectionPage => visible(s) && s.id !== "trash");

function itemLink(ws: string, id: SectionMeta["id"]) {
  return id === "trash"
    ? ({ to: "/$ws/trash", params: { ws } } as const)
    : ({ to: "/$ws/settings/$section", params: { ws, section: id } } as const);
}

export function SettingsPage({ section }: { section: SettingsSection }) {
  const ws = useWorkspace();
  const phone = useIsPhone();
  const navigate = useNavigate();
  const id = section === "tokens" ? "agents" : section;
  const meta = ALL.find((s) => s.id === id);

  useCommands(
    ALL.filter((s) => s.id !== "agents").map((s) => ({
      id: `settings.${s.id}`,
      title: `Settings: ${s.title}`,
      group: "Settings" as const,
      icon: s.icon,
      run: () => navigate({ to: "/$ws/settings/$section", params: { ws: ws.slug, section: s.id } }),
    })),
    [ws.slug],
  );

  if (section === "menu") {
    if (!phone) return <Navigate to="/$ws/settings/$section" params={{ ws: ws.slug, section: "account" }} replace />;
    return <PhoneMenu />;
  }
  if (!meta) return <Navigate to="/$ws/settings/$section" params={{ ws: ws.slug, section: "account" }} replace />;

  const settingsCrumb: Crumb = { label: "Settings", to: "/$ws/settings/$section", params: { ws: ws.slug, section: phone ? "menu" : "account" } };
  const crumbs: Crumb[] = [settingsCrumb, { label: meta.title }];

  if (meta.id === "agents") {
    return (
      <>
        <PageHeader crumbs={crumbs} mobileBack mobileActions={null} />
        <div className="flex min-h-0 flex-1">
          <SettingsNav current={meta.id} className="2xl:flex" />
          <ConnectedAgents openToken={section === "tokens"} />
        </div>
      </>
    );
  }

  return <SectionScreen meta={meta} crumbs={crumbs} />;
}

function SectionScreen({ meta, crumbs }: { meta: SectionPage; crumbs: Crumb[] }) {
  const ws = useWorkspace();
  const { id } = useSearch({ strict: false }) as { id?: string };
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // A project's own page: Projects › Name, titled by the project. Breadcrumbs stay two levels deep.
  const project = meta.id === "projects" && id ? ws.projects.find((p) => p.id === id) : undefined;
  const title = project?.name ?? meta.title;
  const trail = project ? [{ label: "Projects", to: "/$ws/settings/$section", params: { ws: ws.slug, section: "projects" }, search: {} }, { label: project.name }] : crumbs;

  return (
    <>
      <PageHeader crumbs={trail} mobileBack mobileActions={null} />
      <div className="flex min-h-0 flex-1">
        <SettingsNav current={meta.id} className="lg:flex" />
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[720px] flex-col gap-8 px-4 pb-32 pt-2 md:px-8 md:pb-16 md:pt-8">
            <div className="flex min-h-9 items-center gap-3">
              <h1 className="min-w-0 flex-1 truncate text-display text-ink md:text-title">{title}</h1>
              <div ref={setSlot} className="flex shrink-0 items-center gap-2 empty:hidden" />
            </div>
            <TitleSlotProvider value={slot}>
              <SectionBody id={meta.id} />
            </TitleSlotProvider>
          </div>
        </div>
      </div>
    </>
  );
}

function SectionBody({ id }: { id: SectionPage["id"] }) {
  switch (id) {
    case "account":
      return <AccountSection />;
    case "appearance":
      return <AppearanceSection />;
    case "desktop":
      return <DesktopSection />;
    case "workspace":
      return <WorkspaceSection />;
    case "members":
      return <MembersSection />;
    case "projects":
      return <ProjectsSection />;
    case "sharing":
      return <SharingSection />;
    case "audit":
      return <AuditSection />;
    case "ai":
      return <AiSection />;
    case "agents":
      return null;
  }
}

/** Secondary settings navigation, a 200px column inside main. Hidden where the content needs the width. */
export function SettingsNav({ current, className }: { current: string; className?: string }) {
  const ws = useWorkspace();
  return (
    <nav aria-label="Settings" className={cn("hidden w-[200px] shrink-0 flex-col gap-px overflow-y-auto border-r border-edge px-2 py-3", className)}>
      {GROUPS.map((g, gi) => {
        const items = g.items.filter(visible);
        if (items.length === 0) return null;
        return (
          <div key={g.label} className="flex flex-col gap-px">
            <div className={cn("px-2 pb-1 text-label font-medium text-ink-subtle", gi > 0 ? "pt-4" : "pt-1")}>{g.label}</div>
            {items.map((s) => (
              <Link
                key={s.id}
                {...itemLink(ws.slug, s.id)}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-md px-2 text-sm font-medium text-ink-muted outline-none hover:bg-state-hover active:bg-state-active [&_svg]:size-4 [&_svg]:text-ink-subtle",
                  current === s.id && "bg-state-selected text-ink hover:bg-state-selected [&_svg]:text-ink",
                )}
              >
                {s.icon}
                <span className="truncate">{s.title}</span>
              </Link>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

function PhoneMenu() {
  const ws = useWorkspace();
  return (
    <>
      <PageHeader crumbs={[{ label: ws.name }, { label: "Settings" }]} mobileBack mobileActions={null} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-32">
        <h1 className="px-4 pb-4 pt-2 text-display text-ink">Settings</h1>
        <div className="flex flex-col gap-6 px-4">
          {GROUPS.map((g) => {
            const items = g.items.filter(visible);
            return (
              <div key={g.label} className="flex flex-col gap-2">
                <div className="px-1 text-label font-medium text-ink-subtle">{g.label}</div>
                <div className="divide-y divide-edge overflow-hidden rounded-xl border border-edge bg-panel">
                  {items.map((s) => (
                    <Link
                      key={s.id}
                      {...itemLink(ws.slug, s.id)}
                      className="flex h-12 items-center gap-3 px-4 text-touch text-ink active:bg-state-active [&>svg:first-child]:size-5 [&>svg:first-child]:text-ink-subtle"
                    >
                      {s.icon}
                      <span className="flex-1 truncate">{s.title}</span>
                      <ChevronRight className="size-4 text-ink-faint" />
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
