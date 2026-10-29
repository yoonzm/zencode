import * as React from "react";
import { cn } from "@/lib/utils";
import { AnimatedShinyText } from "@/components/ui/primitives/animated-shiny-text";
import { BorderBeam } from "@/components/ui/primitives/border-beam";
import { DotPattern as MagicDotPattern } from "@/components/ui/primitives/dot-pattern";
import { Skeleton as ShadSkeleton } from "@/components/ui/primitives/skeleton";

/** 闪烁文字：Magic UI「Animated Shiny Text」，用于“正在思考/正在执行”。 */
export function ShimmerText({ children, className }: { children: React.ReactNode; className?: string }) {
  return <AnimatedShinyText className={className} shimmerWidth={120}>{children}</AnimatedShinyText>;
}

/** 边缘光束：Magic UI「Border Beam」，包住输入框，仅在执行中显示。 */
export function BeamFrame({ active, children, className }: { active: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      {children}
      {active && <BorderBeam size={90} duration={5} borderWidth={1.5} colorFrom="var(--accent)" colorTo="var(--success)" className="motion-reduce:hidden" />}
    </div>
  );
}

/** 点阵底纹：Magic UI「Dot Pattern」，用于空状态与向导侧栏。 */
export function DotPattern({ className }: { className?: string }) {
  return (
    <MagicDotPattern
      aria-hidden
      width={18}
      height={18}
      cr={1}
      className={cn("pointer-events-none fill-foreground/12 [mask-image:radial-gradient(420px_circle_at_center,white,transparent)]", className)}
    />
  );
}

/** 骨架：shadcn Skeleton。 */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <ShadSkeleton className={cn("bg-muted", className)} style={style} aria-hidden />;
}
