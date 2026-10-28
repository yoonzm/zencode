const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function ago(minutes: number) {
  return Date.now() - minutes * MIN;
}
export function inDays(days: number) {
  return Date.now() + days * DAY;
}

export function relTime(ts: number, now = Date.now()): string {
  const d = now - ts;
  if (d < 0) {
    const f = -d;
    if (f < HOUR) return `${Math.max(1, Math.round(f / MIN))} 分钟后`;
    if (f < DAY) return `${Math.round(f / HOUR)} 小时后`;
    return `${Math.round(f / DAY)} 天后`;
  }
  if (d < 45_000) return "刚刚";
  if (d < HOUR) return `${Math.max(1, Math.round(d / MIN))} 分钟前`;
  if (d < DAY) return `${Math.round(d / HOUR)} 小时前`;
  if (d < 2 * DAY) return "昨天";
  if (d < 14 * DAY) return `${Math.round(d / DAY)} 天前`;
  const dt = new Date(ts);
  return `${dt.getMonth() + 1} 月 ${dt.getDate()} 日`;
}

/** 紧凑相对时间，用于列表行：3m / 2h / 5d */
export function shortTime(ts: number, now = Date.now()): string {
  const d = now - ts;
  if (d < 45_000) return "刚刚";
  if (d < HOUR) return `${Math.max(1, Math.round(d / MIN))} 分`;
  if (d < DAY) return `${Math.round(d / HOUR)} 小时`;
  if (d < 14 * DAY) return `${Math.round(d / DAY)} 天`;
  const dt = new Date(ts);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

export function clockTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分 ${String(s % 60).padStart(2, "0")} 秒`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 截止日期标签：按自然日计算 */
export function dueLabel(ts: number, now = Date.now()): { text: string; tone: "overdue" | "soon" | "normal" } {
  const a = new Date(ts);
  const b = new Date(now);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  const days = Math.round((a.getTime() - b.getTime()) / DAY);
  if (days < 0) return { text: "已逾期", tone: "overdue" };
  if (days === 0) return { text: "今天截止", tone: "soon" };
  if (days === 1) return { text: "明天截止", tone: "soon" };
  return { text: `${days} 天后截止`, tone: "normal" };
}
