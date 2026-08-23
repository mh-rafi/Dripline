import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Workflow } from "../lib/types.js";
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
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyState,
} from "../components/ui/index.js";

export default function Workflows() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<Workflow["trigger_type"]>("manual");
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get<Workflow[]>("/workflows").then(setWorkflows);
  }
  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const workflow = await api.post<Workflow>("/workflows", {
        name,
        trigger_type: triggerType,
        trigger_config: {},
        steps: [],
      });
      navigate(`/workflows/${workflow.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create workflow");
    }
  }

  return (
    <div>
      <PageHeaderWrapper
        variant="title-with-actions"
        title="Workflows"
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "New workflow"}
          </Button>
        }
      />

      {showForm && (
        <BlockLayout className="mb-6">
          <form onSubmit={create} className="space-y-4">
            <div className="space-y-2">
              <FormLabel required>Name</FormLabel>
              <Input required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <FormLabel>Trigger</FormLabel>
              <Select
                value={triggerType}
                onValueChange={(v) => setTriggerType(v as Workflow["trigger_type"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual enrollment (via API)</SelectItem>
                  <SelectItem value="list_joined">Subscriber joins a list</SelectItem>
                  <SelectItem value="tag_applied">Tag applied</SelectItem>
                  <SelectItem value="webhook">Webhook received</SelectItem>
                  <SelectItem value="link_clicked">Campaign link clicked</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit">Create draft</Button>
          </form>
        </BlockLayout>
      )}

      <BlockLayout padding="sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workflows.map((w) => (
              <TableRow key={w.id}>
                <TableCell>
                  <Link to={`/workflows/${w.id}`} className="text-primary hover:underline">
                    {w.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{w.trigger_type}</TableCell>
                <TableCell>
                  <Badge status={w.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {workflows.length === 0 && (
          <TableEmptyState
            title="No workflows yet"
            description="Create a workflow to automate your email sequences."
          />
        )}
      </BlockLayout>
    </div>
  );
}
