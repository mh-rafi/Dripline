import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Tag } from "../data-display/tags";

const selectTriggerVariants = cva(
  "group flex items-center justify-between gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted border border-input bg-transparent hover:bg-accent hover:text-accent-foreground disabled:hover:bg-transparent h-9 rounded-md text-sm data-[placeholder]:text-muted-foreground [&>span]:line-clamp-1 cursor-pointer",
  {
    variants: {
      display: { "text-only": "px-3", "with-icon": "px-3" },
      mode: { single: "", multiple: "min-h-9 h-auto py-1 px-3" },
      width: { auto: "w-auto min-w-[180px]", full: "w-full" },
    },
    defaultVariants: { display: "text-only", mode: "single", width: "full" },
  },
);

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

interface SelectTriggerBaseProps
  extends
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>,
    VariantProps<typeof selectTriggerVariants> {
  icon?: React.ReactNode;
  width?: "auto" | "full";
}

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  SelectTriggerBaseProps
>(
  (
    { className, children, display = "text-only", mode = "single", width = "full", icon, ...props },
    ref,
  ) => (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(selectTriggerVariants({ display, mode, width, className }))}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {display === "with-icon" && icon && <span className="flex-shrink-0">{icon}</span>}
        <div className="flex-1 truncate text-left">{children}</div>
      </div>
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 flex-shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  ),
);
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

interface MultiSelectTriggerProps extends Omit<SelectTriggerBaseProps, "mode"> {
  selectedValues?: string[];
  selectedLabels?: Record<string, string>;
  onRemoveValue?: (value: string) => void;
  placeholder?: string;
  maxDisplay?: number;
}

const MultiSelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  MultiSelectTriggerProps
>(
  (
    {
      className,
      display = "text-only",
      icon,
      selectedValues = [],
      selectedLabels = {},
      onRemoveValue,
      placeholder = "Select...",
      maxDisplay = 3,
      ...props
    },
    ref,
  ) => {
    const hasSelection = selectedValues.length > 0;
    const displayValues = selectedValues.slice(0, maxDisplay);
    const remainingCount = selectedValues.length - maxDisplay;
    return (
      <SelectPrimitive.Trigger
        ref={ref}
        className={cn(selectTriggerVariants({ display, mode: "multiple", className }))}
        onPointerDown={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('button[aria-label="Remove tag"]')) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if (target.closest(".select-tag")) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        {...props}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {display === "with-icon" && icon && <span className="flex-shrink-0">{icon}</span>}
          <div className="flex min-h-[1.5rem] min-w-0 flex-1 flex-wrap items-center gap-1">
            {hasSelection ? (
              <>
                {displayValues.map((value) => (
                  <Tag
                    key={value}
                    variant="default"
                    className="select-tag"
                    onRemove={onRemoveValue ? () => onRemoveValue(value) : undefined}
                  >
                    {selectedLabels[value] || value}
                  </Tag>
                ))}
                {remainingCount > 0 && <Tag variant="default">+{remainingCount}</Tag>}
              </>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </div>
        </div>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="h-4 w-4 flex-shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
    );
  },
);
MultiSelectTrigger.displayName = "MultiSelectTrigger";

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top data-[side=left]:slide-in-from-right data-[side=right]:slide-in-from-left data-[side=top]:slide-in-from-bottom relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border shadow-md duration-300",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className,
      )}
      position={position}
      {...props}
    >
      <SelectPrimitive.ScrollUpButton className="flex cursor-pointer items-center justify-center py-1">
        <ChevronUp className="h-4 w-4" />
      </SelectPrimitive.ScrollUpButton>
      <SelectPrimitive.Viewport
        className={cn(
          "p-1",
          position === "popper" && "h-[var(--radix-select-trigger-height)] w-max min-w-[8rem]",
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectPrimitive.ScrollDownButton className="flex cursor-pointer items-center justify-center py-1">
        <ChevronDown className="h-4 w-4" />
      </SelectPrimitive.ScrollDownButton>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-pointer items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

// `onToggle` is dropped alongside `onSelect`: React 19's types add a native
// `onToggle` DOM handler whose signature this component's own callback
// deliberately differs from.
interface MultiSelectItemProps extends Omit<
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>,
  "onSelect" | "onToggle"
> {
  value: string;
  selected?: boolean;
  onToggle?: (value: string, selected: boolean) => void;
}

const MultiSelectItem = React.forwardRef<HTMLDivElement, MultiSelectItemProps>(
  ({ className, children, value, selected = false, onToggle, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-pointer items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        selected && "bg-accent text-accent-foreground",
        className,
      )}
      onClick={() => onToggle?.(value, !selected)}
      {...props}
    >
      <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
        {selected && <Check className="h-4 w-4" />}
      </span>
      <span className="flex-1">{children}</span>
    </div>
  ),
);
MultiSelectItem.displayName = "MultiSelectItem";

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("bg-muted -mx-1 my-1 h-px", className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  MultiSelectTrigger,
  SelectContent,
  SelectItem,
  MultiSelectItem,
  SelectSeparator,
  selectTriggerVariants,
};
