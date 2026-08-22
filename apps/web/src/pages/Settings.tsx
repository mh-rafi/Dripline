import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import type { ApiKey } from "../lib/types.js";

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
    if (!confirm("Revoke this API key?")) return;
    await api.delete(`/api-keys/${id}`);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <h2>Settings</h2>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>API keys</h3>
        <p className="muted">
          Use an API key to integrate external services with Dripline's HTTP API (create
          subscribers, trigger webhooks, etc).
        </p>

        {revealed && (
          <div className="card" style={{ borderColor: "var(--accent)" }}>
            <strong>Copy this key now — it won't be shown again:</strong>
            <pre>{revealed}</pre>
            <button className="secondary" onClick={() => setRevealed(null)}>
              Dismiss
            </button>
          </div>
        )}

        <form className="toolbar" onSubmit={create}>
          <input
            placeholder="Key name, e.g. 'CRM integration'"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ maxWidth: 280 }}
          />
          <button type="submit">Generate key</button>
        </form>

        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Last used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td className="muted">{k.key_prefix}</td>
                <td className="muted">
                  {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "never"}
                </td>
                <td>
                  <button className="secondary" onClick={() => remove(k.id)}>
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No API keys yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
