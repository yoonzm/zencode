/** 子序列模糊匹配，返回得分与命中下标；未命中返回 null。 */
export function fuzzy(query: string, text: string): { score: number; idx: number[] } | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, idx: [] };
  const t = text.toLowerCase();
  // 连续子串优先
  const at = t.indexOf(q);
  if (at >= 0) {
    return { score: 100 - at - (t.length - q.length) * 0.1, idx: Array.from({ length: q.length }, (_, i) => at + i) };
  }
  let qi = 0, last = -2, score = 0;
  const idx: number[] = [];
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      score += last === i - 1 ? 6 : 2;
      if (i === 0 || /[\s\-_/#.·]/.test(t[i - 1])) score += 4;
      idx.push(i);
      last = i;
      qi++;
    }
  }
  return qi === q.length ? { score: score - t.length * 0.05, idx } : null;
}
