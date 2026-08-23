import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import type { ApiKey } from "../lib/types.js";
import {
  PageHeaderWrapper,
  BlockLayout,
  Button,
  Input,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyState,
  Alert,
  Popconfirm,
  Typography,
  toast,
} from "../components/ui/index.js";

export default function Settings() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);

  function load() {
    api.get<ApiKey[]>("/api-keys").then(setKeys);
  }
  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await api.post<ApiKey & { key: string }>("/api-keys", { name });
    setRevealed(res.key);
    setName("");
    load();
  }

  async function remove(id: number) {
    await api.delete(`/api-keys/${id}`);
    load();
    toast.success("API key revoked");
  }

  return (
    <div>
      <PageHeaderWrapper variant="title-only" title="Settings" />

      <BlockLayout>
        <Typography variant="h3" className="mb-2">
          API keys
        </Typography>
        <Typography variant="muted" className="mb-4">
          Use an API key to integrate external services with Dripline's HTTP API (create
          subscribers, trigger webhooks, etc).
        </Typography>

        {revealed && (
          <Alert variant="warning" className="mb-4">
            <div>
              <strong>Copy this key now — it won't be shown again:</strong>
              <pre className="bg-muted mt-2 overflow-auto rounded-md p-2 font-mono text-sm">
                {revealed}
              </pre>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => setRevealed(null)}
              >
                Dismiss
              </Button>
            </div>
          </Alert>
        )}

        <form className="mb-4 flex gap-2" onSubmit={create}>
          <Input
            placeholder="Key name, e.g. 'CRM integration'"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="max-w-xs"
          />
          <Button type="submit">Generate key</Button>
        </form>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((k) => (
              <TableRow key={k.id}>
                <TableCell>{k.name}</TableCell>
                <TableCell className="text-muted-foreground font-mono">{k.key_prefix}</TableCell>
                <TableCell className="text-muted-foreground">
                  {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "never"}
                </TableCell>
                <TableCell className="text-right">
                  <Popconfirm
                    description="Revoke this API key?"
                    onConfirm={() => remove(k.id)}
                    confirmText="Revoke"
                  >
                    <Button variant="outline" size="sm">
                      Revoke
                    </Button>
                  </Popconfirm>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {keys.length === 0 && (
          <TableEmptyState
            title="No API keys yet"
            description="Generate a key to enable external API access."
          />
        )}
      </BlockLayout>
    </div>
  );
}
