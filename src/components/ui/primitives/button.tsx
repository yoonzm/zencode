import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-100 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 active:translate-y-px [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/88",
        accent: "bg-accent text-accent-foreground shadow-sm hover:bg-accent/90",
        secondary: "border border-border-strong bg-card text-foreground shadow-sm hover:bg-muted",
        ghost: "text-muted-foreground hover:bg-hover hover:text-foreground active:bg-active",
        subtle: "bg-muted text-foreground hover:bg-active",
        danger: "bg-danger text-white shadow-sm hover:bg-danger/90",
        "danger-ghost": "text-danger hover:bg-danger/10",
      },
      size: {
        xs: "h-6 px-2 text-xs [&_svg]:size-3.5",
        sm: "h-7 px-2.5 text-sm [&_svg]:size-4",
        md: "h-8 px-3 text-sm [&_svg]:size-4",
        lg: "h-9 px-4 text-base [&_svg]:size-4",
        "icon-xs": "size-6 [&_svg]:size-3.5",
        "icon-sm": "size-7 [&_svg]:size-4",
        icon: "size-8 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
