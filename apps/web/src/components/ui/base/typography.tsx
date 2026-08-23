import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const typographyVariants = cva("", {
  variants: {
    variant: {
      h1: "text-2xl font-medium leading-none",
      h2: "text-xl font-medium leading-none",
      h3: "text-lg leading-none",
      body: "text-sm leading-normal",
      muted: "text-xs text-muted-foreground leading-none",
    },
  },
  defaultVariants: { variant: "body" },
});

const getElementForVariant = (variant: string) => {
  const map: Record<string, string> = { h1: "h1", h2: "h2", h3: "h3", body: "p", muted: "span" };
  return map[variant] || "span";
};

export interface TypographyProps
  extends React.HTMLAttributes<HTMLElement>, VariantProps<typeof typographyVariants> {
  asChild?: boolean;
  as?: keyof React.JSX.IntrinsicElements;
}

const Typography = React.forwardRef<HTMLElement, TypographyProps>(
  ({ className, variant = "body", asChild = false, as, children, ...props }, ref) => {
    const defaultElement = getElementForVariant(variant as string);
    const Comp = asChild ? Slot : as || defaultElement;
    return (
      <Comp
        className={cn(typographyVariants({ variant, className }))}
        ref={ref as React.Ref<HTMLElement>}
        {...props}
      >
        {children}
      </Comp>
    );
  },
);
Typography.displayName = "Typography";

export { Typography, typographyVariants };
