import * as React from "react";
import { Loader } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { Button as ShadcnButton, buttonVariants } from "./primitives/button";

export { buttonVariants };

export interface ButtonProps extends React.ComponentProps<typeof ShadcnButton> {
  loading?: boolean;
}

/** 项目按钮：shadcn Button 加加载态。 */
export function Button({ loading, disabled, children, type = "button", className, ...rest }: ButtonProps) {
  return (
    <ShadcnButton type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={cn(className)} {...rest}>
      {loading ? <Loader className="animate-spin" aria-hidden /> : null}
      {children}
    </ShadcnButton>
  );
}
