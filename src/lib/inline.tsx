import type { ReactNode } from "react";

/** 轻量行内渲染：`代码` 与 **加粗**。不使用 dangerouslySetInnerHTML。 */
export function Inline({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push(
        <code key={k++} className="rounded-sm bg-muted px-1 py-px font-mono text-[0.92em] text-foreground">
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(<strong key={k++} className="font-semibold text-foreground">{tok.slice(2, -2)}</strong>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
