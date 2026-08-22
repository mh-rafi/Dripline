import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Workflow } from "../lib/types.js";
import Badge from "../components/Badge.js";

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
  { "type": "send_email", "subject": "Welcome!", "body": "<p>Hi {{ Subscriber.Name }}</p>" },
  { "type": "add_tag", "tag": "onboarded" }
]

Available step types: delay, send_email, add_tag, remove_tag, add_list,
remove_list, condition, webhook_out.`;

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

  if (!workflow) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="page-header">
        <h2>{workflow.name}</h2>
        <Badge status={workflow.status} />
      </div>

      <div className="toolbar">
        {workflow.status !== "active" && (
          <button onClick={() => setStatus("active")}>Activate</button>
        )}
        {workflow.status === "active" && (
          <button className="secondary" onClick={() => setStatus("paused")}>
            Pause
          </button>
        )}
      </div>

      <div className="card">
        <div>
          <strong>Trigger:</strong> {workflow.trigger_type}
        </div>
        <label>Trigger config (JSON)</label>
        <textarea
          rows={4}
          value={triggerConfigText}
          onChange={(e) => setTriggerConfigText(e.target.value)}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={reentry}
            onChange={(e) => setReentry(e.target.checked)}
          />
          Allow contacts to re-enter after completing
        </label>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Steps</h3>
        <p className="muted" style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
          {STEP_HELP}
        </p>
        <textarea rows={14} value={stepsText} onChange={(e) => setStepsText(e.target.value)} />
        {error && <p className="error-text">{error}</p>}
        {saved && <p style={{ color: "var(--success)", fontSize: 13 }}>Saved.</p>}
        <div style={{ marginTop: 12 }}>
          <button onClick={save}>Save</button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Manual enrollment</h3>
        <div className="toolbar">
          <input
            placeholder="Subscriber ID"
            value={subscriberId}
            onChange={(e) => setSubscriberId(e.target.value)}
            style={{ maxWidth: 160 }}
          />
          <button onClick={enroll}>Enroll</button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Enrollments</h3>
        <table>
          <thead>
            <tr>
              <th>Subscriber</th>
              <th>Status</th>
              <th>Step</th>
              <th>Next run</th>
            </tr>
          </thead>
          <tbody>
            {enrollments.map((e) => (
              <tr key={e.id}>
                <td>{e.email}</td>
                <td>
                  <Badge status={e.status} />
                </td>
                <td>{e.current_step}</td>
                <td className="muted">
                  {e.next_run_at ? new Date(e.next_run_at).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
            {enrollments.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No enrollments yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
