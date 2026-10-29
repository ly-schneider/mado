import type { Priority } from "@mado/contract";

// ── Quick capture tokens: #label !priority @assignee ^due ───────────────

export interface CaptureToken {
  kind: "label" | "priority" | "assignee" | "due";
  raw: string;
  value: string;
  start: number;
  end: number;
}

const TOKEN_RE = /(^|\s)([#!@^])([\p{L}\p{N}_.\-/]+)/gu;

export function scanTokens(text: string): CaptureToken[] {
  const out: CaptureToken[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const start = (m.index ?? 0) + m[1]!.length;
    const sigil = m[2]!;
    const kind = sigil === "#" ? "label" : sigil === "!" ? "priority" : sigil === "@" ? "assignee" : "due";
    out.push({ kind, raw: sigil + m[3]!, value: m[3]!, start, end: start + 1 + m[3]!.length });
  }
  return out;
}

export function stripTokens(text: string, tokens: CaptureToken[]) {
  let out = text;
  for (const t of [...tokens].sort((a, b) => b.start - a.start)) out = out.slice(0, t.start) + out.slice(t.end);
  return out.replace(/\s{2,}/g, " ").trim();
}

const PRIORITY_ALIASES: Record<string, Priority> = {
  urgent: "urgent",
  u: "urgent",
  "1": "urgent",
  high: "high",
  h: "high",
  "2": "high",
  medium: "medium",
  med: "medium",
  m: "medium",
  "3": "medium",
  low: "low",
  l: "low",
  "4": "low",
  none: "none",
};

export function parsePriority(v: string): Priority | null {
  const key = v.toLowerCase();
  if (PRIORITY_ALIASES[key]) return PRIORITY_ALIASES[key]!;
  const hit = Object.keys(PRIORITY_ALIASES).find((k) => k.length > 1 && k.startsWith(key));
  return hit ? PRIORITY_ALIASES[hit]! : null;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** ^today ^tomorrow ^fri ^nov4 ^2026-11-04 ^3d ^2w */
export function parseDue(v: string, now = new Date()): string | null {
  const s = v.toLowerCase();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (s === "today" || s === "tod") return iso(day);
  if (s === "tomorrow" || s === "tom" || s === "tmr") return iso(new Date(day.getTime() + 86_400_000));
  const rel = s.match(/^(\d+)([dw])$/);
  if (rel) return iso(new Date(day.getTime() + Number(rel[1]) * (rel[2] === "w" ? 7 : 1) * 86_400_000));
  const wd = WEEKDAYS.findIndex((w) => s.startsWith(w));
  if (wd >= 0 && s.length >= 3) {
    const diff = (wd - day.getDay() + 7) % 7 || 7;
    return iso(new Date(day.getTime() + diff * 86_400_000));
  }
  const md = s.match(/^([a-z]{3})[a-z]*[-.]?(\d{1,2})$/);
  if (md) {
    const mi = MONTHS.indexOf(md[1]!);
    if (mi >= 0) {
      let d = new Date(day.getFullYear(), mi, Number(md[2]));
      if (d < day) d = new Date(day.getFullYear() + 1, mi, Number(md[2]));
      return iso(d);
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

// ── Acceptance criteria inside a task description ───────────────────────

export interface Criterion {
  line: number;
  done: boolean;
  text: string;
}

const CHECK_RE = /^\s*[-*+] \[( |x|X)\] (.*)$/;
const CRITERIA_HEADING_RE = /^#{1,6}\s*acceptance criteria\s*$/i;

/**
 * The design renders "- [ ]" items as a separate "Acceptance criteria" block, so they are split
 * out of the description body. The markdown stays the single source: toggling rewrites that line.
 */
export function splitDescription(md: string): { body: string; criteria: Criterion[] } {
  const lines = md.split("\n");
  const criteria: Criterion[] = [];
  const keep: string[] = [];
  lines.forEach((l, i) => {
    const m = l.match(CHECK_RE);
    if (m) criteria.push({ line: i, done: m[1] !== " ", text: m[2]! });
    else if (!CRITERIA_HEADING_RE.test(l.trim())) keep.push(l);
  });
  return { body: keep.join("\n").replace(/\n{3,}/g, "\n\n").trim(), criteria };
}

export function toggleCriterion(md: string, line: number, done: boolean) {
  const lines = md.split("\n");
  const l = lines[line];
  if (l === undefined) return md;
  lines[line] = l.replace(/\[( |x|X)\]/, done ? "[x]" : "[ ]");
  return lines.join("\n");
}

export function withCriteria(description: string, criteria: string[]) {
  if (criteria.length === 0) return description;
  return `${description.trim()}\n\n## Acceptance criteria\n${criteria.map((c) => `- [ ] ${c}`).join("\n")}\n`;
}
