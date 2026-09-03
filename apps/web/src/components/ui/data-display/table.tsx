import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Checkbox } from "../data-entry/checkbox";
import { Button } from "../base/button";
import { Tag } from "./tags";

const tableVariants = cva("w-full caption-bottom text-sm");

const tableWrapperVariants = cva("relative w-full", {
  variants: {
    bordered: { true: "border border-border rounded-lg", false: "" },
    scrollable: { true: "overflow-auto", false: "overflow-visible" },
  },
  defaultVariants: { bordered: false, scrollable: true },
});

const tableCellVariants = cva("align-middle [&:has([role=checkbox])]:pr-0", {
  variants: {
    variant: {
      default: "h-12 p-4",
      header: "h-12 px-4 text-left font-medium text-muted-foreground bg-muted/50",
      status: "h-12 p-4 text-left",
      action: "h-12 p-4 text-left",
    },
    cellWidth: {
      auto: "",
      xs: "w-16",
      sm: "w-24",
      md: "w-32",
      lg: "w-48",
      xl: "w-64",
      fit: "whitespace-nowrap",
    },
  },
  defaultVariants: { variant: "default", cellWidth: "auto" },
});

export interface TableWrapperProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof tableWrapperVariants> {}

const TableWrapper = React.forwardRef<HTMLDivElement, TableWrapperProps>(
  ({ className, bordered, scrollable, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(tableWrapperVariants({ bordered, scrollable }), className)}
      {...props}
    />
  ),
);
TableWrapper.displayName = "TableWrapper";

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <table ref={ref} className={cn(tableVariants(), className)} {...props} />
  ),
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }
>(({ className, selected, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "hover:bg-muted data-[state=selected]:bg-muted group border-b transition-colors",
      className,
    )}
    data-state={selected ? "selected" : undefined}
    {...props}
  />
));
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.HTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn("text-muted-foreground bg-muted/50 h-12 px-4 text-left font-medium", className)}
    {...props}
  />
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.HTMLAttributes<HTMLTableCellElement> & VariantProps<typeof tableCellVariants>
>(({ className, variant, cellWidth, ...props }, ref) => (
  <td ref={ref} className={cn(tableCellVariants({ variant, cellWidth }), className)} {...props} />
));
TableCell.displayName = "TableCell";

const TableEmptyState: React.FC<{
  title?: string;
  description?: string;
  action?: React.ReactNode;
}> = ({
  title = "No data available",
  description = "There are no records to display.",
  action,
}) => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <h3 className="text-foreground mb-2 text-lg font-medium">{title}</h3>
    <p className="text-muted-foreground mb-4 max-w-sm text-sm">{description}</p>
    {action}
  </div>
);
TableEmptyState.displayName = "TableEmptyState";

const StatusCell = React.forwardRef<
  HTMLTableCellElement,
  React.HTMLAttributes<HTMLTableCellElement> & {
    status: string;
    variant?: "default" | "success" | "warning" | "destructive" | "primary";
  }
>(({ status, variant, children, ...props }, ref) => (
  <TableCell ref={ref} variant="status" {...props}>
    {children || <Tag variant={variant || "default"}>{status}</Tag>}
  </TableCell>
));
StatusCell.displayName = "StatusCell";

const ActionButtonsCell = React.forwardRef<
  HTMLTableCellElement,
  React.HTMLAttributes<HTMLTableCellElement> & {
    actions: Array<{ label: string; onClick: () => void; variant?: "default" | "destructive" }>;
  }
>(({ actions, ...props }, ref) => (
  <TableCell ref={ref} variant="action" {...props}>
    <div className="flex items-center gap-2">
      {actions.map((action, i) => (
        <Button
          key={i}
          variant="link"
          size="sm"
          className={cn(
            "h-auto p-0 text-sm font-normal",
            action.variant === "destructive" && "text-destructive hover:text-destructive",
          )}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ))}
    </div>
  </TableCell>
));
ActionButtonsCell.displayName = "ActionButtonsCell";

export {
  TableWrapper,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyState,
  StatusCell,
  ActionButtonsCell,
  CheckboxCell,
  CheckboxHeaderCell,
  TablePagination,
};

// --- Checkbox cells ---

const CheckboxCell = React.forwardRef<
  HTMLTableCellElement,
  {
    checked?: boolean;
    indeterminate?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    "aria-label"?: string;
  }
>(({ checked, indeterminate, onCheckedChange, ...props }, ref) => (
  <TableCell ref={ref} cellWidth="xs" {...props}>
    <div className="flex items-center justify-center">
      <Checkbox
        checked={indeterminate ? "indeterminate" : checked}
        onCheckedChange={(v) => onCheckedChange?.(v === true)}
      />
    </div>
  </TableCell>
));
CheckboxCell.displayName = "CheckboxCell";

const CheckboxHeaderCell = React.forwardRef<
  HTMLTableCellElement,
  {
    checked?: boolean;
    indeterminate?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    "aria-label"?: string;
  }
>(({ checked, indeterminate, onCheckedChange, ...props }, ref) => (
  <TableHead ref={ref} {...props}>
    <div className="flex items-center justify-center">
      <Checkbox
        checked={indeterminate ? "indeterminate" : checked}
        onCheckedChange={(v) => onCheckedChange?.(v === true)}
      />
    </div>
  </TableHead>
));
CheckboxHeaderCell.displayName = "CheckboxHeaderCell";

// --- Pagination ---

interface TablePaginationProps {
  current: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}

function TablePagination({
  current,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [20, 50, 100, 200],
}: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startItem = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const endItem = Math.min(current * pageSize, total);

  const pageNumbers: (number | "ellipsis")[] = [];
  const delta = 2;
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pageNumbers.push(i);
  } else {
    pageNumbers.push(1);
    if (current <= delta + 3) {
      for (let i = 2; i <= Math.min(delta + 3, totalPages - 1); i++) pageNumbers.push(i);
      pageNumbers.push("ellipsis");
    } else if (current >= totalPages - delta - 2) {
      pageNumbers.push("ellipsis");
      for (let i = Math.max(totalPages - delta - 2, 2); i <= totalPages - 1; i++)
        pageNumbers.push(i);
    } else {
      pageNumbers.push("ellipsis");
      for (let i = current - delta; i <= current + delta; i++) pageNumbers.push(i);
      pageNumbers.push("ellipsis");
    }
    pageNumbers.push(totalPages);
  }

  const pageSizeSelect = onPageSizeChange && (
    <select
      value={pageSize}
      onChange={(e) => onPageSizeChange(Number(e.target.value))}
      className="border-input h-9 rounded-md border bg-transparent px-2 text-sm sm:h-8"
      aria-label="Rows per page"
    >
      {pageSizeOptions.map((s) => (
        <option key={s} value={s}>
          {s} / page
        </option>
      ))}
    </select>
  );

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center justify-between gap-3 sm:justify-start">
        <div className="text-muted-foreground text-sm">
          {total === 0 ? "No results" : `${startItem}–${endItem} of ${total}`}
        </div>
        <div className="sm:hidden">{pageSizeSelect}</div>
      </div>
      <div className="flex items-center gap-2">
        <div className="hidden sm:block">{pageSizeSelect}</div>
        <div className="flex flex-1 items-center gap-2 sm:flex-none sm:gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-10 flex-1 sm:h-9 sm:flex-none"
            disabled={current <= 1}
            onClick={() => onPageChange(current - 1)}
          >
            Prev
          </Button>
          <span className="text-muted-foreground shrink-0 text-sm tabular-nums sm:hidden">
            Page {current} of {totalPages}
          </span>
          <div className="hidden items-center gap-1 sm:flex">
            {pageNumbers.map((p, i) =>
              p === "ellipsis" ? (
                <span key={`e${i}`} className="text-muted-foreground px-1">
                  …
                </span>
              ) : (
                <Button
                  key={p}
                  variant={p === current ? "default" : "outline"}
                  size="sm"
                  className="min-w-9"
                  onClick={() => onPageChange(p)}
                >
                  {p}
                </Button>
              ),
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-10 flex-1 sm:h-9 sm:flex-none"
            disabled={current >= totalPages}
            onClick={() => onPageChange(current + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
TablePagination.displayName = "TablePagination";
