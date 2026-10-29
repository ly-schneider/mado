import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../lib/orpc";
import { toast } from "../../lib/toast";

export type SaveState = "saved" | "unsaved" | "saving" | "error";
type Patch = { title?: string; content?: string };
interface SaveResult {
  revisionNumber: number;
  revisionCount?: number;
  updatedAt: string;
}

const IDLE_MS = 1200;

/**
 * Debounced autosave shared by members and guests: edits apply locally at once, a save goes out after
 * 1.2 s idle (or right away on ⌘S as a checkpoint), and saves never overlap.
 */
export function useAutosave({
  doc,
  save,
  onSaved,
}: {
  doc: { id: string; title: string; content: string; revisionNumber: number };
  save: (input: Patch & { baseRevision: number; checkpoint: boolean }) => Promise<SaveResult>;
  onSaved?: (result: SaveResult, patch: Patch) => void;
}) {
  const [draft, setDraft] = useState({ title: doc.title, content: doc.content });
  const [state, setState] = useState<SaveState>("saved");
  const [revision, setRevision] = useState(doc.revisionNumber);
  const pending = useRef<Patch>({});
  const inflight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const base = useRef(doc.revisionNumber);
  const failed = useRef(false);
  const cbs = useRef({ save, onSaved });
  cbs.current = { save, onSaved };

  const hasPending = () => pending.current.title !== undefined || pending.current.content !== undefined;

  const flush = useCallback(async (checkpoint = false) => {
    clearTimeout(timer.current);
    if (inflight.current) await inflight.current;
    if (!checkpoint && !hasPending()) return;
    const patch = pending.current;
    pending.current = {};
    setState("saving");
    const run = (async () => {
      try {
        const res = await cbs.current.save({ ...patch, baseRevision: base.current, checkpoint });
        base.current = res.revisionNumber;
        setRevision(res.revisionNumber);
        failed.current = false;
        cbs.current.onSaved?.(res, patch);
        setState(hasPending() ? "unsaved" : "saved");
      } catch (e) {
        pending.current = { ...patch, ...pending.current };
        setState("error");
        if (!failed.current) toast.error(`Not saved: ${errorMessage(e)}`);
        failed.current = true;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => flush(), 5000);
      }
    })();
    inflight.current = run;
    await run;
    inflight.current = null;
  }, []);

  const schedule = useCallback(() => {
    setState("unsaved");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), IDLE_MS);
  }, [flush]);

  const setTitle = useCallback(
    (title: string) => {
      setDraft((d) => ({ ...d, title }));
      pending.current.title = title;
      schedule();
    },
    [schedule],
  );
  const setContent = useCallback(
    (content: string) => {
      setDraft((d) => ({ ...d, content }));
      pending.current.content = content;
      schedule();
    },
    [schedule],
  );

  // Pull in changes made elsewhere (an agent, a restore) while we have nothing unsaved.
  useEffect(() => {
    if (hasPending() || inflight.current) return;
    setDraft((d) => (d.title === doc.title && d.content === doc.content ? d : { title: doc.title, content: doc.content }));
    if (doc.revisionNumber > base.current) {
      base.current = doc.revisionNumber;
      setRevision(doc.revisionNumber);
    }
  }, [doc.title, doc.content, doc.revisionNumber]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (hasPending() || inflight.current) {
        void flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      void flush();
    };
  }, [flush]);

  return { title: draft.title, content: draft.content, setTitle, setContent, state, revision, flush };
}
