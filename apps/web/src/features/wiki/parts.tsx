import type { Actor } from "@mado/contract";
import { Avatar, cn } from "@mado/ui";
import { forwardRef, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ago } from "../../lib/time";
import type { SaveState } from "./autosave";

const phoneQuery = typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)") : null;

export function useIsPhone() {
  return useSyncExternalStore(
    (l) => {
      phoneQuery?.addEventListener("change", l);
      return () => phoneQuery?.removeEventListener("change", l);
    },
    () => phoneQuery?.matches ?? false,
  );
}

/** Re-render every 30 s so "12m ago" stays true. */
export function useTick(ms = 30_000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function EditedBy({
  actor,
  at,
  meId,
  state,
  className,
  suffix,
}: { actor: Actor | null; at: string; meId?: string; state?: SaveState; className?: string; suffix?: string }) {
  useTick();
  const name = actor ? (actor.type === "user" && actor.id === meId ? "you" : actor.name) : null;
  const pending = state === "saving" || state === "unsaved";
  return (
    <span className={cn("flex min-w-0 items-center gap-2 text-label text-ink-subtle", className)}>
      {actor && <Avatar type={actor.type} initials={actor.initials} size="sm" title={actor.name} />}
      <span className="truncate">
        {state === "error" ? (
          "Not saved · retrying"
        ) : pending ? (
          "Saving…"
        ) : (
          <>
            Edited {ago(at, { long: true })}
            {name && ` by ${name}`}
            {suffix}
          </>
        )}
      </span>
    </span>
  );
}

/** Page title as display text that edits in place; Enter or ↓ at the end moves into the body. */
export const TitleInput = forwardRef<
  HTMLTextAreaElement,
  { value: string; onChange: (v: string) => void; onEnter: () => void; readOnly?: boolean; autoFocus?: boolean; className?: string }
>(function TitleInput({ value, onChange, onEnter, readOnly, autoFocus, className }, ref) {
  const local = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = local.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  });
  useEffect(() => {
    if (autoFocus) {
      local.current?.focus();
      local.current?.select();
    }
  }, [autoFocus]);
  return (
    <textarea
      ref={(el) => {
        local.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      rows={1}
      value={value}
      readOnly={readOnly}
      placeholder="Untitled"
      aria-label="Page title"
      maxLength={200}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, " "))}
      onKeyDown={(e) => {
        const el = e.currentTarget;
        if (e.key === "Enter" || (e.key === "ArrowDown" && el.selectionStart === el.value.length)) {
          e.preventDefault();
          onEnter();
        }
      }}
      className={cn(
        "block w-full resize-none overflow-hidden bg-transparent text-display text-ink outline-none placeholder:text-ink-faint",
        className,
      )}
    />
  );
});
