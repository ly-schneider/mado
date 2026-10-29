import type { Backlink } from "@mado/contract";
import { cn } from "@mado/ui";
import { Link } from "@tanstack/react-router";
import { ChevronRight, CircleCheck, FileText } from "lucide-react";
import type { Heading } from "../editor/markdown";
import { plainInline } from "../editor/markdown";

/** "On this page": the title plus every heading; the active section gets the accent bar. */
export function Outline({
  title,
  headings,
  active,
  onJump,
  className,
}: {
  title: string;
  headings: Heading[];
  active: number;
  onJump: (index: number) => void;
  className?: string;
}) {
  const minLevel = Math.min(...headings.map((h) => h.level), 6);
  const items = [{ text: title || "Untitled", level: minLevel }, ...headings];
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="mb-1 text-label font-medium text-ink-subtle">On this page</div>
      <div className="flex flex-col">
        {items.map((h, i) => {
          const isActive = active === i - 1;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onJump(i - 1)}
              className={cn(
                "flex h-[26px] min-w-0 items-center border-l border-edge text-left text-label outline-none hover:text-ink",
                isActive ? "border-l-2 border-accent text-ink" : "text-ink-subtle",
              )}
              style={{ paddingLeft: (isActive ? 11 : 12) + Math.max(0, h.level - minLevel) * 12 }}
            >
              <span className="truncate">{plainInline(h.text)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function backlinkTarget(b: Backlink, ws: string) {
  return b.type === "task"
    ? ({ to: "/$ws/t/$taskKey", params: { ws, taskKey: b.key ?? b.id } } as const)
    : ({ to: "/$ws/wiki/$docId", params: { ws, docId: b.id } } as const);
}

export function Backlinks({ backlinks, ws }: { backlinks: Backlink[]; ws: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="mb-1 flex items-center gap-1.5 text-label">
        <span className="font-medium text-ink-subtle">Linked from</span>
        <span className="text-ink-faint">{backlinks.length}</span>
      </div>
      {backlinks.length === 0 && <div className="py-1.5 text-label text-ink-faint">No links to this page yet.</div>}
      {backlinks.map((b) => (
        <Link key={`${b.type}${b.id}`} {...backlinkTarget(b, ws)} className="group flex flex-col gap-0.5 rounded-md py-1.5 outline-none">
          <span className="flex min-w-0 items-center gap-2 text-label font-medium text-ink group-hover:underline group-hover:decoration-edge group-hover:underline-offset-4">
            {b.type === "task" ? <CircleCheck className="size-4 shrink-0 text-ink-subtle" /> : <FileText className="size-4 shrink-0 text-ink-subtle" />}
            <span className="truncate">{b.type === "task" ? (b.key ?? b.title) : b.title}</span>
          </span>
          <span className="truncate text-label text-ink-subtle">{b.type === "task" ? b.title : b.subtitle}</span>
        </Link>
      ))}
    </div>
  );
}

export function PageStats({ revisions, words, shared, onHistory }: { revisions: number; words: number; shared: string; onHistory?: () => void }) {
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-center gap-2">
      <span className="w-[72px] text-ink-subtle">{label}</span>
      <span className="text-ink-muted">{value}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-1.5 text-label">
      <div className="font-medium text-ink-subtle">Page</div>
      {row(
        "Revisions",
        onHistory ? (
          <button type="button" onClick={onHistory} className="outline-none hover:text-ink">
            {revisions}
          </button>
        ) : (
          revisions
        ),
      )}
      {row("Words", words.toLocaleString("en"))}
      {row("Shared", shared)}
    </div>
  );
}

/** Phone: backlinks as a card of chevron rows at the end of the page (iOS 04). */
export function LinkedFromCard({ backlinks, ws }: { backlinks: Backlink[]; ws: string }) {
  if (backlinks.length === 0) return null;
  return (
    <div className="mt-8 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 px-1 text-label">
        <span className="font-medium text-ink-subtle">Linked from</span>
        <span className="text-ink-faint">{backlinks.length}</span>
      </div>
      <div className="divide-y divide-edge overflow-hidden rounded-xl border border-edge bg-panel">
        {backlinks.map((b) => (
          <Link key={`${b.type}${b.id}`} {...backlinkTarget(b, ws)} className="flex min-h-11 items-center gap-3 px-3.5 py-2.5 active:bg-state-active">
            {b.type === "task" ? <CircleCheck className="size-4 shrink-0 text-ink-subtle" /> : <FileText className="size-4 shrink-0 text-ink-subtle" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">{b.title}</span>
              <span className="block truncate text-label text-ink-subtle">{b.type === "task" ? b.key : b.subtitle}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-ink-faint" />
          </Link>
        ))}
      </div>
    </div>
  );
}
