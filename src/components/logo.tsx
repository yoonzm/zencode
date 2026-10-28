import { cn } from "@/lib/utils";

/** ZenCode 标记：一笔未完全闭合的圆（禅宗圆相）加一个落点。原创图形。 */
export function Logo({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={cn("shrink-0", className)} aria-hidden>
      <path d="M12 3.2a8.8 8.8 0 1 0 8.4 6.2" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="19.6" cy="5.4" r="1.9" className="fill-accent" />
    </svg>
  );
}
