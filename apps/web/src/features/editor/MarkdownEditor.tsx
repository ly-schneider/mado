import { cn } from "@mado/ui";
import { lazy, Suspense } from "react";
import type { MarkdownEditorProps } from "./MarkdownEditorImpl";

export type { MarkdownEditorProps };

// CodeMirror is most of the bundle, and many screens never edit. It loads on first use, or earlier
// when the browser is idle (see preloadEditor in main.tsx).
const loadEditor = () => import("./MarkdownEditorImpl");
const Impl = lazy(() => loadEditor().then((m) => ({ default: m.MarkdownEditor })));

export function preloadEditor() {
  void loadEditor();
}

export function MarkdownEditor(props: MarkdownEditorProps) {
  return (
    <Suspense
      fallback={
        <div className={cn("whitespace-pre-wrap text-prose text-ink-muted", props.className)}>
          {props.value || <span className="text-ink-faint">{props.placeholder}</span>}
        </div>
      }
    >
      <Impl {...props} />
    </Suspense>
  );
}
