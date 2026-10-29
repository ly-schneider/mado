import { cn } from "@mado/ui";
import { X } from "lucide-react";
import { useSyncExternalStore } from "react";

interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  tone?: "default" | "error";
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, opts: { action?: Toast["action"]; tone?: Toast["tone"]; duration?: number } = {}) {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, text, action: opts.action, tone: opts.tone }];
  emit();
  setTimeout(() => dismiss(id), opts.duration ?? (opts.action ? 6000 : 3500));
  return id;
}
toast.error = (text: string) => toast(text, { tone: "error" });

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 pb-safe md:bottom-6 md:right-6 md:left-auto md:items-end">
      {list.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "pointer-events-auto flex h-10 animate-pop items-center gap-3 rounded-lg border border-edge bg-overlay pl-3.5 pr-1.5 text-sm text-ink shadow-[0_8px_32px_-8px_rgb(0_0_0/0.5)]",
            t.tone === "error" && "text-danger",
          )}
        >
          <span>{t.text}</span>
          {t.action && (
            <button
              type="button"
              className="rounded-md px-2 py-1 font-medium text-accent hover:bg-state-hover"
              onClick={() => {
                t.action?.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" aria-label="Dismiss" className="rounded-md p-1 text-ink-faint hover:text-ink" onClick={() => dismiss(t.id)}>
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
