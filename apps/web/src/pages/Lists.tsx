import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import type { List } from "../lib/types.js";
import type { DataTableAction, DataTableColumn } from "../components/ui/index.js";
import Badge from "../components/Badge.js";
import {
  PageHeaderWrapper,
  BlockLayout,
  Button,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  FormLabel,
  FormRow,
  DataTable,
  TableEmptyState,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  toast,
} from "../components/ui/index.js";

export default function Lists() {
  const [lists, setLists] = useState<List[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [optin, setOptin] = useState<"single" | "double">("single");
  const [type, setType] = useState<"public" | "private">("private");

  const [editingList, setEditingList] = useState<List | null>(null);
  const [editName, setEditName] = useState("");
  const [editOptin, setEditOptin] = useState<"single" | "double">("single");
  const [editType, setEditType] = useState<"public" | "private">("private");
  const [saving, setSaving] = useState(false);

  function load() {
    api.get<List[]>("/lists").then(setLists);
  }
  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post("/lists", { name, optin, type });
      setName("");
      setShowForm(false);
      load();
      toast.success("List created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "failed to create list");
    }
  }

  async function remove(id: number) {
    await api.delete(`/lists/${id}`);
    load();
    toast.success("List deleted");
  }

  function beginEdit(l: List) {
    setEditingList(l);
    setEditName(l.name);
    setEditOptin(l.optin);
    setEditType(l.type);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingList) return;
    setSaving(true);
    try {
      await api.patch(`/lists/${editingList.id}`, {
        name: editName,
        optin: editOptin,
        type: editType,
      });
      setEditingList(null);
      load();
      toast.success("List updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "failed to update list");
    } finally {
      setSaving(false);
    }
  }

  const columns: DataTableColumn<List>[] = [
    {
      key: "name",
      header: "Name",
      mobile: "title",
      cell: (l) => (
        <button
          type="button"
          className="text-primary text-left hover:underline"
          onClick={() => beginEdit(l)}
        >
          {l.name}
        </button>
      ),
    },
    {
      key: "type",
      header: "Type",
      mobile: "status",
      cell: (l) => <Badge status={l.type} label={l.type === "public" ? "Public" : "Private"} />,
    },
    {
      key: "optin",
      header: "Opt-in",
      className: "text-muted-foreground",
      cell: (l) => l.optin,
    },
    {
      key: "subscribers",
      header: "Subscribers",
      cell: (l) => (
        <>
          <Link to={`/subscribers?list_ids=${l.id}`} className="text-primary hover:underline">
            {l.subscriber_count ?? 0}
          </Link>
          {!!l.unsubscribed_count && (
            <>
              {" — "}
              <Link
                to={`/subscribers?list_ids=${l.id}&list_statuses=unsubscribed`}
                className="text-destructive hover:underline"
              >
                {l.unsubscribed_count} unsubscribed
              </Link>
            </>
          )}
        </>
      ),
    },
    {
      key: "created",
      header: "Created",
      className: "text-muted-foreground",
      cell: (l) => new Date(l.created_at).toLocaleDateString(),
    },
    {
      key: "updated",
      header: "Updated",
      mobile: "hidden",
      className: "text-muted-foreground",
      cell: (l) => new Date(l.updated_at).toLocaleDateString(),
    },
  ];

  function rowActions(l: List): DataTableAction[] {
    return [
      { label: "Edit", appearance: "outline", onClick: () => beginEdit(l) },
      {
        label: "Delete",
        appearance: "outline",
        variant: "destructive",
        confirm: {
          description: "Delete this list? Subscribers are not deleted.",
          confirmText: "Delete",
        },
        onClick: () => remove(l.id),
      },
    ];
  }

  return (
    <div>
      <PageHeaderWrapper
        variant="title-with-actions"
        title="Lists"
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "New list"}</Button>
        }
      />

      {showForm && (
        <BlockLayout className="mb-6">
          <form onSubmit={create} className="space-y-4">
            <div className="space-y-2">
              <FormLabel required>Name</FormLabel>
              <Input required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <FormRow>
              <div className="space-y-2">
                <FormLabel>Opt-in</FormLabel>
                <Select value={optin} onValueChange={(v) => setOptin(v as "single" | "double")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Single opt-in</SelectItem>
                    <SelectItem value="double">Double opt-in</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <FormLabel>Visibility</FormLabel>
                <Select value={type} onValueChange={(v) => setType(v as "public" | "private")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">Private</SelectItem>
                    <SelectItem value="public">Public</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </FormRow>
            <Button type="submit">Create</Button>
          </form>
        </BlockLayout>
      )}

      <DataTable
        columns={columns}
        rows={lists}
        rowKey={(l) => l.id}
        rowActions={rowActions}
        empty={
          <TableEmptyState
            title="No lists yet"
            description="Create a list to organize your subscribers."
          />
        }
      />

      <Dialog open={!!editingList} onOpenChange={(open) => !open && setEditingList(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit list</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveEdit} className="space-y-4">
            <div className="space-y-2">
              <FormLabel required>Name</FormLabel>
              <Input required value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <FormRow>
              <div className="space-y-2">
                <FormLabel>Opt-in</FormLabel>
                <Select
                  value={editOptin}
                  onValueChange={(v) => setEditOptin(v as "single" | "double")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Single opt-in</SelectItem>
                    <SelectItem value="double">Double opt-in</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <FormLabel>Visibility</FormLabel>
                <Select
                  value={editType}
                  onValueChange={(v) => setEditType(v as "public" | "private")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">Private</SelectItem>
                    <SelectItem value="public">Public</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </FormRow>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingList(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
