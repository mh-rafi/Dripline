import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Subscriber } from "../lib/types.js";
import Badge from "../components/Badge.js";

export default function Subscribers() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  function load() {
    const query = q ? `?q=${encodeURIComponent(q)}` : "";
    api.get<Subscriber[]>(`/subscribers${query}`).then(setSubscribers);
  }

  useEffect(load, [q]);

  async function createSubscriber(e: React.FormEvent) {
    e.preventDefault();
    await api.post("/subscribers", { email, name });
    setEmail("");
    setName("");
    setShowForm(false);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <h2>Subscribers</h2>
        <button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "Add subscriber"}
        </button>
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
