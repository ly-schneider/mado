import { cn } from "@mado/ui";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { Bot, Brain, Building2, ChevronRight, FolderKanban, History, Link2, Monitor, Palette, User, Users } from "lucide-react";
import type { ReactNode } from "react";
import { isTauri } from "../../lib/platform";
import { useCommands } from "../../lib/shortcuts";
import { useWorkspace } from "../../lib/workspace";
import { ConnectedAgents } from "../agents/ConnectedAgents";
import { MobileTitle, PageHeader } from "../shell/PageHeader";
import { AccountSection, AppearanceSection, DesktopSection } from "./AccountSections";
import { AiSection } from "./AiSection";
import { ProjectsSection } from "./ProjectsSection";
import { useIsPhone } from "./shared";
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
  id: Exclude<SettingsSection, "menu" | "tokens">;
  title: string;
  description: string;
  icon: ReactNode;
}

const GROUPS: { label: string; items: SectionMeta[] }[] = [
  {
    label: "You",
    items: [
      { id: "account", title: "Account", description: "Your name, email and password.", icon: <User /> },
      { id: "appearance", title: "Appearance", description: "Theme and accent for this device and your account.", icon: <Palette /> },
      { id: "desktop", title: "Desktop app", description: "Server and shortcuts of the desktop app.", icon: <Monitor /> },
    ],
  },
  {
    label: "Workspace",
    items: [
      { id: "workspace", title: "Workspace", description: "Name and ownership of this workspace.", icon: <Building2 /> },
      { id: "members", title: "Members", description: "People in this workspace and pending invites.", icon: <Users /> },
      { id: "projects", title: "Projects", description: "Keys, labels and Git repositories per project.", icon: <FolderKanban /> },
      { id: "sharing", title: "Share links", description: "Every guest link to a wiki page in this workspace.", icon: <Link2 /> },
      { id: "audit", title: "Audit log", description: "Every write in this workspace, by people and agents.", icon: <History /> },
    ],
  },
  {
    label: "Agents",
    items: [
      { id: "agents", title: "Connected agents", description: "", icon: <Bot /> },
      { id: "ai", title: "AI", description: "The built-in assistant runs on your own OpenRouter key.", icon: <Brain /> },
    ],
  },
];

const visible = (s: SectionMeta) => s.id !== "desktop" || isTauri;
const ALL = GROUPS.flatMap((g) => g.items).filter(visible);

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

  const crumbs = [{ label: "Settings", to: "/$ws/settings/$section", params: { ws: ws.slug, section: phone ? "menu" : "account" } }, { label: meta.title }];

  if (meta.id === "agents") {
    return (
      <>
        <PageHeader crumbs={crumbs} mobileBack />
        <div className="flex min-h-0 flex-1">
          <SettingsNav current={meta.id} className="2xl:flex" />
          <ConnectedAgents openToken={section === "tokens"} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader crumbs={crumbs} mobileBack />
      <div className="flex min-h-0 flex-1">
        <SettingsNav current={meta.id} className="lg:flex" />
        <div className="min-w-0 flex-1 overflow-y-auto">
          <MobileTitle title={meta.title} subtitle={meta.description} />
          <div className="mx-auto flex max-w-[720px] flex-col gap-8 px-4 pb-32 md:px-8 md:pb-16 md:pt-8">
            <div className="hidden md:block">
              <h1 className="text-title text-ink">{meta.title}</h1>
              <p className="mt-1 text-sm text-ink-muted">{meta.description}</p>
            </div>
            <SectionBody id={meta.id} />
          </div>
        </div>
      </div>
    </>
  );
}

function SectionBody({ id }: { id: SectionMeta["id"] }) {
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
function SettingsNav({ current, className }: { current: string; className?: string }) {
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
                to="/$ws/settings/$section"
                params={{ ws: ws.slug, section: s.id }}
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
      <PageHeader crumbs={[{ label: ws.name }, { label: "Settings" }]} mobileBack />
      <div className="min-h-0 flex-1 overflow-y-auto pb-32">
        <MobileTitle title="Settings" subtitle={ws.name} />
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
                      to="/$ws/settings/$section"
                      params={{ ws: ws.slug, section: s.id }}
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
