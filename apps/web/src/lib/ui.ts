import { useSyncExternalStore } from "react";

/** Global overlay state shared by the shell, palette, shortcuts and screens. */
interface UiState {
  paletteOpen: boolean;
  paletteQuery: string;
  capture: { open: boolean; kind: "task" | "note" | "lead"; projectId?: string; status?: string };
  sidebarOpen: boolean;
  /** Sidebar row showing an inline title input (new folders start here). */
  renamingDocId: string | null;
}

let state: UiState = {
  paletteOpen: false,
  paletteQuery: "",
  capture: { open: false, kind: "task" },
  sidebarOpen: true,
  renamingDocId: null,
};
const listeners = new Set<() => void>();

export function setUi(patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  for (const l of listeners) l();
}

export function useUi<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(state),
  );
}

export const openPalette = (query = "") => setUi({ paletteOpen: true, paletteQuery: query });
export const openCapture = (kind: UiState["capture"]["kind"] = "task", opts: { projectId?: string; status?: string } = {}) =>
  setUi({ capture: { open: true, kind, ...opts } });
export const closeCapture = () => setUi((s) => ({ capture: { ...s.capture, open: false } }));

/** Recently opened tasks/docs for the empty palette and mobile search. */
export interface RecentItem {
  type: "task" | "doc" | "lead" | "query";
  id: string;
  title: string;
  ref: string; // task key, doc id, lead id or the query text
}

export function pushRecent(item: RecentItem) {
  try {
    const list: RecentItem[] = JSON.parse(localStorage.getItem("mado.recent") ?? "[]");
    const next = [item, ...list.filter((r) => !(r.type === item.type && r.id === item.id))].slice(0, 12);
    localStorage.setItem("mado.recent", JSON.stringify(next));
  } catch {}
}

export function getRecent(): RecentItem[] {
  try {
    return JSON.parse(localStorage.getItem("mado.recent") ?? "[]");
  } catch {
    return [];
  }
}
