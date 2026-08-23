import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const blockLayoutVariants = cva(
  "rounded-lg border border-block-layout-border bg-block-layout text-block-layout-foreground shadow-xs",
  {
    variants: {
      padding: { sm: "p-4", default: "p-6" },
      shadow: { none: "shadow-none", xs: "shadow-xs" },
      rounded: { md: "rounded-md", lg: "rounded-lg" },
    },
    defaultVariants: { padding: "default", shadow: "xs", rounded: "lg" },
  },
);

export interface BlockLayoutProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof blockLayoutVariants> {}

const BlockLayout = React.forwardRef<HTMLDivElement, BlockLayoutProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn(blockLayoutVariants({ className }))} {...props} />
  ),
);
BlockLayout.displayName = "BlockLayout";

export { BlockLayout };
