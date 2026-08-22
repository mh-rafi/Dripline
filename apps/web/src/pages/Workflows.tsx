import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Workflow } from "../lib/types.js";
import Badge from "../components/Badge.js";

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
      <div className="page-header">
        <h2>Workflows</h2>
        <button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "New workflow"}
        </button>
      </div>

      {showForm && (
        <form className="card" onSubmit={create}>
          <label>Name</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} />
          <label>Trigger</label>
          <select
            value={triggerType}
            onChange={(e) => setTriggerType(e.target.value as Workflow["trigger_type"])}
          >
            <option value="manual">Manual enrollment (via API)</option>
            <option value="list_joined">Subscriber joins a list</option>
            <option value="tag_applied">Tag applied</option>
            <option value="webhook">Webhook received</option>
            <option value="link_clicked">Campaign link clicked</option>
          </select>
          {error && <p className="error-text">{error}</p>}
          <div style={{ marginTop: 16 }}>
            <button type="submit">Create draft</button>
          </div>
        </form>
      )}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Trigger</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {workflows.map((w) => (
            <tr key={w.id}>
              <td>
                <Link to={`/workflows/${w.id}`}>{w.name}</Link>
              </td>
              <td className="muted">{w.trigger_type}</td>
              <td>
                <Badge status={w.status} />
              </td>
            </tr>
          ))}
          {workflows.length === 0 && (
            <tr>
              <td colSpan={3} className="muted">
                No workflows yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
