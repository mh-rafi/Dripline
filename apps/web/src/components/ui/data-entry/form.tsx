import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Label } from "../base/label";
import { Typography } from "../base/typography";

const formVariants = cva("w-full", {
  variants: { layout: { default: "space-y-6", grid: "space-y-6", sectioned: "space-y-10" } },
  defaultVariants: { layout: "default" },
});

interface FormProps extends React.FormHTMLAttributes<HTMLFormElement> {
  layout?: "default" | "grid" | "sectioned";
}

const Form = React.forwardRef<HTMLFormElement, FormProps>(
  ({ className, layout = "default", ...props }, ref) => (
    <form ref={ref} className={cn(formVariants({ layout }), className)} {...props} />
  ),
);
Form.displayName = "Form";

interface FormRowProps extends React.HTMLAttributes<HTMLDivElement> {
  spacing?: "sm" | "md" | "lg";
  columns?: number;
}

const FormRow = React.forwardRef<HTMLDivElement, FormRowProps>(
  ({ className, spacing = "md", columns = 2, ...props }, ref) => {
    const colMap: Record<number, string> = {
      1: "grid-cols-1",
      2: "grid-cols-1 md:grid-cols-2",
      3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
      4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
    };
    const gapMap = { sm: "gap-2", md: "gap-4", lg: "gap-6" };
    return (
      <div
        ref={ref}
        className={cn("grid", colMap[columns] || colMap[2]!, gapMap[spacing], className)}
        {...props}
      />
    );
  },
);
FormRow.displayName = "FormRow";

interface FormSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
}

const FormSection = React.forwardRef<HTMLDivElement, FormSectionProps>(
  ({ className, title, subtitle, children, ...props }, ref) => (
    <div ref={ref} className={cn("space-y-4", className)} {...props}>
      {(title || subtitle) && (
        <div>
          {title && <Typography variant="h3">{title}</Typography>}
          {subtitle && <Typography variant="muted">{subtitle}</Typography>}
        </div>
      )}
      {children}
    </div>
  ),
);
FormSection.displayName = "FormSection";

const FormItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("space-y-2", className)} {...props} />
  ),
);
FormItem.displayName = "FormItem";

const FormLabel = React.forwardRef<
  React.ElementRef<typeof Label>,
  React.ComponentPropsWithoutRef<typeof Label> & { required?: boolean }
>(({ className, required, children, ...props }, ref) => (
  <Label ref={ref} className={cn(className)} required={required} {...props}>
    {children}
  </Label>
));
FormLabel.displayName = "FormLabel";

const FormControl = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("relative w-full", className)} {...props} />
  ),
);
FormControl.displayName = "FormControl";

const FormDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-muted-foreground text-xs", className)} {...props} />
));
FormDescription.displayName = "FormDescription";

const FormMessage = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement> & { error?: boolean }
>(({ className, children, error, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground", className)}
    {...props}
  >
    {children}
  </p>
));
FormMessage.displayName = "FormMessage";

const FormButtons = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { layout?: "full" | "right" }
>(({ className, layout = "right", ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex gap-3", layout === "full" ? "w-full" : "justify-end", className)}
    {...props}
  />
));
FormButtons.displayName = "FormButtons";

export {
  Form,
  FormRow,
  FormSection,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormButtons,
};
