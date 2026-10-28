import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Description } from "@headlessui/react";
import { cn } from "@/lib/utils";
import { X } from "@/lib/icons";
import { Button } from "./button";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children?: any;
  footer?: any;
  size?: "sm" | "md" | "lg";
  className?: string;
  hideClose?: boolean;
}

const SIZE = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-xl" };

export function Modal({ open, onClose, title, description, children, footer, size = "md", className, hideClose }: ModalProps) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-[70]">
      <DialogBackdrop transition className="fixed inset-0 bg-scrim backdrop-blur-[2px] transition duration-150 ease-out data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel
          transition
          className={cn(
            "w-full rounded-xl border border-border bg-popover text-foreground shadow-pop outline-none transition duration-150 ease-out data-[closed]:scale-[0.97] data-[closed]:opacity-0",
            SIZE[size],
            className,
          )}
        >
          {(title || !hideClose) && (
            <div className="flex items-start gap-3 px-5 pt-4">
              <div className="min-w-0 flex-1">
                {title && <DialogTitle className="text-base font-semibold leading-6">{title}</DialogTitle>}
                {description && <Description className="mt-1 text-sm leading-5 text-muted-foreground">{description}</Description>}
              </div>
              {!hideClose && (
                <Button variant="ghost" size="icon-sm" aria-label="关闭" onClick={onClose} className="-mr-2 -mt-1">
                  <X />
                </Button>
              )}
            </div>
          )}
          {children && <div className="px-5 py-4">{children}</div>}
          {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
