import { cn } from "@/lib/utils";

/** 闪烁文字（Magic UI「Animated Shiny Text」的思路，自行实现）：用于“正在思考/正在执行” */
export function ShimmerText({ children, className }: { children: any; className?: string }) {
  return <span className={cn("shimmer-text", className)}>{children}</span>;
}

/** 边缘光束：包住输入框，仅在执行中显示，尊重 reduced-motion */
export function BeamFrame({ active, children, className }: { active: boolean; children: any; className?: string }) {
  return <div className={cn(active && "beam", className)}>{children}</div>;
}

/** 点阵底纹，用于空状态与向导侧栏 */
export function DotPattern({ className }: { className?: string }) {
  return <div aria-hidden className={cn("dot-pattern pointer-events-none absolute inset-0", className)} />;
}

/** 单行骨架 */
export function Skeleton({ className, style }: { className?: string; style?: Record<string, any> }) {
  return <div className={cn("skeleton", className)} style={style} aria-hidden />;
}
