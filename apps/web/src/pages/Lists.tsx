import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import type { List } from "../lib/types.js";
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
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyState,
  Popconfirm,
  toast,
} from "../components/ui/index.js";

export default function Lists() {
  const [lists, setLists] = useState<List[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [optin, setOptin] = useState<"single" | "double">("single");
  const [type, setType] = useState<"public" | "private">("private");

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

      <BlockLayout padding="sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Opt-in</TableHead>
              <TableHead>Subscribers</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lists.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{l.name}</TableCell>
                <TableCell className="text-muted-foreground">{l.optin}</TableCell>
                <TableCell>{l.subscriber_count ?? 0}</TableCell>
                <TableCell className="text-right">
                  <Popconfirm
                    description="Delete this list? Subscribers are not deleted."
                    onConfirm={() => remove(l.id)}
                    confirmText="Delete"
                  >
                    <Button variant="outline" size="sm">
                      Delete
                    </Button>
                  </Popconfirm>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {lists.length === 0 && (
          <TableEmptyState
            title="No lists yet"
            description="Create a list to organize your subscribers."
          />
        )}
      </BlockLayout>
    </div>
  );
}
