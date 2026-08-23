import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import type { List, Subscriber } from "../lib/types.js";
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
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyState,
  CheckboxCell,
  CheckboxHeaderCell,
  TablePagination,
  Popconfirm,
  Alert,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  RadioGroup,
  RadioGroupItem,
  RadioGroupLabel,
  toast,
} from "../components/ui/index.js";

const BATCH_SIZE = 300;

interface SubscriberListResponse {
  subscribers: Subscriber[];
  total: number;
}

type BulkSelector = { ids: number[] } | { query: { q?: string }; all: true };

export default function Subscribers() {
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

  const load = useCallback(() => {
    const query = q ? `&q=${encodeURIComponent(q)}` : "";
    api
      .get<SubscriberListResponse>(
        `/subscribers?limit=${pageSize}&offset=${(page - 1) * pageSize}${query}`,
      )
      .then((res) => {
        setSubscribers(res.subscribers);
        setTotal(res.total);
      });
  }, [q, page, pageSize]);

  useEffect(load, [load]);

  useEffect(() => {
    api.get<List[]>("/lists").then(setLists);
  }, []);

  // Reset to page 1 + clear selection when search changes.
  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
    setSelectAllMatching(false);
  }, [q]);

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
      return { query: { q: q || undefined }, all: true };
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

  function openManageLists() {
    setMlAction("add");
    setMlListIds([]);
    setMlStatus("confirmed");
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

  return (
    <div>
      <PageHeaderWrapper
        variant="title-with-actions"
        title="Subscribers"
        actions={
          <div className="flex gap-2">
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
          </div>
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

      {/* Search */}
      <div className="mb-4">
        <Input
          placeholder="Search by email or name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
      </div>

      {/* Bulk action bar — only rendered when something is selected */}
      {selectedCount > 0 && (
        <BlockLayout
          padding="sm"
          className="mb-4 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium">{selectionLabel}</span>
            {showSelectAllMatching && (
              <button
                type="button"
                className="text-primary text-sm hover:underline"
                onClick={() => setSelectAllMatching(true)}
              >
                Select all {total} matching{q ? ` "${q}"` : ""}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={busy || exportDisabled}
            >
              Export
            </Button>
            <Button variant="outline" size="sm" onClick={openManageLists} disabled={busy}>
              Manage lists
            </Button>
            <Popconfirm
              description={blocklistConfirmText}
              onConfirm={handleBlocklist}
              confirmText="Blocklist"
            >
              <Button variant="outline" size="sm" disabled={busy}>
                Blocklist
              </Button>
            </Popconfirm>
            <Popconfirm
              description={deleteConfirmText}
              onConfirm={handleDelete}
              confirmText="Delete"
            >
              <Button variant="destructive" size="sm" disabled={busy}>
                Delete
              </Button>
            </Popconfirm>
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              Clear
            </Button>
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

      {/* Table */}
      <BlockLayout padding="sm" className="mb-4">
        <Table>
          <TableHeader>
            <TableRow>
              <CheckboxHeaderCell
                checked={allOnPageSelected}
                indeterminate={someOnPageSelected && !allOnPageSelected}
                onCheckedChange={toggleAllOnPage}
                aria-label="Select all on this page"
              />
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscribers.map((s) => (
              <TableRow key={s.id} selected={selectedIds.has(s.id) || selectAllMatching}>
                <CheckboxCell
                  checked={selectedIds.has(s.id) || selectAllMatching}
                  onCheckedChange={() => toggleRow(s.id)}
                  aria-label={`Select ${s.email}`}
                />
                <TableCell>
                  <Link to={`/subscribers/${s.id}`} className="text-primary hover:underline">
                    {s.email}
                  </Link>
                </TableCell>
                <TableCell>{s.name || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>
                  <Badge status={s.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(s.created_at).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {subscribers.length === 0 && (
          <TableEmptyState
            title="No subscribers found"
            description="Add or import subscribers to get started."
          />
        )}
      </BlockLayout>

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

      {/* Manage Lists dialog */}
      <Dialog open={showManageLists} onOpenChange={(open) => !open && setShowManageLists(false)}>
        <DialogContent>
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

            {progress && (
              <p className="text-muted-foreground text-sm">
                Processing… {progress.done}/{progress.total}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowManageLists(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={applyManageLists} disabled={busy || mlListIds.length === 0}>
                {busy
                  ? "Processing…"
                  : `Apply to ${selectAllMatching ? `all ${total} matching` : selectedCount} subscribers`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
