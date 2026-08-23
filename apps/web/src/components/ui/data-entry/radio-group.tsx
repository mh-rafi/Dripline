import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const radioGroupVariants = cva("grid gap-3", {
  variants: {
    variant: { default: "", cards: "lg:grid-cols-2 items-start" },
    layout: { vertical: "", horizontal: "grid-flow-col auto-cols-fr" },
  },
  defaultVariants: { variant: "default", layout: "vertical" },
});

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root> &
    VariantProps<typeof radioGroupVariants>
>(({ className, variant, layout, ...props }, ref) => (
  <RadioGroupPrimitive.Root
    className={cn(radioGroupVariants({ variant, layout }), className)}
    {...props}
    ref={ref}
  />
));
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    className={cn(
      "border-input text-primary ring-offset-background focus-visible:ring-ring data-[state=checked]:border-input hover:border-primary/70 aspect-square h-4 w-4 cursor-pointer rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="h-2.5 w-2.5 fill-current text-current"
      >
        <circle cx="12" cy="12" r="10" />
      </svg>
    </RadioGroupPrimitive.Indicator>
  </RadioGroupPrimitive.Item>
));
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;

const RadioGroupLabel = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, children, ...props }, ref) => (
  <label
    ref={ref}
    className={cn("flex cursor-pointer items-center space-x-2 text-sm leading-none", className)}
    {...props}
  >
    {children}
  </label>
));
RadioGroupLabel.displayName = "RadioGroupLabel";

export { RadioGroup, RadioGroupItem, RadioGroupLabel };
