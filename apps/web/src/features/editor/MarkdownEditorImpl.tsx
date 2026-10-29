import { blockPreview } from "./blocks";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { Annotation, Compartment, EditorSelection, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { cn } from "@mado/ui";
import { type MutableRefObject, useEffect, useMemo, useRef } from "react";
import { completionIcon, slashSource, taskKeySource, wikiLinkSource } from "./completions";
import { type OpenLink, useLinkContext } from "./links";
import { livePreview, type PreviewConfig, previewConfig, refreshPreview } from "./livePreview";
import { codeHighlight, madoTheme } from "./theme";

/**
 * Shared Markdown editor: CodeMirror 6 with Obsidian-style live preview. The document stays plain
 * Markdown in a plain CM6 state, so a Yjs binding can be added later without a custom model.
 * - variant "page": full wiki page editing (headings, code blocks, [[links]] autocomplete)
 * - variant "compact": task descriptions, comments, lead notes, capture details
 */
export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  variant?: "page" | "compact";
  readOnly?: boolean;
  className?: string;
  /** Enables [[page]] autocomplete and task-key links. */
  workspaceId?: string;
  /** ⌘↵ */
  onSubmit?: () => void;
  onBlur?: () => void;
  onCursor?: (pos: { line: number; col: number }) => void;
  /** ⌘S: save now and write a revision. */
  onCheckpoint?: () => void;
  /** Overrides navigation for [[links]], task keys and URLs (guest pages). */
  onOpenLink?: OpenLink;
  /** Overrides the [[ autocomplete titles (guest pages have no workspace tree). */
  linkTitles?: string[];
  viewRef?: MutableRefObject<EditorView | null>;
}

const external = Annotation.define<boolean>();

function toggleWrap(marker: string) {
  return (view: EditorView) => {
    if (view.state.readOnly) return false;
    const n = marker.length;
    view.dispatch(
      view.state.changeByRange((range) => {
        const { from, to } = range;
        const before = view.state.sliceDoc(from - n, from);
        const after = view.state.sliceDoc(to, to + n);
        if (before === marker && after === marker) {
          return {
            changes: [
              { from: from - n, to: from },
              { from: to, to: to + n },
            ],
            range: EditorSelection.range(from - n, to - n),
          };
        }
        return {
          changes: [
            { from, insert: marker },
            { from: to, insert: marker },
          ],
          range: EditorSelection.range(from + n, to + n),
        };
      }),
    );
    return true;
  };
}

export function MarkdownEditor(props: MarkdownEditorProps) {
  const { value, variant = "page", readOnly = false, className, autoFocus, placeholder } = props;
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastEmitted = useRef(value);
  const links = useLinkContext({ workspaceId: props.workspaceId, onOpenLink: props.onOpenLink });

  const live = useRef({ props, links });
  live.current = { props, links };
  const cfg = useRef<PreviewConfig>({ projectKeys: links.projectKeys, open: (t, o) => live.current.links.open(t, o) });
  cfg.current.projectKeys = links.projectKeys;

  const editable = useMemo(() => new Compartment(), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the view is created once; props reach it through refs
  useEffect(() => {
    const getProjects = () => live.current.links.workspace?.projects ?? [];
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false }),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: "true", autocapitalize: "sentences", "aria-label": placeholder ?? "Markdown editor" }),
        placeholder ? placeholderExt(placeholder) : [],
        editable.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
        previewConfig.of(cfg),
        livePreview,
        blockPreview,
        codeHighlight,
        madoTheme,
        autocompletion({
          override: [
            wikiLinkSource(() => live.current.props.linkTitles ?? live.current.links.titles),
            taskKeySource(getProjects),
            slashSource({ sections: variant === "page", getProjects }),
          ],
          icons: false,
          addToOptions: [completionIcon],
          defaultKeymap: true,
        }),
        Prec.high(
          keymap.of([
            { key: "Mod-b", run: toggleWrap("**") },
            { key: "Mod-i", run: toggleWrap("*") },
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                live.current.props.onCheckpoint?.();
                return true;
              },
            },
            {
              key: "Mod-Enter",
              run: () => {
                if (!live.current.props.onSubmit) return false;
                live.current.props.onSubmit();
                return true;
              },
            },
            {
              key: "Escape",
              run: (view) => {
                view.contentDOM.blur();
                return true;
              },
            },
          ]),
        ),
        keymap.of([...completionKeymap, ...markdownKeymap, ...(variant === "page" ? [indentWithTab] : []), ...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of((u) => {
          const p = live.current.props;
          if (u.docChanged && !u.transactions.some((t) => t.annotation(external))) {
            const text = u.state.doc.toString();
            lastEmitted.current = text;
            p.onChange(text);
          }
          if ((u.selectionSet || u.docChanged) && p.onCursor) {
            const head = u.state.selection.main.head;
            const line = u.state.doc.lineAt(head);
            p.onCursor({ line: line.number, col: head - line.from + 1 });
          }
          if (u.focusChanged && !u.view.hasFocus) p.onBlur?.();
        }),
      ],
    });
    const view = new EditorView({ state, parent: host.current! });
    viewRef.current = view;
    if (props.viewRef) props.viewRef.current = view;
    if (autoFocus) {
      view.focus();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    }
    return () => {
      view.destroy();
      viewRef.current = null;
      if (props.viewRef) props.viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === lastEmitted.current) return;
    lastEmitted.current = value;
    if (value === view.state.doc.toString()) return;
    const head = Math.min(view.state.selection.main.head, value.length);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: head },
      annotations: external.of(true),
    });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: editable.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly, editable]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshPreview.of(null) });
  }, [links.projectKeys]);

  return (
    <div
      ref={host}
      data-variant={variant}
      className={cn(
        "w-full text-prose text-ink-muted [&_.cm-editor]:min-h-[inherit] [&_.cm-scroller]:min-h-[inherit]",
        variant === "page" ? "min-h-80" : "min-h-18",
        className,
      )}
      onMouseDown={(e) => {
        // Clicking the empty area under a short document should still place the caret at the end.
        const view = viewRef.current;
        if (!view || readOnly || e.target !== e.currentTarget) return;
        e.preventDefault();
        view.focus();
        view.dispatch({ selection: { anchor: view.state.doc.length } });
      }}
    />
  );
}
