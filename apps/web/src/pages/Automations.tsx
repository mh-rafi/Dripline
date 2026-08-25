import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Automation } from "../lib/types.js";
import Badge from "../components/Badge.js";
import { TRIGGERS } from "../automations/triggers.js";
import { cn } from "../lib/utils.js";
import {
  PageHeaderWrapper,
  BlockLayout,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FormLabel,
  Input,
  Popconfirm,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyState,
  toast,
} from "../components/ui/index.js";

function activeCount(automation: Automation): number {
  const counts = automation.enrollment_counts ?? [];
  return Number(counts.find((c) => c.status === "active")?.count ?? 0);
}

function CreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setTriggerType(null);
    }
  }, [open]);

  async function create() {
    if (!name.trim() || !triggerType) return;
    setCreating(true);
    try {
      const automation = await api.post<Automation>("/automations", {
        name: name.trim(),
        trigger_type: triggerType,
      });
      navigate(`/automations/${automation.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "failed to create automation");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New automation</DialogTitle>
          <DialogDescription>
            Name it, then choose what starts it. You can change the trigger's settings afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <FormLabel required>Automation name</FormLabel>
            <Input
              autoFocus
              value={name}
              placeholder="Welcome sequence"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <FormLabel required>Trigger</FormLabel>
            <div className="grid gap-2 sm:grid-cols-2">
              {TRIGGERS.map((trigger) => (
                <button
                  key={trigger.type}
                  type="button"
                  onClick={() => setTriggerType(trigger.type)}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition",
                    triggerType === trigger.type
                      ? "border-primary bg-accent/40 ring-primary/40 ring-1"
                      : "hover:border-primary/60 hover:bg-accent/20",
                  )}
                >
                  <trigger.icon className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{trigger.label}</span>
                    <span className="text-muted-foreground block text-xs">
                      {trigger.description}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {name.trim() && triggerType && (
            <Button onClick={create} disabled={creating} className="w-full">
              {creating ? "Creating…" : "Continue"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Automations() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  function load() {
    api.get<Automation[]>("/automations").then(setAutomations);
  }
  useEffect(load, []);

  async function remove(id: number) {
    await api.delete(`/automations/${id}`);
    toast.success("Automation deleted");
    load();
  }

  return (
    <div>
      <PageHeaderWrapper
        variant="title-with-actions"
        title="Automations"
        actions={<Button onClick={() => setDialogOpen(true)}>New automation</Button>}
      />

      <CreateDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      <BlockLayout padding="sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Steps</TableHead>
              <TableHead>Contacts in flow</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {automations.map((automation) => (
              <TableRow key={automation.id}>
                <TableCell>
                  <Link
                    to={`/automations/${automation.id}`}
                    className="text-primary hover:underline"
                  >
                    {automation.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {TRIGGERS.find((t) => t.type === automation.trigger_type)?.label ??
                    automation.trigger_type}
                </TableCell>
                <TableCell>{automation.graph.nodes.length}</TableCell>
                <TableCell>{activeCount(automation)}</TableCell>
                <TableCell>
                  <Badge status={automation.status} />
                </TableCell>
                <TableCell className="text-right">
                  <Popconfirm
                    title="Delete this automation?"
                    description="Contacts currently in the flow are removed with it."
                    onConfirm={() => remove(automation.id)}
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
        {automations.length === 0 && (
          <TableEmptyState
            title="No automations yet"
            description="Create one to send email sequences automatically when something happens."
          />
        )}
      </BlockLayout>
    </div>
  );
}
