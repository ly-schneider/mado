import { type Completion, type CompletionContext, type CompletionResult, type CompletionSource, snippet, startCompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Project } from "@mado/contract";
import { orpc, queryClient } from "../../lib/orpc";
import { ICONS, iconEl } from "./livePreview";

const CODE_NODES = new Set(["FencedCode", "CodeBlock", "InlineCode", "CodeText"]);

function inCode(state: EditorState, pos: number) {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (CODE_NODES.has(n.name)) return true;
  }
  return false;
}

export function wikiLinkSource(getTitles: () => string[]): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/\[\[[^\]\n]*$/);
    if (!m || inCode(ctx.state, ctx.pos)) return null;
    const close = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === "]]" ? "" : "]]";
    const titles = [...new Set(getTitles())];
    if (titles.length === 0) return null;
    return {
      from: m.from + 2,
      options: titles.map((t) => ({ label: t, type: "page", apply: `${t}${close}` })),
      validFor: /^[^\]\n]*$/,
    };
  };
}

export function taskKeySource(getProjects: () => Project[]): CompletionSource {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const m = ctx.matchBefore(/\b[A-Z][A-Z0-9]{1,4}-[\p{L}\p{N}]*$/u);
    if (!m || inCode(ctx.state, ctx.pos)) return null;
    const [key, rest = ""] = m.text.split("-");
    const project = getProjects().find((p) => p.key === key);
    if (!project) return null;
    const tasks = await queryClient.fetchQuery(orpc.task.list.queryOptions({ input: { projectId: project.id }, staleTime: 60_000 })).catch(() => []);
    const q = rest.toLowerCase();
    const hits = tasks
      .filter((t) => (/^\d*$/.test(rest) ? t.key.startsWith(m.text) : t.title.toLowerCase().includes(q)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 30);
    if (hits.length === 0) return null;
    return {
      from: m.from,
      filter: false,
      options: hits.map((t) => ({ label: t.key, detail: t.title, type: "task", apply: t.key })),
    };
  };
}

type Apply = (view: EditorView, from: number, to: number) => void;

/** Replace the current line's block prefix (heading, list, quote) with a new one. */
function setPrefix(prefix: string): Apply {
  return (view, from, to) => {
    const line = view.state.doc.lineAt(from);
    const text = line.text.slice(0, from - line.from) + line.text.slice(to - line.from);
    const m = text.match(/^(\s*)(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s*(\[!\w+\]\s*)?)?/)!;
    const next = m[1] + prefix + text.slice(m[0].length);
    const fromEnd = line.to - to;
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: next },
      selection: { anchor: line.from + next.length - fromEnd },
      userEvent: "input.complete",
    });
  };
}

function insert(text: string, cursorOffset = text.length, then?: (view: EditorView) => void): Apply {
  return (view, from, to) => {
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + cursorOffset }, userEvent: "input.complete" });
    then?.(view);
  };
}

interface SlashCommand {
  label: string;
  detail?: string;
  icon: keyof typeof ICONS;
  section: "Format" | "Insert";
  apply: Apply;
}

export function slashSource(opts: { sections: boolean; getProjects: () => Project[] }): CompletionSource {
  const commands: SlashCommand[] = [
    { label: "Heading 1", detail: "#", icon: "heading", section: "Format", apply: setPrefix("# ") },
    { label: "Heading 2", detail: "##", icon: "heading", section: "Format", apply: setPrefix("## ") },
    { label: "Heading 3", detail: "###", icon: "heading", section: "Format", apply: setPrefix("### ") },
    { label: "Bulleted list", detail: "-", icon: "list", section: "Format", apply: setPrefix("- ") },
    { label: "Numbered list", detail: "1.", icon: "listOrdered", section: "Format", apply: setPrefix("1. ") },
    { label: "Checklist", detail: "[ ]", icon: "checklist", section: "Format", apply: setPrefix("- [ ] ") },
    { label: "Callout", detail: ">", icon: "info", section: "Format", apply: setPrefix("> [!note] ") },
    { label: "Agents note", icon: "bot", section: "Format", apply: setPrefix("> **Agents:** ") },
    { label: "Code block", detail: "```", icon: "code", section: "Insert", apply: insert("```\n\n```", 4) },
    { label: "Divider", detail: "---", icon: "divider", section: "Insert", apply: insert("---\n") },
    { label: "Table", icon: "table", section: "Insert", apply: insert("| Column | Column |\n| --- | --- |\n|  |  |\n", 2) },
    {
      label: "Link",
      detail: "web",
      icon: "link",
      section: "Insert",
      // Tab stops: type the label, Tab, paste the URL.
      apply: (view, from, to) => snippet("[${text}](${https://})")(view, null, from, to),
    },
    { label: "Link page", detail: "[[", icon: "file", section: "Insert", apply: insert("[[", 2, (v) => startCompletion(v)) },
    {
      label: "Link task",
      detail: "KEY-",
      icon: "task",
      section: "Insert",
      apply: (view, from, to) => {
        const key = opts.getProjects()[0]?.key;
        if (!key) return;
        insert(`${key}-`, key.length + 1, (v) => startCompletion(v))(view, from, to);
      },
    },
  ];
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/\/[\p{L} ]{0,20}$/u);
    if (!m || inCode(ctx.state, ctx.pos)) return null;
    const line = ctx.state.doc.lineAt(m.from);
    if (m.from > line.from && !/\s/.test(ctx.state.sliceDoc(m.from - 1, m.from))) return null;
    // A space directly after "/" means prose ("and / or"), not a command.
    if (/^\/\s/.test(m.text)) return null;
    const list = commands.filter((c) => c.label !== "Link task" || opts.getProjects().length > 0);
    return {
      from: m.from,
      filter: true,
      options: list.map(
        (c, i): Completion => ({
          // Keep the menu in our order instead of CodeMirror's alphabetical one.
          boost: 50 - i,
          label: `/${c.label}`,
          displayLabel: c.label,
          detail: c.detail,
          type: c.icon,
          section: opts.sections ? c.section : undefined,
          apply: (view, _completion, from, to) => c.apply(view, from, to),
        }),
      ),
      validFor: /^\/[\p{L} ]*$/u,
    };
  };
}

/** Lucide glyph in front of every option, keyed by completion type. */
export const completionIcon = {
  render(completion: Completion) {
    const type = completion.type as keyof typeof ICONS | undefined;
    return iconEl(type && ICONS[type] ? type : "file", "cm-completion-glyph");
  },
  position: 20,
};
