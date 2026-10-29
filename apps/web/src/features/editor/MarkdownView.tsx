import { Checkbox, cn } from "@mado/ui";
import { Bot, Check, Copy, Info, Lightbulb, TriangleAlert } from "@mado/ui/fluent";
import { Fragment, memo, type ReactNode, useMemo, useState } from "react";
import { findByTitle, type OpenLink, useLinkContext } from "./links";
import { linkLabel, toggleTaskAt } from "./markdown";

/**
 * Read-only Markdown rendering. A small block + inline parser instead of a Markdown library: task
 * detail and phone reading need to be instant, and the dialect is ours ([[links]], task keys).
 */
export interface MarkdownViewProps {
  markdown: string;
  className?: string;
  /** Workspace slug for building links. */
  wsSlug?: string;
  /** For [[Page]] resolution. */
  workspaceId?: string;
  /** Interactive "- [ ]" checkboxes; called with the updated markdown. */
  onToggleTask?: (markdown: string) => void;
  /** Overrides navigation for [[links]], task keys and URLs (guest pages). */
  onOpenLink?: OpenLink;
}

type Block =
  | { t: "p"; text: string }
  | { t: "h"; level: number; text: string; index: number | null }
  | { t: "code"; lang: string; code: string }
  | { t: "hr" }
  | { t: "quote"; kind: string | null; blocks: Block[] }
  | { t: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { t: "table"; head: string[]; rows: string[][]; align: ("left" | "center" | "right" | null)[] };

interface ListItem {
  text: string;
  task: { checked: boolean; index: number } | null;
  children: Block[];
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;

function parse(src: string, counter = { heading: 0, task: 0 }, nested = false): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  const isBlockStart = (l: string) =>
    /^\s{0,3}(#{1,6}\s|>|(`{3,}|~{3,})|([-*_])(\s*\3){2,}\s*$)/.test(l) || LIST.test(l) || /^\s*\|/.test(l);

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith(marker)) body.push(lines[i++]!);
      i++;
      blocks.push({ t: "code", lang: fence[2] ?? "", code: body.join("\n") });
      continue;
    }
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      blocks.push({ t: "h", level: h[1]!.length, text: h[2]!, index: nested ? null : counter.heading++ });
      i++;
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s{0,3}>\s?/, ""));
      let kind: string | null = null;
      const callout = body[0]?.match(/^\[!(\w+)\][+-]?\s?(.*)$/);
      if (callout) {
        kind = callout[1]!.toLowerCase();
        body[0] = callout[2]!;
      } else if (/^\*\*agents?:?\*\*/i.test(body[0] ?? "")) kind = "agents";
      blocks.push({ t: "quote", kind, blocks: parse(body.join("\n"), counter, true) });
      continue;
    }
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      const cells = (l: string) =>
        l
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const head = cells(line);
      const align = cells(lines[i + 1]!).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      blocks.push({ t: "table", head, rows, align });
      continue;
    }
    const li = line.match(LIST);
    if (li) {
      const baseIndent = li[1]!.length;
      const ordered = /\d/.test(li[2]!);
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = lines[i]!.match(LIST);
        if (!m || m[1]!.length !== baseIndent || /\d/.test(m[2]!) !== ordered) break;
        i++;
        const sub: string[] = [];
        while (i < lines.length) {
          const next = lines[i]!;
          if (!next.trim()) {
            const after = lines[i + 1];
            if (after && after.match(/^(\s*)/)![1]!.length > baseIndent) {
              sub.push("");
              i++;
              continue;
            }
            break;
          }
          const indent = next.match(/^(\s*)/)![1]!.length;
          if (indent > baseIndent) sub.push(next.slice(Math.min(indent, baseIndent + 2)));
          else if (!isBlockStart(next) && sub.length === 0 && !LIST.test(next)) {
            m[3] += ` ${next.trim()}`;
          } else break;
          i++;
        }
        const task = m[3]!.match(TASK);
        items.push({
          text: task ? task[2]! : m[3]!,
          task: task ? { checked: task[1] !== " ", index: counter.task++ } : null,
          children: sub.length ? parse(sub.join("\n"), counter, true) : [],
        });
      }
      blocks.push({ t: "list", ordered, start: ordered ? Number.parseInt(li[2]!, 10) : 1, items });
      continue;
    }
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i]!.trim() && !isBlockStart(lines[i]!)) para.push(lines[i++]!);
    blocks.push({ t: "p", text: para.map((l) => l.trim()).join("\n") });
  }
  return blocks;
}

const INLINE =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\[\[([^\]\n]+?)\]\]|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*\*(?=\S)([\s\S]+?)\*\*|__(?=\S)([\s\S]+?)__|~~(?=\S)([\s\S]+?)~~|\*(?=[^\s*])([^*]+?)\*|(?<![\p{L}\p{N}])_(?=\S)([^_]+?)_(?![\p{L}\p{N}])|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|\b([A-Z][A-Z0-9]{1,4})-(\d+)\b/gu;

interface Ctx {
  projectKeys: Set<string> | null;
  open: OpenLink;
  pageHref: (title: string) => string | undefined;
  taskHref: (key: string) => string | undefined;
  toggle?: (index: number) => void;
}

function linkProps(href: string | undefined, onOpen: (newTab: boolean) => void) {
  return {
    href: href ?? "#",
    onClick: (e: React.MouseEvent) => {
      if ((e.metaKey || e.ctrlKey) && href && href !== "#") return;
      e.preventDefault();
      onOpen(false);
    },
  };
}

function inline(text: string, ctx: Ctx, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  const re = new RegExp(INLINE.source, INLINE.flags);
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const k = `${key}.${n++}`;
    if (m.index > last) out.push(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[2] !== undefined) out.push(<code key={k} className="font-sans font-medium text-ink">{m[2]}</code>);
    else if (m[3] !== undefined) {
      const raw = m[3];
      out.push(
        <a key={k} className="text-accent" {...linkProps(ctx.pageHref(raw), () => ctx.open({ type: "page", title: raw }))}>
          {linkLabel(raw)}
        </a>,
      );
    } else if (m[4] !== undefined) {
      const href = m[5]!;
      out.push(
        <a key={k} href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline decoration-accent/40 underline-offset-[3px]">
          {inline(m[4], ctx, k)}
        </a>,
      );
    } else if (m[6] !== undefined || m[7] !== undefined)
      out.push(
        <strong key={k} className="font-semibold text-ink">
          {inline(m[6] ?? m[7]!, ctx, k)}
        </strong>,
      );
    else if (m[8] !== undefined)
      out.push(
        <s key={k} className="text-ink-faint">
          {inline(m[8], ctx, k)}
        </s>,
      );
    else if (m[9] !== undefined || m[10] !== undefined) out.push(<em key={k}>{inline(m[9] ?? m[10]!, ctx, k)}</em>);
    else if (m[11] !== undefined)
      out.push(
        <a key={k} href={m[11]} target="_blank" rel="noopener noreferrer" className="text-accent underline decoration-accent/40 underline-offset-[3px]">
          {m[11]}
        </a>,
      );
    else if (m[12] !== undefined && ctx.projectKeys?.has(m[12])) {
      const taskKey = m[0];
      out.push(
        <a key={k} className="whitespace-nowrap text-accent" {...linkProps(ctx.taskHref(taskKey), () => ctx.open({ type: "task", key: taskKey }))}>
          {taskKey}
        </a>,
      );
    } else out.push(m[0]);
  }
  if (last < text.length) out.push(text.slice(last));
  return out.flatMap((node, i): ReactNode[] =>
    typeof node === "string" && node.includes("\n")
      ? node.split("\n").flatMap((part, j): ReactNode[] => (j === 0 ? [part] : [<br key={`${key}.br${i}.${j}`} />, part]))
      : [node],
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group/code relative rounded-lg border border-edge bg-panel">
      {lang && <div className="px-4 pt-3.5 text-kbd font-medium text-ink-faint">{lang}</div>}
      <button
        type="button"
        aria-label="Copy code"
        title="Copy code"
        onClick={() =>
          navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          })
        }
        className="absolute right-2.5 top-2.5 flex size-6 items-center justify-center rounded-md text-ink-subtle hover:bg-state-hover hover:text-ink [&_svg]:size-4"
      >
        {copied ? <Check /> : <Copy />}
      </button>
      <pre className={cn("overflow-x-auto px-4 pb-3.5 font-sans text-sm leading-[22px] text-ink-muted", lang ? "pt-1.5" : "pt-3.5 pr-10")}>
        <code className="font-sans">{code}</code>
      </pre>
    </div>
  );
}

const CALLOUT_ICON: Record<string, ReactNode> = {
  agents: <Bot />,
  agent: <Bot />,
  warning: <TriangleAlert />,
  caution: <TriangleAlert />,
  danger: <TriangleAlert />,
  tip: <Lightbulb />,
  hint: <Lightbulb />,
};

function Blocks({ blocks, ctx, k = "b" }: { blocks: Block[]; ctx: Ctx; k?: string }) {
  return (
    <>
      {blocks.map((b, i) => {
        const key = `${k}${i}`;
        switch (b.t) {
          case "p":
            return <p key={key}>{inline(b.text, ctx, key)}</p>;
          case "h": {
            const cls =
              b.level === 1
                ? "pt-3 text-[24px] leading-8 tracking-[-0.019em]"
                : b.level === 2
                  ? "pt-3 text-title"
                  : b.level === 3
                    ? "pt-2 text-[17px] leading-[26px] tracking-[-0.012em]"
                    : "text-prose";
            const Tag = `h${Math.min(b.level + 1, 6)}` as "h2";
            return (
              <Tag key={key} data-heading={b.index ?? undefined} className={cn("scroll-mt-6 font-semibold text-ink", cls)}>
                {inline(b.text, ctx, key)}
              </Tag>
            );
          }
          case "code":
            return <CodeBlock key={key} lang={b.lang} code={b.code} />;
          case "hr":
            return <hr key={key} className="border-edge" />;
          case "quote":
            return (
              <div key={key} className="flex gap-3 rounded-lg bg-panel py-3 pl-3.5 pr-4 text-sm text-ink-muted">
                {b.kind && <span className="mt-0.5 shrink-0 text-ink-subtle [&_svg]:size-4">{CALLOUT_ICON[b.kind] ?? <Info />}</span>}
                <div className="min-w-0 flex-1 space-y-2">
                  <Blocks blocks={b.blocks} ctx={ctx} k={`${key}.`} />
                </div>
              </div>
            );
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={key} className="flex flex-col gap-1.5" start={b.ordered ? b.start : undefined}>
                {b.items.map((item, j) => (
                  <li key={j} className="flex gap-3">
                    {item.task ? (
                      <span className="flex h-6 w-4 shrink-0 items-center">
                        <Checkbox
                          checked={item.task.checked}
                          disabled={!ctx.toggle}
                          label={item.text}
                          onChange={() => item.task && ctx.toggle?.(item.task.index)}
                        />
                      </span>
                    ) : b.ordered ? (
                      <span className="min-w-[1.25rem] shrink-0 text-right tabular-nums text-ink-subtle">{b.start + j}.</span>
                    ) : (
                      <span className="flex h-6 w-[9px] shrink-0 items-center justify-center text-ink-subtle">•</span>
                    )}
                    <div className={cn("min-w-0 flex-1", item.task?.checked && "text-ink-faint line-through")}>
                      {inline(item.text, ctx, `${key}.${j}`)}
                      {item.children.length > 0 && (
                        <div className="mt-1.5 flex flex-col gap-1.5">
                          <Blocks blocks={item.children} ctx={ctx} k={`${key}.${j}.`} />
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </Tag>
            );
          }
          case "table":
            return (
              <div key={key} className="overflow-x-auto rounded-lg border border-edge">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-panel">
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j} style={{ textAlign: b.align[j] ?? "left" }} className="border-b border-edge px-3 py-2 font-medium text-ink">
                          {inline(c, ctx, `${key}.h${j}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r} className="border-b border-edge last:border-0">
                        {row.map((c, j) => (
                          <td key={j} style={{ textAlign: b.align[j] ?? "left" }} className="px-3 py-2 align-top">
                            {inline(c, ctx, `${key}.${r}.${j}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return <Fragment key={key} />;
        }
      })}
    </>
  );
}

export const MarkdownView = memo(function MarkdownView({ markdown, className, wsSlug, workspaceId, onToggleTask, onOpenLink }: MarkdownViewProps) {
  const links = useLinkContext({ workspaceId, wsSlug, onOpenLink });
  const blocks = useMemo(() => parse(markdown), [markdown]);
  const slug = wsSlug ?? links.workspace?.slug;
  const ctx: Ctx = {
    projectKeys: links.projectKeys,
    open: links.open,
    pageHref: (title) => {
      const hit = findByTitle(links.tree, title);
      return hit && slug && !onOpenLink ? `/${slug}/wiki/${hit.id}` : undefined;
    },
    taskHref: (key) => (slug && !onOpenLink ? `/${slug}/t/${key}` : undefined),
    toggle: onToggleTask ? (index) => onToggleTask(toggleTaskAt(markdown, index)) : undefined,
  };
  return (
    <div className={cn("flex flex-col gap-4 break-words text-prose text-ink-muted", className)}>
      <Blocks blocks={blocks} ctx={ctx} />
    </div>
  );
});

/** One line of inline Markdown (bold, code, [[links]], task keys) without block structure. */
export function InlineMarkdown({ text, workspaceId, wsSlug, onOpenLink }: { text: string; workspaceId?: string; wsSlug?: string; onOpenLink?: OpenLink }) {
  const links = useLinkContext({ workspaceId, wsSlug, onOpenLink });
  const slug = wsSlug ?? links.workspace?.slug;
  const ctx: Ctx = {
    projectKeys: links.projectKeys,
    open: links.open,
    pageHref: (title) => {
      const hit = findByTitle(links.tree, title);
      return hit && slug && !onOpenLink ? `/${slug}/wiki/${hit.id}` : undefined;
    },
    taskHref: (key) => (slug && !onOpenLink ? `/${slug}/t/${key}` : undefined),
  };
  return <>{inline(text, ctx)}</>;
}
