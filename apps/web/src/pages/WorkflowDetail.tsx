import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Workflow } from "../lib/types.js";
import Badge from "../components/Badge.js";
import {
  PageHeaderWrapper,
  BlockLayout,
  Button,
  Input,
  Textarea,
  Checkbox,
  CheckboxLabel,
  FormLabel,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyState,
  Skeleton,
  Typography,
} from "../components/ui/index.js";

interface Enrollment {
  id: string;
  status: string;
  current_step: number;
  next_run_at: string | null;
  email: string;
}

const STEP_HELP = `Steps are executed in order. Example:
[
  { "type": "delay", "duration_seconds": 86400 },
  {
    "type": "send_email",
    "subject": "Welcome!",
    "body": "<p>Hi {{ Subscriber.Name }}</p>",
    "connection_id": 1,
    "fallback_connection_ids": [2, 3]
  },
  { "type": "add_tag", "tag": "onboarded" }
]

Available step types: delay, send_email, add_tag, remove_tag, add_list,
remove_list, condition, webhook_out.

send_email accepts connection_id (primary) and fallback_connection_ids
(ordered fallbacks). If omitted, the first enabled connection is used.`;

export default function WorkflowDetail() {
  const { id } = useParams();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [stepsText, setStepsText] = useState("[]");
  const [triggerConfigText, setTriggerConfigText] = useState("{}");
  const [reentry, setReentry] = useState(false);
  const [subscriberId, setSubscriberId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function load() {
    api.get<Workflow>(`/workflows/${id}`).then((w) => {
      setWorkflow(w);
      setStepsText(JSON.stringify(w.steps, null, 2));
      setTriggerConfigText(JSON.stringify(w.trigger_config, null, 2));
      setReentry(w.reentry_allowed);
    });
    api.get<Enrollment[]>(`/workflows/${id}/enrollments`).then(setEnrollments);
  }
  useEffect(load, [id]);

  async function save() {
    setError(null);
    setSaved(false);
    try {
      const steps = JSON.parse(stepsText);
      const trigger_config = JSON.parse(triggerConfigText);
      await api.patch(`/workflows/${id}`, { steps, trigger_config, reentry_allowed: reentry });
      setSaved(true);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "invalid JSON or save failed");
    }
  }

  async function setStatus(status: Workflow["status"]) {
    await api.patch(`/workflows/${id}`, { status });
    load();
  }

  async function enroll() {
    if (!subscriberId) return;
    await api.post(`/workflows/${id}/enroll`, { subscriber_id: Number(subscriberId) });
    setSubscriberId("");
    load();
  }

  if (!workflow) return <Skeleton className="h-48" />;

  return (
    <div>
      <PageHeaderWrapper
        variant="title-with-actions"
        title={workflow.name}
        actions={<Badge status={workflow.status} />}
      />

      <div className="mb-4 flex gap-2">
        {workflow.status !== "active" && (
          <Button onClick={() => setStatus("active")}>Activate</Button>
        )}
        {workflow.status === "active" && (
          <Button variant="outline" onClick={() => setStatus("paused")}>
            Pause
          </Button>
        )}
      </div>

      <BlockLayout className="mb-4">
        <div className="space-y-4">
          <div>
            <strong>Trigger:</strong> {workflow.trigger_type}
          </div>
          <div className="space-y-2">
            <FormLabel>Trigger config (JSON)</FormLabel>
            <Textarea
              rows={4}
              value={triggerConfigText}
              onChange={(e) => setTriggerConfigText(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={reentry}
              onCheckedChange={(v) => setReentry(v === true)}
              id="reentry"
            />
            <CheckboxLabel htmlFor="reentry">
              Allow contacts to re-enter after completing
            </CheckboxLabel>
          </div>
        </div>
      </BlockLayout>

      <BlockLayout className="mb-4">
        <div className="space-y-4">
          <Typography variant="h3">Steps</Typography>
          <p className="text-muted-foreground text-xs whitespace-pre-wrap">{STEP_HELP}</p>
          <Textarea
            rows={14}
            value={stepsText}
            onChange={(e) => setStepsText(e.target.value)}
            className="font-mono"
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
          {saved && <p className="text-success text-sm">Saved.</p>}
          <Button onClick={save}>Save</Button>
        </div>
      </BlockLayout>

      <BlockLayout className="mb-4">
        <div className="space-y-4">
          <Typography variant="h3">Manual enrollment</Typography>
          <div className="flex gap-2">
            <Input
              placeholder="Subscriber ID"
              value={subscriberId}
              onChange={(e) => setSubscriberId(e.target.value)}
              className="max-w-[160px]"
            />
            <Button onClick={enroll}>Enroll</Button>
          </div>
        </div>
      </BlockLayout>

      <BlockLayout padding="sm">
        <Typography variant="h3" className="mb-4">
          Enrollments
        </Typography>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subscriber</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Step</TableHead>
              <TableHead>Next run</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {enrollments.map((e) => (
              <TableRow key={e.id}>
                <TableCell>{e.email}</TableCell>
                <TableCell>
                  <Badge status={e.status} />
                </TableCell>
                <TableCell>{e.current_step}</TableCell>
                <TableCell className="text-muted-foreground">
                  {e.next_run_at ? new Date(e.next_run_at).toLocaleString() : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {enrollments.length === 0 && <TableEmptyState title="No enrollments yet" />}
      </BlockLayout>
    </div>
  );
}
