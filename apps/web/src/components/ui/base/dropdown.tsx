import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const dropdownContentVariants = cva(
  "z-50 rounded-md border bg-popover text-popover-foreground shadow-md outline-none duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top data-[side=left]:slide-in-from-right data-[side=right]:slide-in-from-left data-[side=top]:slide-in-from-bottom",
  {
    variants: {
      size: { sm: "min-w-32", md: "min-w-48", lg: "min-w-64", auto: "w-auto", full: "w-full" },
    },
    defaultVariants: { size: "md" },
  },
);

const Dropdown = PopoverPrimitive.Root;
const DropdownAnchor = PopoverPrimitive.Anchor;

const DropdownTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger> & { asChild?: boolean }
>(({ children, asChild, ...props }, ref) =>
  asChild ? (
    <PopoverPrimitive.Trigger ref={ref} asChild {...props}>
      {children}
    </PopoverPrimitive.Trigger>
  ) : (
    <PopoverPrimitive.Trigger ref={ref} {...props}>
      {children}
    </PopoverPrimitive.Trigger>
  ),
);
DropdownTrigger.displayName = "DropdownTrigger";

const DropdownContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
    size?: "sm" | "md" | "lg" | "auto" | "full";
    container?: HTMLElement | null;
  }
>(
  (
    { className, children, size = "md", container, align = "start", sideOffset = 4, ...props },
    ref,
  ) => (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        hideWhenDetached
        className={cn(dropdownContentVariants({ size }), className)}
        {...props}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  ),
);
DropdownContent.displayName = "DropdownContent";

const DropdownItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { disabled?: boolean }
>(({ className, children, disabled, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-pointer items-center rounded-sm py-1.5 pr-8 pl-2 text-sm transition-colors outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      disabled && "pointer-events-none opacity-50",
      className,
    )}
    data-disabled={disabled}
    {...props}
  >
    {children}
  </div>
));
DropdownItem.displayName = "DropdownItem";

const DropdownSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("bg-muted -mx-1 my-1 h-px", className)} {...props} />
  ),
);
DropdownSeparator.displayName = "DropdownSeparator";

const DropdownLabel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("px-2 py-1.5 text-sm font-medium", className)} {...props} />
  ),
);
DropdownLabel.displayName = "DropdownLabel";

export {
  Dropdown,
  DropdownAnchor,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  DropdownLabel,
};
