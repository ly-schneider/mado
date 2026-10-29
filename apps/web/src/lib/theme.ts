import { useSyncExternalStore } from "react";

export type ThemePref = "system" | "dark" | "light";
export type Accent = "lamp" | "sora" | "ai" | "shu";

const listeners = new Set<() => void>();
const media = window.matchMedia("(prefers-color-scheme: dark)");

function read<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function apply() {
  const pref = read<ThemePref>("mado.theme", "system");
  const dark = pref === "dark" || (pref === "system" && media.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.accent = read<Accent>("mado.accent", "lamp");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#100f0d" : "#fdfbfa");
  for (const l of listeners) l();
}
media.addEventListener("change", apply);

export function setTheme(pref: ThemePref) {
  try {
    localStorage.setItem("mado.theme", pref);
  } catch {}
  apply();
}

export function setAccent(accent: Accent) {
  try {
    localStorage.setItem("mado.accent", accent);
  } catch {}
  apply();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useTheme() {
  const resolved = useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme as "dark" | "light");
  const pref = useSyncExternalStore(subscribe, () => read<ThemePref>("mado.theme", "system"));
  const accent = useSyncExternalStore(subscribe, () => read<Accent>("mado.accent", "lamp"));
  return { resolved, pref, accent };
}

/** The sidebar moon button flips between dark and light, leaving "system" behind. */
export function toggleTheme() {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}
