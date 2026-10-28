import type { DiffFile, DiffLine, Hunk } from "@/data/types";

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@\s?(.*)$/;

/** 解析 unified diff 片段（仅含 @@ 块），计算行号与增删统计 */
export function parsePatch(path: string, status: "modified" | "added", patch: string): DiffFile {
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let o = 0;
  let n = 0;
  let add = 0;
  let del = 0;
  for (const raw of patch.replace(/\r\n/g, "\n").split("\n")) {
    const m = HUNK.exec(raw);
    if (m) {
      o = Number(m[1]);
      n = Number(m[2]);
      cur = { header: raw, lines: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur) continue;
    const c = raw[0];
    if (c === "+") {
      cur.lines.push({ t: "+", text: raw.slice(1), n: n++ });
      add++;
    } else if (c === "-") {
      cur.lines.push({ t: "-", text: raw.slice(1), o: o++ });
      del++;
    } else if (c === " " || raw === "") {
      cur.lines.push({ t: " ", text: raw.slice(1), o: o++, n: n++ });
    }
  }
  // 去掉因文件末尾换行产生的最后一个空上下文行
  const last = hunks[hunks.length - 1];
  if (last && last.lines.length) {
    const l = last.lines[last.lines.length - 1];
    if (l.t === " " && l.text === "" && patch.endsWith("\n")) last.lines.pop();
  }
  return { path, status, add, del, hunks };
}

export function fillTemplate(text: string, mod: string): string {
  const Mod = mod.charAt(0).toUpperCase() + mod.slice(1);
  return text.replaceAll("{{mod}}", mod).replaceAll("{{Mod}}", Mod);
}

/** 并排视图：把连续的删除/新增配对 */
export interface SplitRow {
  left?: DiffLine;
  right?: DiffLine;
}
export function toSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.t === " ") {
      rows.push({ left: l, right: l });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].t === "-") dels.push(lines[i++]);
    while (i < lines.length && lines[i].t === "+") adds.push(lines[i++]);
    const len = Math.max(dels.length, adds.length);
    for (let k = 0; k < len; k++) rows.push({ left: dels[k], right: adds[k] });
  }
  return rows;
}
