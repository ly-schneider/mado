import type { RevisionSummary, ShareLink } from "@mado/contract";
import { Avatar, Badge, cn, IconButton, Spinner } from "@mado/ui";
import { useQuery } from "@tanstack/react-query";
import { History, RotateCcw, X } from "lucide-react";
import { Fragment, type ReactNode, useMemo } from "react";
import { orpc } from "../../lib/orpc";
import { clock, dayGroup, shortDate } from "../../lib/time";
import { InlineMarkdown, MarkdownView } from "../editor/MarkdownView";
import { type DiffOp, diffLines } from "./diff";

function subtitle(r: RevisionSummary, links: Map<string, ShareLink>) {
  const parts: string[] = [];
  if (r.actor.type === "agent" && r.sessionId) parts.push(`session ${r.sessionId.slice(0, 4)}`);
  if (r.actor.type === "guest") {
    const link = links.get(r.actor.id);
    if (link) {
      parts.push(link.type === "edit" ? "Edit link" : "View link");
      if (link.hasPin) parts.push("PIN");
      if (link.revokedAt) parts.push("revoked");
      else if (link.expiresAt) parts.push(`expires ${shortDate(link.expiresAt)}`);
    }
  }
  if (r.current) parts.push("current");
  if (r.summary === "Created") parts.push("created the page");
  else if (r.summary && r.actor.type !== "guest") parts.push(r.summary);
  if (parts.length === 0) parts.push(`Revision ${r.number}`);
  return parts.join(" · ");
}

export function HistoryPanel({
  docId,
  workspaceId,
  selected,
  onSelect,
  onClose,
  className,
}: {
  docId: string;
  workspaceId: string;
  selected?: string;
  onSelect: (rev: RevisionSummary) => void;
  onClose: () => void;
  className?: string;
}) {
  const { data, isPending } = useQuery(orpc.revision.list.queryOptions({ input: { entityType: "doc", entityId: docId } }));
  const { data: shares = [] } = useQuery(orpc.share.list.queryOptions({ input: { workspaceId }, staleTime: 60_000 }));
  const links = useMemo(() => new Map(shares.map((s) => [s.id, s])), [shares]);
  const revisions = useMemo(() => [...(data ?? [])].sort((a, b) => b.number - a.number), [data]);
  const current = revisions.find((r) => r.current) ?? revisions[0];

  let lastGroup = "";
  return (
    <aside className={cn("flex w-80 shrink-0 flex-col border-l border-edge bg-page", className)} aria-label="History">
      <div className="flex h-12 shrink-0 items-center gap-2 pl-4 pr-2">
        <History className="size-4 text-ink-subtle" />
        <span className="text-sm font-semibold text-ink">History</span>
        <span className="text-sm text-ink-faint">{revisions.length || ""}</span>
        <IconButton label="Close history (H)" size="sm" className="ml-auto" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {isPending && (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        )}
        {revisions.map((r) => {
          const group = dayGroup(r.createdAt);
          const header = group !== lastGroup;
          lastGroup = group;
          const isSelected = selected ? selected === r.id : r.id === current?.id;
          return (
            <Fragment key={r.id}>
              {header && <div className="px-2 pb-1.5 pt-3 text-label font-medium text-ink-subtle">{group}</div>}
              <button
                type="button"
                onClick={() => onSelect(r)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left outline-none hover:bg-state-hover",
                  isSelected && "bg-state-selected hover:bg-state-selected",
                )}
              >
                <Avatar type={r.actor.type} initials={r.actor.initials} size="sm" className="mt-px" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{r.actor.name}</span>
                    {r.actor.type === "agent" && <Badge>agent</Badge>}
                    <span className="ml-auto shrink-0 text-label text-ink-subtle">{clock(r.createdAt)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-label text-ink-subtle">
                    <span className="truncate">{subtitle(r, links)}</span>
                    <span className="ml-auto shrink-0 tabular-nums">
                      {r.added > 0 && `+${r.added}`}
                      {r.added > 0 && r.removed > 0 && " "}
                      {r.removed > 0 && `−${r.removed}`}
                    </span>
                  </span>
                </span>
              </button>
            </Fragment>
          );
        })}
      </div>
      <div className="flex shrink-0 gap-2.5 border-t border-edge px-4 py-3.5 text-label text-ink-subtle">
        <RotateCcw className="mt-px size-4 shrink-0" />
        <span>Restoring adds a new revision on top. Nothing is overwritten.</span>
      </div>
    </aside>
  );
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;

type Segment = { kind: "code"; lang: string; lines: DiffOp[] } | { kind: "lines"; op: DiffOp["op"]; lines: string[] };

function segments(ops: DiffOp[]): Segment[] {
  const out: Segment[] = [];
  let code: Extract<Segment, { kind: "code" }> | null = null;
  for (const o of ops) {
    const fence = o.text.match(FENCE);
    if (code) {
      if (fence && !fence[2]) {
        code = null;
        continue;
      }
      code.lines.push(o);
      continue;
    }
    if (fence) {
      code = { kind: "code", lang: fence[2] ?? "", lines: [] };
      out.push(code);
      continue;
    }
    const last = out[out.length - 1];
    if (last?.kind === "lines" && last.op === o.op && o.op !== "eq") last.lines.push(o.text);
    else out.push({ kind: "lines", op: o.op, lines: [o.text] });
  }
  return out;
}

const Gutter = ({ op }: { op: DiffOp["op"] }) => (
  <span className="w-3 shrink-0 select-none text-center text-ink-subtle">{op === "add" ? "+" : op === "del" ? "−" : ""}</span>
);

function ProseLine({ text, workspaceId }: { text: string; workspaceId: string }) {
  const h = text.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
  if (h) {
    return (
      <div className={cn("flex gap-2 pt-3 font-semibold text-ink", h[1]!.length <= 2 ? "text-title" : "text-[17px] leading-[26px]")}>
        <span className="text-ink-faint">{h[1]}</span>
        <span>
          <InlineMarkdown text={h[2]!} workspaceId={workspaceId} />
        </span>
      </div>
    );
  }
  const li = text.match(/^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/);
  if (li) {
    return (
      <div className="flex gap-3" style={{ paddingLeft: li[1]!.length * 8 }}>
        <span className="w-[9px] shrink-0 text-center text-ink-subtle">{li[3] !== undefined ? (li[3] === " " ? "☐" : "☑") : /\d/.test(li[2]!) ? li[2] : "•"}</span>
        <span className="min-w-0 flex-1">
          <InlineMarkdown text={li[4]!} workspaceId={workspaceId} />
        </span>
      </div>
    );
  }
  const q = text.match(/^\s{0,3}>\s?(.*)$/);
  if (q) {
    return (
      <div className="rounded-md bg-panel px-3.5 py-1 text-sm">
        <InlineMarkdown text={q[1]!} workspaceId={workspaceId} />
      </div>
    );
  }
  return (
    <div>
      <InlineMarkdown text={text} workspaceId={workspaceId} />
    </div>
  );
}

/** Line-level diff in the reading layout: removed lines struck through, added lines on raised tone with a "+" gutter. */
export function DiffView({ ops, workspaceId }: { ops: DiffOp[]; workspaceId: string }) {
  const segs = useMemo(() => segments(ops), [ops]);
  return (
    <div className="flex flex-col gap-2 text-prose text-ink-muted">
      {segs.map((s, i) => {
        if (s.kind === "code") {
          return (
            <div key={i} className="my-2 overflow-hidden rounded-lg border border-edge bg-panel py-3">
              {s.lang && <div className="px-4 pb-1.5 text-kbd font-medium text-ink-faint">{s.lang}</div>}
              {s.lines.map((l, j) => (
                <div
                  key={j}
                  className={cn(
                    "flex gap-3 px-3 text-sm leading-[22px]",
                    l.op === "add" && "bg-raised text-ink",
                    l.op === "del" && "text-ink-faint line-through",
                  )}
                >
                  <Gutter op={l.op} />
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{l.text || " "}</span>
                </div>
              ))}
            </div>
          );
        }
        if (s.op === "eq") {
          const text = s.lines[0]!;
          return text.trim() ? <ProseLine key={i} text={text} workspaceId={workspaceId} /> : <div key={i} className="h-2" />;
        }
        const body: ReactNode = s.lines.map((l, j) => (l.trim() ? <ProseLine key={j} text={l} workspaceId={workspaceId} /> : <div key={j} className="h-2" />));
        return (
          <div
            key={i}
            className={cn("-mx-3 flex gap-3 rounded-lg px-3 py-2", s.op === "add" ? "bg-raised text-ink-muted" : "text-ink-faint line-through decoration-ink-faint")}
          >
            <Gutter op={s.op} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">{body}</div>
          </div>
        );
      })}
    </div>
  );
}

export function RevisionContent({
  revisionId,
  current,
  compare,
  workspaceId,
}: {
  revisionId: string;
  current: { title: string; content: string };
  compare: boolean;
  workspaceId: string;
}) {
  const { data: rev, isPending, error } = useQuery(orpc.revision.get.queryOptions({ input: { id: revisionId } }));
  const snap = (rev?.snapshot ?? {}) as { title?: string; content?: string };
  const ops = useMemo(() => (rev ? diffLines(snap.content ?? "", current.content) : []), [rev, snap.content, current.content]);
  if (isPending) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (error || !rev) return <div className="py-16 text-center text-sm text-ink-subtle">This revision could not be loaded.</div>;
  return (
    <div className="flex flex-col gap-4">
      {compare && (
        <div className="flex items-center gap-4 text-label text-ink-subtle">
          <span className="flex items-center gap-1.5">
            <span className="flex size-4 items-center justify-center rounded-sm border border-edge bg-raised text-kbd">+</span>
            added since rev {rev.number}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="flex size-4 items-center justify-center rounded-sm border border-edge text-kbd">−</span>
            removed
          </span>
        </div>
      )}
      <h1 className="text-display text-ink">{snap.title || "Untitled"}</h1>
      {compare ? <DiffView ops={ops} workspaceId={workspaceId} /> : <MarkdownView markdown={snap.content ?? ""} workspaceId={workspaceId} />}
    </div>
  );
}
