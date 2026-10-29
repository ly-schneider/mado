const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const monthDay = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const monthDayYear = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });
const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Compact relative time as in the designs: "now", "6m", "1h", "yesterday", "Oct 29". */
export function ago(iso: string | Date | null | undefined, opts: { long?: boolean } = {}) {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diff = Date.now() - d.getTime();
  if (diff < MIN) return opts.long ? "just now" : "now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m${opts.long ? " ago" : ""}`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h${opts.long ? " ago" : ""}`;
  if (diff < 2 * DAY) return "yesterday";
  if (diff < 7 * DAY && opts.long) return `${Math.floor(diff / DAY)} days ago`;
  return shortDate(d);
}

export function shortDate(iso: string | Date) {
  const d = typeof iso === "string" ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso) : iso;
  return d.getFullYear() === new Date().getFullYear() ? monthDay.format(d) : monthDayYear.format(d);
}

export function clock(iso: string | Date) {
  return time.format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "Due today", "Nov 4", for ISO dates without time. */
export function dueLabel(date: string | null) {
  if (!date) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (date === today) return "Due today";
  return shortDate(date);
}

export function dayGroup(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - DAY);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return shortDate(d);
}
