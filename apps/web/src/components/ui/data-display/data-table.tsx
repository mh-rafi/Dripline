import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "../base/button";
import { Dropdown, DropdownTrigger, DropdownContent, DropdownItem } from "../base/dropdown";
import { Checkbox } from "../data-entry/checkbox";
import { Popconfirm } from "../feedback/popconfirm";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../feedback/dialog";
import {
  TableWrapper,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyState,
  CheckboxCell,
  CheckboxHeaderCell,
} from "./table";

/**
 * One column definition drives both renderings: a real `<table>` from `md` up,
 * and a stacked card list below it. `mobile` says what the column becomes on a
 * phone -- horizontal scrolling a six-column table loses the row identity as
 * soon as you scroll past the first cell, so entity lists collapse to cards
 * instead. Numeric matrices (step reports, link clicks) are the exception and
 * should keep using `TableWrapper` + a sticky first column directly.
 */
export type DataTableMobileRole = "title" | "subtitle" | "status" | "meta" | "hidden";

export interface DataTableColumn<T> {
  key: string;
  header?: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  mobile?: DataTableMobileRole;
  mobileLabel?: string;
  align?: "left" | "right";
  className?: string;
  headClassName?: string;
}

export interface DataTableAction {
  label: string;
  onClick: () => void | Promise<void>;
  variant?: "default" | "destructive";
  icon?: React.ReactNode;
  appearance?: "link" | "outline" | "destructive" | "icon";
  disabled?: boolean;
  confirm?: { title?: string; description: string; confirmText?: string };
}

export interface DataTableSelection<T> {
  isSelected: (row: T) => boolean;
  onToggleRow: (row: T) => void;
  rowLabel?: (row: T) => string;
  allSelected?: boolean;
  someSelected?: boolean;
  onToggleAll?: (checked: boolean) => void;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => React.Key;
  rowActions?: (row: T) => DataTableAction[];
  actionsHeader?: React.ReactNode;
  selection?: DataTableSelection<T>;
  empty?: React.ReactNode;
  className?: string;
}

function labelOf<T>(column: DataTableColumn<T>): string {
  if (column.mobileLabel) return column.mobileLabel;
  return typeof column.header === "string" ? column.header : "";
}

function RowActionsMenu({
  actions,
  onRequestConfirm,
}: {
  actions: DataTableAction[];
  onRequestConfirm: (action: DataTableAction) => void;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Dropdown open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild>
        <Button
          variant="ghost"
          size="sm-icon"
          allowNoTooltip
          aria-label="Row actions"
          className="h-10 w-10 shrink-0"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownTrigger>
      <DropdownContent align="end" size="sm" className="p-1">
        {actions.map((action) => (
          <DropdownItem
            key={action.label}
            disabled={action.disabled}
            className={cn(
              "gap-2 py-2.5 pr-2",
              action.variant === "destructive" && "text-destructive",
            )}
            onClick={() => {
              setOpen(false);
              if (action.confirm) onRequestConfirm(action);
              else void action.onClick();
            }}
          >
            {action.icon}
            {action.label}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}

function InlineRowActions({ actions }: { actions: DataTableAction[] }) {
  const dense = actions.some((a) => a.appearance === "icon");
  return (
    <div className={cn("flex items-center justify-end", dense ? "gap-1" : "gap-2")}>
      {actions.map((action) => {
        const onClick = action.confirm ? undefined : () => void action.onClick();
        const button =
          action.appearance === "icon" && action.icon ? (
            <Button
              variant="ghost"
              size="sm-icon"
              tooltip={action.label}
              disabled={action.disabled}
              onClick={onClick}
            >
              {action.icon}
            </Button>
          ) : action.appearance === "outline" || action.appearance === "destructive" ? (
            <Button
              variant={action.appearance === "destructive" ? "destructive" : "outline"}
              size="sm"
              disabled={action.disabled}
              onClick={onClick}
            >
              {action.label}
            </Button>
          ) : (
            <Button
              variant="link"
              size="sm"
              disabled={action.disabled}
              className={cn(
                "h-auto p-0 text-sm font-normal",
                action.variant === "destructive" && "text-destructive hover:text-destructive",
              )}
              onClick={onClick}
            >
              {action.label}
            </Button>
          );
        return action.confirm ? (
          <Popconfirm
            key={action.label}
            title={action.confirm.title}
            description={action.confirm.description}
            confirmText={action.confirm.confirmText ?? action.label}
            onConfirm={action.onClick}
            disabled={action.disabled}
          >
            {button}
          </Popconfirm>
        ) : (
          <React.Fragment key={action.label}>{button}</React.Fragment>
        );
      })}
    </div>
  );
}

function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowActions,
  actionsHeader = "Actions",
  selection,
  empty,
  className,
}: DataTableProps<T>) {
  const [pending, setPending] = React.useState<DataTableAction | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  const titleColumn = columns.find((c) => c.mobile === "title") ?? columns[0];
  const subtitleColumn = columns.find((c) => c.mobile === "subtitle");
  const statusColumn = columns.find((c) => c.mobile === "status");
  const metaColumns = columns.filter(
    (c) => c !== titleColumn && c !== subtitleColumn && c !== statusColumn && c.mobile !== "hidden",
  );

  const container = cn(
    "border-block-layout-border bg-block-layout text-block-layout-foreground overflow-hidden rounded-lg border shadow-xs",
    className,
  );

  async function runPending() {
    if (!pending) return;
    setConfirming(true);
    try {
      await pending.onClick();
      setPending(null);
    } finally {
      setConfirming(false);
    }
  }

  if (rows.length === 0) {
    return <div className={container}>{empty ?? <TableEmptyState />}</div>;
  }

  return (
    <>
      <div className={container}>
        <TableWrapper className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                {selection &&
                  (selection.onToggleAll ? (
                    <CheckboxHeaderCell
                      checked={selection.allSelected}
                      indeterminate={selection.someSelected && !selection.allSelected}
                      onCheckedChange={selection.onToggleAll}
                      aria-label="Select all on this page"
                    />
                  ) : (
                    <TableHead className="w-16" />
                  ))}
                {columns.map((column) => (
                  <TableHead
                    key={column.key}
                    className={cn(column.align === "right" && "text-right", column.headClassName)}
                  >
                    {column.header}
                  </TableHead>
                ))}
                {rowActions && <TableHead className="text-right">{actionsHeader}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const actions = rowActions?.(row) ?? [];
                return (
                  <TableRow key={rowKey(row)} selected={selection?.isSelected(row)}>
                    {selection && (
                      <CheckboxCell
                        checked={selection.isSelected(row)}
                        onCheckedChange={() => selection.onToggleRow(row)}
                        aria-label={selection.rowLabel?.(row) ?? "Select row"}
                      />
                    )}
                    {columns.map((column) => (
                      <TableCell
                        key={column.key}
                        className={cn(column.align === "right" && "text-right", column.className)}
                      >
                        {column.cell(row)}
                      </TableCell>
                    ))}
                    {rowActions && (
                      <TableCell className="text-right">
                        <InlineRowActions actions={actions} />
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableWrapper>

        <div className="md:hidden">
          {selection?.onToggleAll && (
            <label className="bg-muted/50 border-border flex items-center gap-3 border-b px-4 py-3 text-sm">
              <Checkbox
                checked={
                  selection.someSelected && !selection.allSelected
                    ? "indeterminate"
                    : selection.allSelected
                }
                onCheckedChange={(v) => selection.onToggleAll?.(v === true)}
              />
              Select all on this page
            </label>
          )}
          <ul className="divide-border divide-y">
            {rows.map((row) => {
              const actions = rowActions?.(row) ?? [];
              const meta = metaColumns
                .map((column) => ({ column, value: column.cell(row) }))
                .filter(({ value }) => value !== null && value !== undefined && value !== "");
              return (
                <li
                  key={rowKey(row)}
                  className={cn(
                    "flex items-start gap-3 p-4",
                    selection?.isSelected(row) && "bg-muted",
                  )}
                >
                  {selection && (
                    <div className="pt-0.5">
                      <Checkbox
                        checked={selection.isSelected(row)}
                        onCheckedChange={() => selection.onToggleRow(row)}
                        aria-label={selection.rowLabel?.(row) ?? "Select row"}
                      />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="line-clamp-2 min-w-0 flex-1 text-sm font-medium break-words">
                        {titleColumn?.cell(row)}
                      </div>
                      {statusColumn && (
                        <div className="flex max-w-[50%] shrink-0 flex-wrap justify-end gap-1">
                          {statusColumn.cell(row)}
                        </div>
                      )}
                    </div>
                    {subtitleColumn && (
                      <div className="text-muted-foreground line-clamp-2 text-sm break-words">
                        {subtitleColumn.cell(row)}
                      </div>
                    )}
                    {meta.length > 0 && (
                      <dl className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        {meta.map(({ column, value }) => (
                          <div key={column.key} className="flex min-w-0 items-center gap-1">
                            {labelOf(column) && <dt>{labelOf(column)}:</dt>}
                            <dd className="text-foreground/80 min-w-0 truncate">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                  {actions.length > 0 && (
                    <RowActionsMenu actions={actions} onRequestConfirm={setPending} />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent variant="sheet">
          <DialogHeader>
            <DialogTitle>{pending?.confirm?.title ?? pending?.label}</DialogTitle>
            <DialogDescription>{pending?.confirm?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={confirming}>
              Cancel
            </Button>
            <Button
              variant={pending?.variant === "destructive" ? "destructive" : "default"}
              onClick={runPending}
              disabled={confirming}
            >
              {confirming ? "…" : (pending?.confirm?.confirmText ?? pending?.label)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
DataTable.displayName = "DataTable";

export { DataTable };
