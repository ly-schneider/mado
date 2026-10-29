import { codeBlockRendered } from "./blocks";
import { syntaxTree } from "@codemirror/language";
import { Facet, type Range, StateEffect } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { TASK_KEY_RE } from "@mado/contract";
import type { OpenLink } from "./links";

export interface PreviewConfig {
  projectKeys: Set<string> | null;
  open: OpenLink;
}

/** Holds a ref so React can swap the handler and keys without reconfiguring the editor. */
export const previewConfig = Facet.define<{ current: PreviewConfig }, { current: PreviewConfig } | null>({
  combine: (v) => v[0] ?? null,
});

export const refreshPreview = StateEffect.define<null>();

const svg = (paths: string, cls = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const ICONS = {
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  tip: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  task: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  heading: '<path d="M6 12h12"/><path d="M6 20V4"/><path d="M18 20V4"/>',
  list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  listOrdered: '<path d="M10 12h11"/><path d="M10 18h11"/><path d="M10 6h11"/><path d="M4 10h2"/><path d="M4 6h1v4"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  checklist: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  quote: '<path d="M17 6H3"/><path d="M21 12H8"/><path d="M21 18H8"/><path d="M3 12v6"/>',
  divider: '<path d="M5 12h14"/>',
  table: '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
} as const;

export function iconEl(name: keyof typeof ICONS, cls = "") {
  const span = document.createElement("span");
  span.className = `cm-icon ${cls}`;
  span.innerHTML = svg(ICONS[name]);
  return span;
}

const CALLOUT_ICON: Record<string, keyof typeof ICONS> = {
  agents: "bot",
  agent: "bot",
  warning: "alert",
  caution: "alert",
  danger: "alert",
  tip: "tip",
  hint: "tip",
};

class MarkerWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly width: number,
  ) {
    super();
  }
  eq(o: MarkerWidget) {
    return o.text === this.text && o.width === this.width;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-list-marker";
    span.style.width = `${this.width}px`;
    const inner = document.createElement("span");
    inner.className = this.text === "•" ? "cm-bullet" : "cm-ordinal";
    inner.textContent = this.text;
    span.append(inner);
    return span;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly width: number,
  ) {
    super();
  }
  eq(o: CheckboxWidget) {
    return o.checked === this.checked && o.width === this.width;
  }
  toDOM(view: EditorView) {
    const slot = document.createElement("span");
    slot.className = "cm-list-marker";
    slot.style.width = `${this.width}px`;
    const box = document.createElement("span");
    box.className = "cm-checkbox";
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.checked));
    if (this.checked) box.innerHTML = svg(ICONS.check);
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (view.state.readOnly) return;
      const start = view.posAtDOM(slot);
      const line = view.state.doc.lineAt(start);
      const idx = line.text.indexOf("[", start - line.from);
      if (idx < 0) return;
      const pos = line.from + idx + 1;
      view.dispatch({ changes: { from: pos, to: pos + 1, insert: this.checked ? " " : "x" } });
    });
    slot.append(box);
    return slot;
  }
  ignoreEvent() {
    return true;
  }
}

class CodeHeaderWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly code: string,
  ) {
    super();
  }
  eq(o: CodeHeaderWidget) {
    return o.lang === this.lang && o.code === this.code;
  }
  toDOM() {
    const row = document.createElement("span");
    row.className = "cm-code-header";
    const label = document.createElement("span");
    label.className = "cm-code-lang";
    label.textContent = this.lang;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-code-copy";
    btn.title = "Copy code";
    btn.setAttribute("aria-label", "Copy code");
    btn.innerHTML = svg(ICONS.copy);
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      navigator.clipboard?.writeText(this.code).then(() => {
        btn.innerHTML = svg(ICONS.check);
        setTimeout(() => {
          btn.innerHTML = svg(ICONS.copy);
        }, 1200);
      });
    });
    row.append(label, btn);
    return row;
  }
  ignoreEvent() {
    return true;
  }
}

class CalloutIconWidget extends WidgetType {
  constructor(readonly kind: string) {
    super();
  }
  eq(o: CalloutIconWidget) {
    return o.kind === this.kind;
  }
  toDOM() {
    return iconEl(CALLOUT_ICON[this.kind] ?? "info", "cm-callout-icon");
  }
}

const hidden = Decoration.replace({});
const FENCE_LINE = /^\s*(`{3,}|~{3,})\s*$/;

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const cfg = state.facet(previewConfig)?.current;
  const doc = state.doc;
  const deco: Range<Decoration>[] = [];
  const editing = view.hasFocus && !state.readOnly;
  const active = new Set<number>();
  if (editing) {
    for (const r of state.selection.ranges) {
      const a = doc.lineAt(r.from).number;
      const b = doc.lineAt(r.to).number;
      for (let n = a; n <= b; n++) active.add(n);
    }
  }
  const lineActive = (pos: number) => active.has(doc.lineAt(pos).number);
  const selectionInside = (from: number, to: number) => editing && state.selection.ranges.some((r) => r.from < to && r.to > from);
  const mark = (cls: string, from: number, to: number, attributes?: Record<string, string>) => {
    if (to > from) deco.push(Decoration.mark({ class: cls, attributes }).range(from, to));
  };
  const hide = (from: number, to: number) => {
    if (to > from) deco.push(hidden.range(from, to));
  };
  const lineClass = (pos: number, cls: string, style?: string) =>
    deco.push(Decoration.line({ class: cls, attributes: style ? { style } : undefined }).range(pos));

  const skip: [number, number][] = [];
  const codeBlocks: [number, number][] = [];
  const inSkip = (from: number, to: number) => skip.some(([a, b]) => from < b && to > a);
  const inCodeBlock = (pos: number) => codeBlocks.some(([a, b]) => pos >= a && pos <= b);
  const tree = syntaxTree(state);

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        const heading = name.match(/^ATXHeading(\d)$/);
        if (heading) {
          lineClass(node.from, `cm-h cm-h${heading[1]}`);
          return;
        }
        switch (name) {
          case "HeaderMark": {
            if (!node.node.parent?.name.startsWith("ATXHeading")) return;
            if (lineActive(node.from)) {
              mark("cm-md-mark", node.from, node.to);
              return;
            }
            // Closing marks ("## Title ##") have the space before them; opening marks after.
            const opening = node.from === doc.lineAt(node.from).from;
            if (opening) hide(node.from, node.to + (state.sliceDoc(node.to, node.to + 1) === " " ? 1 : 0));
            else hide(node.from - (state.sliceDoc(node.from - 1, node.from) === " " ? 1 : 0), node.to);
            return;
          }
          case "Emphasis":
            mark("cm-em", node.from, node.to);
            return;
          case "StrongEmphasis":
            mark("cm-strong", node.from, node.to);
            return;
          case "Strikethrough":
            mark("cm-strike", node.from, node.to);
            return;
          case "EmphasisMark":
          case "StrikethroughMark":
            if (lineActive(node.from)) mark("cm-md-mark", node.from, node.to);
            else hide(node.from, node.to);
            return;
          case "InlineCode":
            skip.push([node.from, node.to]);
            mark("cm-inline-code", node.from, node.to);
            return;
          case "CodeMark":
            if (node.node.parent?.name !== "InlineCode") return;
            if (lineActive(node.from)) mark("cm-md-mark", node.from, node.to);
            else hide(node.from, node.to);
            return;
          case "FencedCode": {
            skip.push([node.from, node.to]);
            codeBlocks.push([node.from, node.to]);
            if (codeBlockRendered(state, node.from, node.to)) return false;
            const first = doc.lineAt(node.from);
            const last = doc.lineAt(node.to);
            const closed = last.number > first.number && FENCE_LINE.test(last.text);
            const blockActive = editing && state.selection.ranges.some((r) => r.from <= last.to && r.to >= first.from);
            for (let n = first.number; n <= last.number; n++) {
              const l = doc.line(n);
              let cls = "cm-cb";
              if (n === first.number) cls += blockActive ? " cm-cb-first" : " cm-cb-first cm-cb-head";
              if (n === last.number) cls += " cm-cb-last";
              if (n === last.number && closed && !blockActive) cls += " cm-cb-close";
              lineClass(l.from, cls);
            }
            const info = node.node.getChild("CodeInfo");
            const lang = info ? state.sliceDoc(info.from, info.to) : "";
            if (!blockActive) {
              const codeFrom = Math.min(first.to + 1, doc.length);
              const codeTo = closed ? Math.max(codeFrom, last.from - 1) : last.to;
              deco.push(
                Decoration.replace({ widget: new CodeHeaderWidget(lang, state.sliceDoc(codeFrom, codeTo)) }).range(first.from, first.to),
              );
              if (closed) hide(last.from, last.to);
            } else {
              mark("cm-md-mark", first.from, first.to);
              if (closed) mark("cm-md-mark", last.from, last.to);
            }
            return false;
          }
          case "CodeBlock": {
            skip.push([node.from, node.to]);
            codeBlocks.push([node.from, node.to]);
            const first = doc.lineAt(node.from);
            const last = doc.lineAt(node.to);
            for (let n = first.number; n <= last.number; n++) {
              let cls = "cm-cb cm-cb-plain";
              if (n === first.number) cls += " cm-cb-first";
              if (n === last.number) cls += " cm-cb-last";
              lineClass(doc.line(n).from, cls);
            }
            return false;
          }
          case "Blockquote": {
            const first = doc.lineAt(node.from);
            const last = doc.lineAt(node.to);
            const callout = first.text.match(/^(\s*>\s*)(\[!(\w+)\][+-]?\s?)/);
            const agents = !callout && /^\s*>\s*\*\*agents?:?\*\*/i.test(first.text);
            const kind = callout ? callout[3]!.toLowerCase() : agents ? "agents" : null;
            for (let n = first.number; n <= last.number; n++) {
              let cls = "cm-quote";
              if (n === first.number) cls += " cm-quote-first";
              if (n === last.number) cls += " cm-quote-last";
              if (kind) cls += " cm-quote-icon";
              lineClass(doc.line(n).from, cls);
            }
            if (kind) deco.push(Decoration.widget({ widget: new CalloutIconWidget(kind), side: -1 }).range(first.from));
            if (callout && !lineActive(first.from)) {
              const start = first.from + callout[1]!.length;
              hide(start, start + callout[2]!.length);
            }
            return;
          }
          case "QuoteMark": {
            const after = state.sliceDoc(node.to, node.to + 1) === " " ? 1 : 0;
            if (lineActive(node.from)) mark("cm-md-mark", node.from, node.to);
            else hide(node.from, node.to + after);
            return;
          }
          case "ListItem": {
            const listMark = node.node.getChild("ListMark");
            if (!listMark) return;
            const line = doc.lineAt(listMark.from);
            if (line.number !== doc.lineAt(node.from).number) return;
            const task = node.node.getChild("Task");
            const taskMarker = task?.getChild("TaskMarker");
            let end = listMark.to;
            if (taskMarker) end = taskMarker.to;
            if (state.sliceDoc(end, end + 1) === " ") end += 1;
            const lead = state.sliceDoc(line.from, listMark.from).replace(/\t/g, "    ").length;
            const level = Math.floor(lead / 2);
            const markText = state.sliceDoc(listMark.from, listMark.to);
            const ordered = /\d/.test(markText);
            const width = level * 22 + (taskMarker ? 26 : ordered ? 12 + markText.length * 9 : 21);
            if (taskMarker) {
              const checked = /x/i.test(state.sliceDoc(taskMarker.from, taskMarker.to));
              if (checked && task) mark("cm-task-done", end, task.to);
            }
            if (selectionInside(line.from, end - 1)) {
              mark("cm-md-mark", listMark.from, listMark.to);
              return;
            }
            lineClass(line.from, "cm-li", `padding-left:${width}px;text-indent:-${width}px`);
            const widget = taskMarker
              ? new CheckboxWidget(/x/i.test(state.sliceDoc(taskMarker.from, taskMarker.to)), width)
              : new MarkerWidget(ordered ? markText : "•", width);
            deco.push(Decoration.replace({ widget }).range(line.from, end));
            return;
          }
          case "Link": {
            const marks = node.node.getChildren("LinkMark");
            const url = node.node.getChild("URL");
            if (marks.length < 2 || !url) return;
            skip.push([node.from, node.to]);
            const href = state.sliceDoc(url.from, url.to);
            mark("cm-link", marks[0]!.to, marks[1]!.from, { "data-href": href });
            if (lineActive(node.from)) {
              mark("cm-md-mark", marks[0]!.from, marks[0]!.to);
              mark("cm-md-mark", marks[1]!.from, node.to);
            } else {
              hide(marks[0]!.from, marks[0]!.to);
              hide(marks[1]!.from, node.to);
            }
            return false;
          }
          case "URL":
            if (node.node.parent?.name === "Link") return;
            skip.push([node.from, node.to]);
            mark("cm-link", node.from, node.to, { "data-href": state.sliceDoc(node.from, node.to) });
            return;
          case "HorizontalRule":
            lineClass(node.from, "cm-hr");
            if (!lineActive(node.from)) hide(node.from, node.to);
            return;
          case "TableDelimiter":
            mark("cm-md-mark", node.from, node.to);
            return;
        }
      },
    });

    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos);
      pos = line.to + 1;
      if (inCodeBlock(line.from)) continue;
      if (!line.text.trim()) {
        lineClass(line.from, "cm-blank");
        continue;
      }
      const wiki: [number, number][] = [];
      for (const m of line.text.matchAll(/\[\[([^\]\n]+?)\]\]/g)) {
        const a = line.from + m.index!;
        const b = a + m[0].length;
        if (inSkip(a, b)) continue;
        wiki.push([a, b]);
        const inner = m[1]!;
        const pipe = inner.indexOf("|");
        if (lineActive(a)) {
          mark("cm-md-mark", a, a + 2);
          mark("cm-md-mark", b - 2, b);
        } else {
          hide(a, a + 2);
          hide(b - 2, b);
        }
        if (pipe >= 0 && !lineActive(a)) {
          hide(a + 2, a + 3 + pipe);
          mark("cm-wikilink", a + 3 + pipe, b - 2, { "data-title": inner });
        } else {
          mark("cm-wikilink", a + 2, b - 2, { "data-title": inner });
        }
      }
      if (!cfg?.projectKeys) continue;
      for (const m of line.text.matchAll(TASK_KEY_RE)) {
        const a = line.from + m.index!;
        const b = a + m[0].length;
        if (!cfg.projectKeys.has(m[1]!)) continue;
        if (inSkip(a, b) || wiki.some(([x, y]) => a < y && b > x)) continue;
        mark("cm-tasklink", a, b, { "data-key": m[0] });
      }
    }
  }
  return Decoration.set(deco, true);
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        u.focusChanged ||
        syntaxTree(u.startState) !== syntaxTree(u.state) ||
        u.transactions.some((t) => t.effects.some((e) => e.is(refreshPreview)))
      ) {
        this.decorations = build(u.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(e, view) {
        const el = (e.target as HTMLElement).closest<HTMLElement>("[data-title],[data-key],[data-href]");
        if (!el) return false;
        const cfg = view.state.facet(previewConfig)?.current;
        if (!cfg) return false;
        const pos = view.posAtDOM(el);
        const editingHere =
          view.hasFocus && !view.state.readOnly && view.state.selection.ranges.some((r) => view.state.doc.lineAt(r.head).number === view.state.doc.lineAt(pos).number);
        if (editingHere && !(e.metaKey || e.ctrlKey)) return false;
        e.preventDefault();
        if (el.dataset.title) cfg.open({ type: "page", title: el.dataset.title });
        else if (el.dataset.key) cfg.open({ type: "task", key: el.dataset.key });
        else if (el.dataset.href) cfg.open({ type: "url", href: el.dataset.href });
        return true;
      },
    },
  },
);
