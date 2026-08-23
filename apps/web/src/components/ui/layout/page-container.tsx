import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const pageContainerVariants = cva("h-full w-full bg-sidebar", {
  variants: { padding: { default: "p-2", "nav-layout": "pb-4 px-6" } },
  defaultVariants: { padding: "default" },
});

const containerVariants = cva(
  "rounded-xl border border-container-border bg-container text-container-foreground shadow-2xs h-full overflow-auto",
);

const contentVariants = cva("py-10", {
  variants: {
    variant: { full: "max-w-[1440px] mx-auto px-8", centered: "w-[768px] max-w-[90vw] mx-auto" },
  },
  defaultVariants: { variant: "full" },
});

export interface PageContainerProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof pageContainerVariants> {
  variant?: "full" | "centered";
}

const PageContainer = React.forwardRef<HTMLDivElement, PageContainerProps>(
  ({ className, variant = "full", padding = "default", children, ...props }, ref) => (
    <div className={cn(pageContainerVariants({ padding }))}>
      <div className={cn(containerVariants(), "w-full", className)} ref={ref} {...props}>
        <div className={cn(contentVariants({ variant }))}>{children}</div>
      </div>
    </div>
  ),
);
PageContainer.displayName = "PageContainer";

export { PageContainer };
