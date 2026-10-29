import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

/**
 * Tables and fenced code render as real blocks while the cursor is elsewhere: a table as an HTML table,
 * code in a horizontally scrolling card (the editor wraps lines, code shouldn't). Moving the cursor in,
 * or clicking the block, shows the Markdown again. Block decorations must come from a state field.
 */

const FENCE_LINE = /^\s*(```|~~~)/;

type Align = "left" | "center" | "right" | null;

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function parseTable(text: string): { head: string[]; rows: string[][]; align: Align[] } | null {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return null;
  const head = splitRow(lines[0]!);
  const align = splitRow(lines[1]!).map((c): Align => {
    const l = c.startsWith(":");
    const r = c.endsWith(":");
    return l && r ? "center" : r ? "right" : l ? "left" : null;
  });
  return { head, rows: lines.slice(2).map(splitRow), align };
}

/** Inline Markdown in cells is shown with its markers stripped; full rendering lives in MarkdownView. */
const plain = (s: string) => s.replace(/\*\*|__|`|~~/g, "").replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, "$2");

function moveInto(view: EditorView, pos: number) {
  view.dispatch({ selection: { anchor: pos } });
  view.focus();
}

class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number,
  ) {
    super();
  }
  eq(o: TableWidget) {
    return o.source === this.source && o.from === this.from;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-table-wrap";
    const parsed = parseTable(this.source);
    const table = document.createElement("table");
    table.className = "cm-table";
    if (parsed) {
      const thead = table.createTHead().insertRow();
      parsed.head.forEach((h, i) => {
        const th = document.createElement("th");
        th.textContent = plain(h);
        if (parsed.align[i]) th.style.textAlign = parsed.align[i]!;
        thead.append(th);
      });
      const body = table.createTBody();
      for (const row of parsed.rows) {
        const tr = body.insertRow();
        parsed.head.forEach((_, i) => {
          const td = tr.insertCell();
          td.textContent = plain(row[i] ?? "");
          if (parsed.align[i]) td.style.textAlign = parsed.align[i]!;
        });
      }
    }
    wrap.append(table);
    wrap.addEventListener("mousedown", (e) => {
      if (view.state.readOnly) return;
      e.preventDefault();
      moveInto(view, this.from);
    });
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

const COPY = '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>';
const CHECK = '<path d="M20 6 9 17l-5-5"/>';
const icon = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

class CodeWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly code: string,
    readonly codeFrom: number,
  ) {
    super();
  }
  eq(o: CodeWidget) {
    return o.lang === this.lang && o.code === this.code && o.codeFrom === this.codeFrom;
  }
  toDOM(view: EditorView) {
    const card = document.createElement("div");
    card.className = "cm-codecard";
    const header = document.createElement("div");
    header.className = "cm-codecard-head";
    const label = document.createElement("span");
    label.className = "cm-code-lang";
    label.textContent = this.lang;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-code-copy";
    btn.title = "Copy code";
    btn.setAttribute("aria-label", "Copy code");
    btn.innerHTML = icon(COPY);
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", () => {
      navigator.clipboard?.writeText(this.code).then(() => {
        btn.innerHTML = icon(CHECK);
        setTimeout(() => {
          btn.innerHTML = icon(COPY);
        }, 1200);
      });
    });
    header.append(label, btn);
    const pre = document.createElement("pre");
    pre.className = "cm-codecard-pre";
    pre.textContent = this.code || " ";
    card.append(header, pre);
    card.addEventListener("mousedown", (e) => {
      if (view.state.readOnly) return;
      // A drag inside the card is a horizontal scroll or a text selection to copy, not an edit.
      if (window.getSelection()?.toString()) return;
      e.preventDefault();
      moveInto(view, this.codeFrom);
    });
    return card;
  }
  ignoreEvent() {
    return true;
  }
}

function selectionTouches(state: EditorState, from: number, to: number) {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

function build(state: EditorState): DecorationSet {
  const deco: Range<Decoration>[] = [];
  const doc = state.doc;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "Table") {
        const first = doc.lineAt(node.from);
        const last = doc.lineAt(node.to);
        if (!state.readOnly && selectionTouches(state, first.from, last.to)) return false;
        deco.push(
          Decoration.replace({ widget: new TableWidget(state.sliceDoc(first.from, last.to), first.from), block: true }).range(first.from, last.to),
        );
        return false;
      }
      if (node.name === "FencedCode") {
        const first = doc.lineAt(node.from);
        const last = doc.lineAt(node.to);
        const closed = last.number > first.number && FENCE_LINE.test(last.text);
        // Unclosed fences are still being typed; leave them as Markdown.
        if (!closed) return false;
        if (!state.readOnly && selectionTouches(state, first.from, last.to)) return false;
        const info = node.node.getChild("CodeInfo");
        const lang = info ? state.sliceDoc(info.from, info.to) : "";
        const codeFrom = Math.min(first.to + 1, doc.length);
        const code = last.number - first.number > 1 ? state.sliceDoc(codeFrom, last.from - 1) : "";
        deco.push(Decoration.replace({ widget: new CodeWidget(lang, code, codeFrom), block: true }).range(first.from, last.to));
        return false;
      }
    },
  });
  return Decoration.set(deco, true);
}

export const blockPreview = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return build(tr.state);
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Whether the block-level preview owns this fenced code block (so the line preview leaves it alone). */
export function codeBlockRendered(state: EditorState, from: number, to: number) {
  const first = state.doc.lineAt(from);
  const last = state.doc.lineAt(to);
  const closed = last.number > first.number && FENCE_LINE.test(last.text);
  return closed && (state.readOnly || !selectionTouches(state, first.from, last.to));
}
