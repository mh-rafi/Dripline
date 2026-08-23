import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Button } from "../base/button";
import { cn } from "@/lib/utils";

export interface PopconfirmProps {
  children: React.ReactNode;
  title?: string;
  description: string;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
  confirmText?: string;
  cancelText?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  placement?: "top" | "bottom" | "left" | "right";
  className?: string;
}

const Popconfirm = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  PopconfirmProps
>(
  (
    {
      children,
      title,
      description,
      onConfirm,
      onCancel,
      confirmText = "Confirm",
      cancelText = "Cancel",
      open,
      onOpenChange,
      disabled = false,
      placement = "top",
      className,
    },
    ref,
  ) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const [isConfirming, setIsConfirming] = React.useState(false);

    const handleOpenChange = (openState: boolean) => {
      if (disabled && openState) return;
      const next = open !== undefined ? open : openState;
      setIsOpen(next);
      onOpenChange?.(next);
    };

    const handleConfirm = async () => {
      if (!onConfirm) return;
      setIsConfirming(true);
      try {
        await onConfirm();
        handleOpenChange(false);
      } finally {
        setIsConfirming(false);
      }
    };

    const handleCancel = () => {
      onCancel?.();
      handleOpenChange(false);
    };

    const openState = open !== undefined ? open : isOpen;

    return (
      <PopoverPrimitive.Root open={openState} onOpenChange={handleOpenChange}>
        <PopoverPrimitive.Trigger asChild disabled={disabled}>
          {children}
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            ref={ref}
            side={placement}
            sideOffset={8}
            className={cn(
              "bg-popover text-popover-foreground border-border/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top data-[side=left]:slide-in-from-right data-[side=right]:slide-in-from-left data-[side=top]:slide-in-from-bottom z-[100] w-auto max-w-sm rounded-lg border p-4 shadow-lg backdrop-blur-sm outline-none",
              className,
            )}
          >
            <div className="space-y-3">
              {title && <div className="text-foreground text-sm font-medium">{title}</div>}
              <div className="text-muted-foreground text-sm">{description}</div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={handleCancel} disabled={isConfirming}>
                  {cancelText}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleConfirm}
                  disabled={isConfirming}
                >
                  {isConfirming ? "..." : confirmText}
                </Button>
              </div>
            </div>
            <PopoverPrimitive.Arrow className="fill-popover" width={12} height={6} />
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    );
  },
);
Popconfirm.displayName = "Popconfirm";

export { Popconfirm };
