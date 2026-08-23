import * as React from "react";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface LogoProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "image" | "placeholder";
}

const Logo = React.forwardRef<HTMLDivElement, LogoProps>(
  ({ variant = "placeholder", className, ...props }, ref) => {
    if (variant === "placeholder") {
      return (
        <div ref={ref} className={cn("flex h-8 items-center gap-2", className)} {...props}>
          <Zap className="text-primary h-5 w-5" />
          <span className="text-foreground text-base font-medium">Dripline</span>
        </div>
      );
    }
    return <div ref={ref} className={cn("flex h-6 items-center", className)} {...props} />;
  },
);
Logo.displayName = "Logo";

export { Logo };
