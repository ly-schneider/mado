import { Button, cn, Dialog, IconButton } from "@mado/ui";
import { Check, Copy } from "@mado/ui/fluent";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { toast } from "../../lib/toast";

const queries = new Map<string, MediaQueryList>();

export function useMedia(query: string) {
  let mql = queries.get(query);
  if (!mql) {
    mql = window.matchMedia(query);
    queries.set(query, mql);
  }
  const m = mql;
  return useSyncExternalStore(
    (l) => {
      m.addEventListener("change", l);
      return () => m.removeEventListener("change", l);
    },
    () => m.matches,
  );
}

/** Below md the app is the iPhone PWA layout. */
export function useIsPhone() {
  return useMedia("(max-width: 767px)");
}

export async function copyText(text: string, what = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(what);
  } catch {
    toast.error("Couldn't copy. Select the text and copy it manually.");
  }
}

/** A read-only value with a copy button. Used for secrets that are shown once. */
export function CopyField({ value, label = "Copy", className, multiline }: { value: string; label?: string; className?: string; multiline?: boolean }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <div className={cn("flex items-start gap-1 rounded-md border border-edge bg-page pl-2.5 pr-1", multiline ? "py-1" : "h-control items-center", className)}>
      <span className={cn("min-w-0 flex-1 select-all text-label text-ink-muted", multiline ? "whitespace-pre-wrap break-all py-1" : "truncate")}>{value}</span>
      <IconButton
        label={label}
        size="sm"
        onClick={() => {
          copyText(value);
          setDone(true);
        }}
      >
        {done ? <Check /> : <Copy />}
      </IconButton>
    </div>
  );
}

/** Confirmation for destructive or hard-to-undo actions. Names the thing it acts on. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  danger,
  onConfirm,
  loading,
  focusConfirm = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  loading?: boolean;
  /** Off when the dialog has its own input that should take focus. */
  focusConfirm?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} className="max-w-md">
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {children && <div className="text-sm text-ink-muted">{children}</div>}
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} loading={loading} autoFocus={focusConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Section heading inside a settings page: a plain title, then its rows. */
export function SettingsGroup({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      {(title || action) && (
        <div className="flex min-h-8 items-center gap-4">
          {title && <h2 className="min-w-0 flex-1 text-sm font-semibold text-ink">{title}</h2>}
          {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * `label · control`. The description is for rows that aren't self-explanatory.
 * `stack` puts wide controls (inputs) under the label on phones.
 */
export function SettingsRow({
  label,
  description,
  children,
  stack,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  stack?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-12 gap-x-4 gap-y-2 px-4 py-2", stack ? "flex-col justify-center sm:flex-row sm:items-center" : "items-center", className)}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-ink">{label}</div>
        {description && <div className="text-label text-ink-subtle">{description}</div>}
      </div>
      {children}
    </div>
  );
}

/** iOS Safari zooms into inputs under 17px; settings inputs grow to touch size on phones. */
export const touchInput = "max-md:h-touch max-md:text-touch";

/** Empty lists say so in one line. */
export function EmptyLine({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("py-2 text-sm text-ink-subtle", className)}>{children}</p>;
}

const TitleSlot = createContext<HTMLElement | null>(null);
export const TitleSlotProvider = TitleSlot.Provider;

/** Puts the section's primary action next to the page title, top right. */
export function TitleAction({ children }: { children: ReactNode }) {
  const el = useContext(TitleSlot);
  return el ? createPortal(children, el) : null;
}

/** Text input that saves on blur or Enter, and reverts on Escape. */
export function InlineInput({
  value,
  onSave,
  className,
  placeholder,
  disabled,
  type = "text",
  label,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  type?: string;
  label?: string;
}) {
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (draft.trim() !== value.trim() && draft.trim()) onSave(draft.trim());
    else setDraft(value);
  };
  return (
    <input
      aria-label={label}
      type={type}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "h-control w-full rounded-md border border-edge bg-panel px-2.5 text-sm text-ink outline-none max-md:h-touch max-md:text-touch placeholder:text-ink-faint focus:border-accent disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:text-ink-muted",
        className,
      )}
    />
  );
}
