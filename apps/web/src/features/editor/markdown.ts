export interface Heading {
  level: number;
  text: string;
  /** 1-based line number in the source. */
  line: number;
}

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/** ATX headings outside fenced code, with inline markers stripped for display. */
export function outline(markdown: string): Heading[] {
  const out: Heading[] = [];
  let fence: string | null = null;
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const f = line.match(FENCE_RE);
    if (f) {
      if (!fence) fence = f[1]!.slice(0, 3);
      else if (f[1]!.startsWith(fence)) fence = null;
      continue;
    }
    if (fence) continue;
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) out.push({ level: h[1]!.length, text: plainInline(h[2]!), line: i + 1 });
  }
  return out;
}

export function plainInline(text: string) {
  return text
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t: string, alias?: string) => alias ?? t)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|~~|`)/g, "");
}

export function wordCount(markdown: string) {
  const words = markdown.replace(/[#>*_`~\-[\]()|]/g, " ").match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu);
  return words?.length ?? 0;
}

export function readMinutes(words: number) {
  return Math.max(1, Math.round(words / 220));
}

/** Flip the n-th "- [ ]" checkbox (document order, outside code) and return the new source. */
export function toggleTaskAt(markdown: string, index: number) {
  let n = 0;
  let fence: string | null = null;
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const f = line.match(FENCE_RE);
    if (f) {
      if (!fence) fence = f[1]!.slice(0, 3);
      else if (f[1]!.startsWith(fence)) fence = null;
      continue;
    }
    if (fence) continue;
    const m = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\].*)$/);
    if (!m) continue;
    if (n === index) {
      lines[i] = `${m[1]}${m[2] === " " ? "x" : " "}${m[3]}`;
      return lines.join("\n");
    }
    n++;
  }
  return markdown;
}

/** "Folder/Page" links resolve by their last segment. */
export function linkTitle(raw: string) {
  const base = raw.split("|")[0]!.trim();
  return base.split("/").pop()!.trim();
}

export function linkLabel(raw: string) {
  const [target, alias] = raw.split("|");
  return (alias ?? target!).trim();
}

export function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
}
