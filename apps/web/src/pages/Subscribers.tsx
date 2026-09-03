import { useEffect, useState, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SlidersHorizontal } from "lucide-react";
import { api } from "../lib/api.js";
import { cn } from "../lib/utils.js";
import type { List, Subscriber } from "../lib/types.js";
import type { DataTableColumn } from "../components/ui/index.js";
import Badge from "../components/Badge.js";
import {
  PageHeaderWrapper,
  BlockLayout,
  Button,
  Input,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Checkbox,
  CheckboxLabel,
  FormLabel,
  FormRow,
  DataTable,
  TableEmptyState,
  TablePagination,
  Popconfirm,
  Alert,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  RadioGroup,
  RadioGroupItem,
  RadioGroupLabel,
  toast,
} from "../components/ui/index.js";

const BATCH_SIZE = 300;

type ListMembershipStatus = "unconfirmed" | "confirmed" | "unsubscribed";

const LIST_STATUS_OPTIONS: { value: ListMembershipStatus; label: string }[] = [
  { value: "confirmed", label: "Confirmed" },
  { value: "unconfirmed", label: "Unconfirmed" },
  { value: "unsubscribed", label: "Unsubscribed" },
];

interface SubscriberListResponse {
  subscribers: Subscriber[];
  total: number;
}

type BulkSelector =
  | { ids: number[] }
  | {
      query: {
        q?: string;
        list_ids?: number[];
        list_statuses?: ListMembershipStatus[];
        blocklisted?: boolean;
      };
      all: true;
    };

function parseCommaInts(value: string | null): number[] {
  return value ? value.split(",").map(Number) : [];
}

function parseCommaList<T extends string>(value: string | null): T[] {
  return value ? (value.split(",") as T[]) : [];
}

export default function Subscribers() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Raw param strings, not the parsed arrays below -- stable across renders
  // unless the URL actually changes, so they're safe to use as effect/memo
  // dependencies (the parsed arrays are fresh instances every render).
  const listIdsParam = searchParams.get("list_ids");
  const listStatusesParam = searchParams.get("list_statuses");
  const blocklistedParam = searchParams.get("blocklisted");
  const filterListIds = parseCommaInts(listIdsParam);
  const filterListStatuses = parseCommaList<ListMembershipStatus>(listStatusesParam);
  const filterBlocklisted = blocklistedParam === "true";
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"enabled" | "blocklisted">("enabled");
  const [listIds, setListIds] = useState<number[]>([]);
  const [preconfirm, setPreconfirm] = useState(false);
  const [attribsText, setAttribsText] = useState("{}");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [showManageLists, setShowManageLists] = useState(false);
  const [listFilterSearch, setListFilterSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(() => {
    const query =
      (q ? `&q=${encodeURIComponent(q)}` : "") +
      (listIdsParam ? `&list_ids=${encodeURIComponent(listIdsParam)}` : "") +
      (listStatusesParam ? `&list_statuses=${encodeURIComponent(listStatusesParam)}` : "") +
      (blocklistedParam ? `&blocklisted=${encodeURIComponent(blocklistedParam)}` : "");
    api
      .get<SubscriberListResponse>(
        `/subscribers?limit=${pageSize}&offset=${(page - 1) * pageSize}${query}`,
      )
      .then((res) => {
        setSubscribers(res.subscribers);
        setTotal(res.total);
      });
  }, [q, page, pageSize, listIdsParam, listStatusesParam, blocklistedParam]);

  useEffect(load, [load]);

  useEffect(() => {
    api.get<List[]>("/lists").then(setLists);
  }, []);

  // Reset to page 1 + clear selection when search or filters change.
  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
    setSelectAllMatching(false);
  }, [q, listIdsParam, listStatusesParam, blocklistedParam]);

  function toggleListFilter(id: number) {
    const next = filterListIds.includes(id)
      ? filterListIds.filter((x) => x !== id)
      : [...filterListIds, id];
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next.length > 0) params.set("list_ids", next.join(","));
      else params.delete("list_ids");
      return params;
    });
  }

  function toggleListStatusFilter(value: ListMembershipStatus) {
    const next = filterListStatuses.includes(value)
      ? filterListStatuses.filter((x) => x !== value)
      : [...filterListStatuses, value];
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next.length > 0) params.set("list_statuses", next.join(","));
      else params.delete("list_statuses");
      return params;
    });
  }

  function toggleBlocklistedFilter() {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (filterBlocklisted) params.delete("blocklisted");
      else params.set("blocklisted", "true");
      return params;
    });
  }

  function clearFilters() {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete("list_ids");
      params.delete("list_statuses");
      params.delete("blocklisted");
      return params;
    });
  }

  const activeFilterCount =
    filterListIds.length + filterListStatuses.length + (filterBlocklisted ? 1 : 0);

  const selectedCount = selectAllMatching ? total : selectedIds.size;
  const pageIds = subscribers.map((s) => s.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const someOnPageSelected = pageIds.some((id) => selectedIds.has(id));
  const showSelectAllMatching =
    allOnPageSelected && total > subscribers.length && !selectAllMatching;

  function toggleRow(id: number) {
    if (selectAllMatching) {
      // Drop from select-all mode into explicit mode starting with the
      // current page's checked state minus the one just unchecked.
      setSelectAllMatching(false);
      const pageSet = new Set(pageIds);
      pageSet.delete(id);
      setSelectedIds(pageSet);
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllOnPage() {
    if (selectAllMatching) {
      setSelectAllMatching(false);
      setSelectedIds(new Set());
      return;
    }
    if (allOnPageSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of pageIds) next.delete(id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of pageIds) next.add(id);
        return next;
      });
    }
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectAllMatching(false);
  }

  function buildSelector(): BulkSelector {
    if (selectAllMatching) {
      return {
        query: {
          q: q || undefined,
          list_ids: filterListIds.length > 0 ? filterListIds : undefined,
          list_statuses: filterListStatuses.length > 0 ? filterListStatuses : undefined,
          blocklisted: filterBlocklisted || undefined,
        },
        all: true,
      };
    }
    return { ids: [...selectedIds] };
  }

  // --- Bulk actions ---

  async function runBatched(endpoint: string, selector: BulkSelector, successMsg: string) {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      if ("query" in selector) {
        const res = await api.post<{ affected: number }>(endpoint, selector);
        toast.success(`${successMsg} (${res.affected})`);
      } else {
        // Chunk IDs into batches of BATCH_SIZE.
        const ids = selector.ids;
        let affected = 0;
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
          const batch = ids.slice(i, i + BATCH_SIZE);
          const res = await api.post<{ affected: number }>(endpoint, { ids: batch });
          affected += res.affected;
          setProgress({ done: Math.min(i + BATCH_SIZE, ids.length), total: ids.length });
        }
        toast.success(`${successMsg} (${affected})`);
      }
      clearSelection();
      // Clamp page if we deleted enough that current page is past the end.
      // Blocklisting doesn't remove rows from this list (GET /subscribers
      // doesn't filter by status), so it never needs this -- only delete
      // actually shrinks `total`.
      if (endpoint.includes("delete")) {
        const newTotal = Math.max(0, total - (selectAllMatching ? total : selectedIds.size));
        const newLastPage = Math.max(1, Math.ceil(newTotal / pageSize));
        if (page > newLastPage) setPage(newLastPage);
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "action failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      await api.downloadBlob("/subscribers/export", buildSelector());
      toast.success("Export downloaded");
    } catch (err) {
      setError(err instanceof Error ? err.message : "export failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    await runBatched("/subscribers/bulk/delete", buildSelector(), "Deleted");
  }

  async function handleBlocklist() {
    await runBatched("/subscribers/bulk/blocklist", buildSelector(), "Blocklisted");
  }

  // --- Manage Lists dialog ---

  const [mlAction, setMlAction] = useState<"add" | "remove">("add");
  const [mlListIds, setMlListIds] = useState<number[]>([]);
  const [mlStatus, setMlStatus] = useState<"unconfirmed" | "confirmed">("confirmed");
  const [mlTriggerAutomations, setMlTriggerAutomations] = useState(false);

  function openManageLists() {
    setMlAction("add");
    setMlListIds([]);
    setMlStatus("confirmed");
    setMlTriggerAutomations(false);
    setShowManageLists(true);
  }

  async function applyManageLists() {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const selector = buildSelector();
      if ("query" in selector) {
        const res = await api.post<{ affected: number }>("/subscribers/bulk/lists", {
          ...selector,
          list_ids: mlListIds,
          action: mlAction,
          status: mlAction === "add" ? mlStatus : undefined,
          trigger_automations: mlTriggerAutomations,
        });
        toast.success(`Updated ${res.affected} list memberships`);
      } else {
        const ids = selector.ids;
        let affected = 0;
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
          const batch = ids.slice(i, i + BATCH_SIZE);
          const res = await api.post<{ affected: number }>("/subscribers/bulk/lists", {
            ids: batch,
            list_ids: mlListIds,
            action: mlAction,
            status: mlAction === "add" ? mlStatus : undefined,
            trigger_automations: mlTriggerAutomations,
          });
          affected += res.affected;
          setProgress({ done: Math.min(i + BATCH_SIZE, ids.length), total: ids.length });
        }
        toast.success(`Updated ${affected} list memberships`);
      }
      setShowManageLists(false);
      clearSelection();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  // --- Add subscriber form ---

  function resetForm() {
    setEmail("");
    setName("");
    setStatus("enabled");
    setListIds([]);
    setPreconfirm(false);
    setAttribsText("{}");
    setError(null);
  }

  async function createSubscriber(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    let attribs: Record<string, unknown>;
    try {
      attribs = JSON.parse(attribsText);
    } catch {
      setError("Attributes must be valid JSON.");
      return;
    }
    try {
      await api.post("/subscribers", {
        email,
        name,
        status,
        list_ids: listIds,
        preconfirm,
        attribs,
      });
      resetForm();
      setShowForm(false);
      load();
      toast.success("Subscriber created");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create subscriber");
    }
  }

  const selectionLabel = selectAllMatching ? `All ${total} selected` : `${selectedCount} selected`;

  const deleteConfirmText = selectAllMatching
    ? `Delete all ${total} subscribers${q ? ` matching "${q}"` : ""} permanently? This can't be undone.`
    : `Delete ${selectedCount} subscribers permanently? This can't be undone.`;

  const blocklistConfirmText = selectAllMatching
    ? `Blocklist all ${total} subscribers${q ? ` matching "${q}"` : ""}? They will be unsubscribed from every list and excluded from all future campaigns.`
    : `Blocklist ${selectedCount} subscribers? They will be unsubscribed from every list and excluded from all future campaigns.`;

  const exportDisabled = !selectAllMatching && selectedIds.size > 1000;

  const columns: DataTableColumn<Subscriber>[] = [
    {
      key: "email",
      header: "Email",
      mobile: "title",
      cell: (s) => (
        <Link to={`/subscribers/${s.id}`} className="text-primary hover:underline">
          {s.email}
        </Link>
      ),
    },
    {
      key: "name",
      header: "Name",
      mobile: "subtitle",
      cell: (s) => s.name || <span className="text-muted-foreground">—</span>,
    },
    { key: "status", header: "Status", mobile: "status", cell: (s) => <Badge status={s.status} /> },
    {
      key: "joined",
      header: "Joined",
      className: "text-muted-foreground",
      cell: (s) => new Date(s.created_at).toLocaleDateString(),
    },
  ];

  return (
    <div>
      <PageHeaderWrapper
        variant="title-with-actions"
        title="Subscribers"
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/subscribers/import">Import</Link>
            </Button>
            <Button
              onClick={() => {
                if (showForm) resetForm();
                setShowForm((v) => !v);
              }}
            >
              {showForm ? "Cancel" : "Add subscriber"}
            </Button>
          </>
        }
      />

      {showForm && (
        <BlockLayout className="mb-6">
          <form onSubmit={createSubscriber} className="space-y-4">
            <FormRow>
              <div className="space-y-2">
                <FormLabel required>Email</FormLabel>
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <FormLabel>Name</FormLabel>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </FormRow>

            <div className="space-y-2">
              <FormLabel>Status</FormLabel>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as "enabled" | "blocklisted")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="enabled">Enabled</SelectItem>
                  <SelectItem value="blocklisted">Blocklisted</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Blocklisted subscribers will never receive any campaigns.
              </p>
            </div>

            <div className="space-y-2">
              <FormLabel>Lists</FormLabel>
              <select
                multiple
                value={listIds.map(String)}
                onChange={(e) =>
                  setListIds(Array.from(e.target.selectedOptions, (o) => Number(o.value)))
                }
                size={Math.min(Math.max(lists.length, 3), 8)}
                className="border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              >
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.optin})
                  </option>
                ))}
              </select>
              {lists.length === 0 && <p className="text-muted-foreground text-sm">No lists yet.</p>}
              <p className="text-muted-foreground text-xs">
                Ctrl/Cmd-click (or Shift-click) to select multiple lists.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                checked={preconfirm}
                onCheckedChange={(v) => setPreconfirm(v === true)}
                disabled={listIds.length === 0}
                id="preconfirm"
              />
              <CheckboxLabel htmlFor="preconfirm">Preconfirm subscriptions</CheckboxLabel>
            </div>
            <p className="text-muted-foreground text-xs">
              Mark all selected lists as confirmed immediately, regardless of opt-in type — use for
              known-good imports, not for new sign-ups.
            </p>

            <div className="space-y-2">
              <FormLabel>Attributes (JSON)</FormLabel>
              <Textarea
                rows={4}
                value={attribsText}
                onChange={(e) => setAttribsText(e.target.value)}
                className="font-mono"
              />
            </div>

            {error && <Alert variant="destructive">{error}</Alert>}
            <Button type="submit">Create</Button>
          </form>
        </BlockLayout>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          placeholder="Search by email or name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="sm:max-w-xs"
        />
        <Button
          variant="outline"
          size="sm"
          className={cn("gap-2", activeFilterCount > 0 && "border-primary text-primary")}
          onClick={() => setShowFilters(true)}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </Button>
      </div>

      {/* Filters sheet — one trigger for both list and status filters, rather
          than two separate popovers that don't have room to open on a phone. */}
      <Dialog open={showFilters} onOpenChange={setShowFilters}>
        <DialogContent variant="sheet">
          <DialogHeader>
            <DialogTitle>Filters</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <FormLabel>Lists</FormLabel>
              <Input
                placeholder="Search lists…"
                value={listFilterSearch}
                onChange={(e) => setListFilterSearch(e.target.value)}
              />
              <div className="max-h-48 space-y-0.5 overflow-y-auto">
                {lists
                  .filter((l) => l.name.toLowerCase().includes(listFilterSearch.toLowerCase()))
                  .map((l) => (
                    <label
                      key={l.id}
                      className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm"
                    >
                      <Checkbox
                        checked={filterListIds.includes(l.id)}
                        onCheckedChange={() => toggleListFilter(l.id)}
                      />
                      {l.name}
                    </label>
                  ))}
                {lists.filter((l) => l.name.toLowerCase().includes(listFilterSearch.toLowerCase()))
                  .length === 0 && (
                  <div className="text-muted-foreground px-2 py-1.5 text-sm">No lists found</div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <FormLabel>Status</FormLabel>
              <div className="space-y-0.5">
                {LIST_STATUS_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm"
                  >
                    <Checkbox
                      checked={filterListStatuses.includes(opt.value)}
                      onCheckedChange={() => toggleListStatusFilter(opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
                <label className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm">
                  <Checkbox checked={filterBlocklisted} onCheckedChange={toggleBlocklistedFilter} />
                  Blocklisted
                </label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={clearFilters}
              disabled={activeFilterCount === 0}
              className="w-full sm:w-auto"
            >
              Reset
            </Button>
            <Button onClick={() => setShowFilters(false)} className="w-full sm:w-auto">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk action bar — only rendered when something is selected. Fixed to
          the bottom on mobile (thumb reach, and there's no room for it inline
          next to the filters), an ordinary block above the table on desktop. */}
      {selectedCount > 0 && (
        <BlockLayout
          padding="sm"
          className="fixed inset-x-0 bottom-0 z-40 space-y-2 rounded-none border-x-0 border-b-0 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:static sm:z-auto sm:mb-4 sm:space-y-0 sm:rounded-lg sm:border sm:pb-4"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">{selectionLabel}</span>
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              Clear
            </Button>
          </div>
          {showSelectAllMatching && (
            <button
              type="button"
              className="text-primary block text-sm hover:underline"
              onClick={() => setSelectAllMatching(true)}
            >
              Select all {total} matching{q ? ` "${q}"` : ""}
            </button>
          )}
          <div className="flex items-center gap-2 overflow-x-auto sm:flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={handleExport}
              disabled={busy || exportDisabled}
            >
              Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={openManageLists}
              disabled={busy}
            >
              Manage lists
            </Button>
            <Popconfirm
              description={blocklistConfirmText}
              onConfirm={handleBlocklist}
              confirmText="Blocklist"
            >
              <Button variant="outline" size="sm" className="shrink-0" disabled={busy}>
                Blocklist
              </Button>
            </Popconfirm>
            <Popconfirm
              description={deleteConfirmText}
              onConfirm={handleDelete}
              confirmText="Delete"
            >
              <Button variant="destructive" size="sm" className="shrink-0" disabled={busy}>
                Delete
              </Button>
            </Popconfirm>
          </div>
          {exportDisabled && (
            <span className="text-muted-foreground text-xs">
              Select more than 1000 rows — use "select all matching" to export everything.
            </span>
          )}
        </BlockLayout>
      )}

      {progress && (
        <p className="text-muted-foreground mb-2 text-sm">
          Processing… {progress.done}/{progress.total}
        </p>
      )}

      {error && !showForm && (
        <Alert variant="destructive" className="mb-4">
          {error}
        </Alert>
      )}

      {/* Table — bottom padding clears the fixed mobile bulk-action bar above. */}
      <div className={selectedCount > 0 ? "pb-36 sm:pb-0" : undefined}>
        <DataTable
          columns={columns}
          rows={subscribers}
          rowKey={(s) => s.id}
          className="mb-4"
          selection={{
            isSelected: (s) => selectedIds.has(s.id) || selectAllMatching,
            onToggleRow: (s) => toggleRow(s.id),
            rowLabel: (s) => `Select ${s.email}`,
            allSelected: allOnPageSelected,
            someSelected: someOnPageSelected,
            onToggleAll: toggleAllOnPage,
          }}
          empty={
            <TableEmptyState
              title="No subscribers found"
              description="Add or import subscribers to get started."
            />
          }
        />

        {/* Pagination */}
        {total > 0 && (
          <TablePagination
            current={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          />
        )}
      </div>

      {/* Manage Lists dialog */}
      <Dialog open={showManageLists} onOpenChange={(open) => !open && setShowManageLists(false)}>
        <DialogContent variant="sheet">
          <DialogHeader>
            <DialogTitle>
              Manage lists{" "}
              {selectAllMatching ? `for all ${total} matching` : `for ${selectedCount}`} subscribers
            </DialogTitle>
            <DialogDescription>
              {mlAction === "add"
                ? "Add selected subscribers to one or more lists."
                : "Unsubscribe selected subscribers from one or more lists (soft — row is kept)."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <FormLabel>Action</FormLabel>
              <RadioGroup
                value={mlAction}
                onValueChange={(v) => setMlAction(v as "add" | "remove")}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="add" id="ml-add" />
                  <RadioGroupLabel htmlFor="ml-add">Add to list(s)</RadioGroupLabel>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="remove" id="ml-remove" />
                  <RadioGroupLabel htmlFor="ml-remove">Remove from list(s)</RadioGroupLabel>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <FormLabel>Lists</FormLabel>
              <div className="flex flex-col gap-2">
                {lists.map((l) => {
                  const checked = mlListIds.includes(l.id);
                  return (
                    <div key={l.id} className="flex items-center gap-2">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          if (v === true) setMlListIds((prev) => [...prev, l.id]);
                          else setMlListIds((prev) => prev.filter((x) => x !== l.id));
                        }}
                        id={`ml-list-${l.id}`}
                      />
                      <CheckboxLabel htmlFor={`ml-list-${l.id}`}>
                        {l.name} ({l.optin})
                      </CheckboxLabel>
                    </div>
                  );
                })}
                {lists.length === 0 && (
                  <p className="text-muted-foreground text-sm">No lists exist yet.</p>
                )}
              </div>
            </div>

            {mlAction === "add" && (
              <div className="space-y-2">
                <FormLabel>Status</FormLabel>
                <RadioGroup
                  value={mlStatus}
                  onValueChange={(v) => setMlStatus(v as "unconfirmed" | "confirmed")}
                  className="flex gap-4"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="unconfirmed" id="ml-unconfirmed" />
                    <RadioGroupLabel htmlFor="ml-unconfirmed">Unconfirmed</RadioGroupLabel>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="confirmed" id="ml-confirmed" />
                    <RadioGroupLabel htmlFor="ml-confirmed">Confirmed</RadioGroupLabel>
                  </div>
                </RadioGroup>
              </div>
            )}

            <div className="flex items-start gap-2">
              <Checkbox
                id="ml-trigger-automations"
                checked={mlTriggerAutomations}
                onCheckedChange={(v) => setMlTriggerAutomations(v === true)}
              />
              <div>
                <CheckboxLabel htmlFor="ml-trigger-automations">Run automations</CheckboxLabel>
                <p className="text-muted-foreground text-xs">
                  Off by default — turning it on enrols every affected contact in automations
                  triggered by this list change.
                </p>
              </div>
            </div>

            {progress && (
              <p className="text-muted-foreground text-sm">
                Processing… {progress.done}/{progress.total}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowManageLists(false)}
              disabled={busy}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={applyManageLists}
              disabled={busy || mlListIds.length === 0}
              className="w-full sm:w-auto"
            >
              {busy
                ? "Processing…"
                : `Apply to ${selectAllMatching ? `all ${total} matching` : selectedCount} subscribers`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
