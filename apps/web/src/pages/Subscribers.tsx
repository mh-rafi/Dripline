import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import type { List, Subscriber } from "../lib/types.js";
import Badge from "../components/Badge.js";

export default function Subscribers() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"enabled" | "blocklisted">("enabled");
  const [listIds, setListIds] = useState<number[]>([]);
  const [preconfirm, setPreconfirm] = useState(false);
  const [attribsText, setAttribsText] = useState("{}");
  const [error, setError] = useState<string | null>(null);

  function load() {
    const query = q ? `?q=${encodeURIComponent(q)}` : "";
    api.get<Subscriber[]>(`/subscribers${query}`).then(setSubscribers);
  }

  useEffect(load, [q]);
  useEffect(() => {
    api.get<List[]>("/lists").then(setLists);
  }, []);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create subscriber");
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>Subscribers</h2>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <Link to="/subscribers/import" className="btn secondary">
            Import
          </Link>
          <button
            onClick={() => {
              if (showForm) resetForm();
              setShowForm((v) => !v);
            }}
          >
            {showForm ? "Cancel" : "Add subscriber"}
          </button>
        </div>
      </div>

      {showForm && (
        <form className="card" onSubmit={createSubscriber}>
          <div className="form-row">
            <div>
              <label>Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>

          <label>Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as "enabled" | "blocklisted")}
          >
            <option value="enabled">Enabled</option>
            <option value="blocklisted">Blocklisted</option>
          </select>
          <p className="muted" style={{ fontSize: 12 }}>
            Blocklisted subscribers will never receive any campaigns.
          </p>

          <label>Lists</label>
          <select
            multiple
            value={listIds.map(String)}
            onChange={(e) =>
              setListIds(Array.from(e.target.selectedOptions, (o) => Number(o.value)))
            }
            size={Math.min(Math.max(lists.length, 3), 8)}
          >
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.optin})
              </option>
            ))}
          </select>
          {lists.length === 0 && <p className="muted">No lists yet.</p>}
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Ctrl/Cmd-click (or Shift-click) to select multiple lists.
          </p>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={preconfirm}
              onChange={(e) => setPreconfirm(e.target.checked)}
              disabled={listIds.length === 0}
            />
            Preconfirm subscriptions
          </label>
          <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
            Mark all selected lists as confirmed immediately, regardless of opt-in type -- use for
            known-good imports, not for new sign-ups.
          </p>

          <label>Attributes (JSON)</label>
          <textarea
            rows={4}
            value={attribsText}
            onChange={(e) => setAttribsText(e.target.value)}
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          />

          {error && <p className="error-text">{error}</p>}
          <div style={{ marginTop: 16 }}>
            <button type="submit">Create</button>
          </div>
        </form>
      )}

      <div className="toolbar">
        <input
          placeholder="Search by email or name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 320 }}
        />
      </div>

      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Name</th>
            <th>Status</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>
          {subscribers.map((s) => (
            <tr key={s.id}>
              <td>
                <Link to={`/subscribers/${s.id}`}>{s.email}</Link>
              </td>
              <td>{s.name || <span className="muted">—</span>}</td>
              <td>
                <Badge status={s.status} />
              </td>
              <td className="muted">{new Date(s.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
          {subscribers.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No subscribers found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
