export type DiffOp = { op: "eq" | "add" | "del"; text: string };

/** Line diff (LCS after trimming the common prefix and suffix, which is most of a typical edit). */
export function diffLines(before: string, after: string): DiffOp[] {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head: DiffOp[] = a.slice(0, start).map((text) => ({ op: "eq", text }));
  const tail: DiffOp[] = a.slice(endA).map((text) => ({ op: "eq", text }));
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  const n = x.length;
  const m = y.length;
  if (n * m > 25_000_000) {
    return [...head, ...x.map((text): DiffOp => ({ op: "del", text })), ...y.map((text): DiffOp => ({ op: "add", text })), ...tail];
  }
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }
  const mid: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      mid.push({ op: "eq", text: x[i]! });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) mid.push({ op: "del", text: x[i++]! });
    else mid.push({ op: "add", text: y[j++]! });
  }
  while (i < n) mid.push({ op: "del", text: x[i++]! });
  while (j < m) mid.push({ op: "add", text: y[j++]! });
  return [...head, ...mid, ...tail];
}
