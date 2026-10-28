import { useState } from "react";
import { FloatingPortal, autoUpdate, flip, offset, shift, useDismiss, useFloating, useFocus, useHover, useInteractions, useRole } from "@floating-ui/react";
import { Kbd } from "./kbd";

interface TipProps {
  label: string;
  keys?: string[];
  side?: "top" | "bottom" | "left" | "right";
  children: any;
  className?: string;
}

export function Tip({ label, keys, side = "bottom", children, className }: TipProps) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: side,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { move: false, delay: { open: 420, close: 0 } }),
    useFocus(context),
    useDismiss(context),
    useRole(context, { role: "tooltip" }),
  ]);
  return (
    <>
      <span ref={refs.setReference} {...getReferenceProps()} className={className ?? "inline-flex"}>
        {children}
      </span>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="anim-fade pointer-events-none z-[80] flex items-center gap-2 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground shadow-pop"
          >
            {label}
            {keys && <Kbd keys={keys} className="opacity-90 [&_kbd]:border-primary-foreground/30 [&_kbd]:bg-transparent [&_kbd]:text-primary-foreground [&_kbd]:shadow-none" />}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
