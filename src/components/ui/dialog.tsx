import * as React from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./primitives/dialog";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
  hideClose?: boolean;
}

const SIZE = { sm: "sm:max-w-sm", md: "sm:max-w-md", lg: "sm:max-w-xl" };

/** 弹窗：shadcn Dialog（Radix）。标题缺省时用隐藏标题满足无障碍要求。 */
export function Modal({ open, onClose, title, description, children, footer, size = "md", className, hideClose }: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={!hideClose}
        aria-describedby={description ? undefined : undefined}
        className={cn("gap-0 rounded-xl border-border bg-popover p-0 shadow-pop", SIZE[size], className)}
      >
        <DialogHeader className={cn("px-5 pt-4 text-left", !title && !description && "sr-only")}>
          <DialogTitle className={cn("text-base leading-6", !title && "sr-only")}>{title ?? "对话框"}</DialogTitle>
          <DialogDescription className={cn("text-sm leading-5", !description && "sr-only")}>{description ?? " "}</DialogDescription>
        </DialogHeader>
        {children && <div className="px-5 py-4">{children}</div>}
        {footer && <DialogFooter className="flex-row items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
