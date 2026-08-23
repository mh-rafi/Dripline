import toast, { Toaster as HotToaster, type ToasterProps, type Toast } from "react-hot-toast";
import { CheckCircle, XCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ToastOptions {
  description?: string;
  action?: { label: string; onClick: () => void };
  duration?: number;
  id?: string;
}

const CustomToast = ({ toast: t }: { toast: Toast }) => {
  const getIcon = () => {
    switch (t.type) {
      case "success":
        return <CheckCircle className="text-success h-4 w-4" />;
      case "error":
        return <XCircle className="text-destructive h-4 w-4" />;
      default:
        return <Info className="text-primary h-4 w-4" />;
    }
  };
  return (
    <div
      className={cn(
        "border-border bg-background mx-auto flex max-w-md min-w-[300px] items-center gap-3 rounded-lg border p-4 shadow-lg",
        t.visible
          ? "animate-in slide-in-from-top-2 fade-in duration-200"
          : "animate-out slide-out-to-top-2 fade-out duration-200",
      )}
    >
      {getIcon()}
      <div className="flex-1">
        <div className="text-foreground text-sm font-medium">{String(t.message)}</div>
        {(t as unknown as { description?: string }).description && (
          <div className="text-muted-foreground mt-1 text-sm">
            {(t as unknown as { description?: string }).description}
          </div>
        )}
      </div>
      <button
        onClick={() => toast.dismiss(t.id)}
        className="text-muted-foreground hover:text-foreground transition-colors"
      >
        ×
      </button>
    </div>
  );
};

interface ToasterComponentProps extends ToasterProps {
  className?: string;
}

const Toaster = ({ className, ...props }: ToasterComponentProps) => (
  <HotToaster
    position="top-center"
    containerClassName={cn("toaster", className)}
    toastOptions={{
      duration: 4000,
      removeDelay: 200,
      style: { background: "transparent", border: "none", padding: 0, boxShadow: "none" },
    }}
    {...props}
  >
    {(t: Toast) => <CustomToast toast={t} />}
  </HotToaster>
);

const customToast = (message: string, options?: ToastOptions) =>
  toast.custom(
    (t) => (
      <CustomToast
        toast={
          {
            ...t,
            message,
            ...(options?.description && { description: options.description }),
            ...(options?.action && { action: options.action }),
          } as Toast
        }
      />
    ),
    { id: options?.id, duration: options?.duration || 4000, removeDelay: 200 },
  );

customToast.success = (message: string, options?: ToastOptions) =>
  toast.custom(
    (t) => (
      <CustomToast
        toast={
          {
            ...t,
            type: "success",
            message,
            ...(options?.description && { description: options.description }),
          } as Toast
        }
      />
    ),
    { id: options?.id, duration: options?.duration || 4000, removeDelay: 200 },
  );

customToast.error = (message: string, options?: ToastOptions) =>
  toast.custom(
    (t) => (
      <CustomToast
        toast={
          {
            ...t,
            type: "error",
            message,
            ...(options?.description && { description: options.description }),
          } as Toast
        }
      />
    ),
    { id: options?.id, duration: options?.duration || 4000, removeDelay: 200 },
  );

customToast.dismiss = (id?: string) => toast.dismiss(id);

export { Toaster, customToast as toast };
