import { useEffect, useRef, useSyncExternalStore } from "react";
import { tinykeys } from "tinykeys";

export interface Command {
  id: string;
  title: string;
  /** tinykeys syntax: "c", "g b", "$mod+k", "Shift+?" */
  keys?: string;
  /** Shown in the palette, e.g. "C" or "G then B". */
  hint?: string;
  group: "Navigation" | "Tasks" | "Wiki" | "Leads" | "Actions" | "Settings";
  icon?: React.ReactNode;
  subtitle?: string;
  run: () => void;
  /** Fire even while typing in an input (for $mod chords). */
  global?: boolean;
  when?: () => boolean;
}

/**
 * One registry for every keyboard action. Screens register commands while mounted, the palette lists
 * them, and tinykeys binds their keys, so every action is reachable from both.
 */
const commands = new Map<string, Command>();
const listeners = new Set<() => void>();
let snapshot: Command[] = [];

function emit() {
  snapshot = [...commands.values()];
  for (const l of listeners) l();
}

export function isTyping(e: Event) {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || !!t.closest(".cm-editor");
}

let unbind: (() => void) | null = null;
function rebind() {
  unbind?.();
  const map: Record<string, (e: KeyboardEvent) => void> = {};
  for (const c of commands.values()) {
    if (!c.keys) continue;
    for (const k of c.keys.split(",").map((s) => s.trim())) {
      map[k] = (e) => {
        if (!c.global && isTyping(e)) return;
        if (document.querySelector("[data-palette-open]") && !c.global) return;
        if (c.when && !c.when()) return;
        e.preventDefault();
        c.run();
      };
    }
  }
  unbind = tinykeys(window, map);
}

export function registerCommands(list: Command[]) {
  for (const c of list) commands.set(c.id, c);
  emit();
  rebind();
  return () => {
    for (const c of list) if (commands.get(c.id) === c) commands.delete(c.id);
    emit();
    rebind();
  };
}

/** Register commands for the lifetime of a component. Handlers always see the latest closure. */
export function useCommands(list: Command[], deps: unknown[] = []) {
  const ref = useRef(list);
  ref.current = list;
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are supplied by the caller
  useEffect(() => {
    const wrapped = ref.current.map((c, i) => ({ ...c, run: () => ref.current[i]?.run() }));
    return registerCommands(wrapped);
  }, deps);
}

export function useCommandList() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}

/** j/k list navigation shared by list, board and inbox screens. */
export function useListNavigation<T>(items: T[], current: number, setCurrent: (i: number) => void, onOpen?: (item: T) => void) {
  useCommands(
    [
      { id: "list.down", title: "Move down", keys: "j, ArrowDown", hint: "J", group: "Navigation", run: () => setCurrent(Math.min(items.length - 1, current + 1)) },
      { id: "list.up", title: "Move up", keys: "k, ArrowUp", hint: "K", group: "Navigation", run: () => setCurrent(Math.max(0, current - 1)) },
      {
        id: "list.open",
        title: "Open",
        keys: "Enter",
        hint: "↵",
        group: "Navigation",
        run: () => {
          const item = items[current];
          if (item && onOpen) onOpen(item);
        },
      },
    ],
    [items, current],
  );
}
