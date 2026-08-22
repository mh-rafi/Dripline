import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import type { Provider } from "../lib/types.js";

export default function Providers() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    from_email: "",
    host: "",
    port: 587,
    username: "",
    password: "",
    weight: 1,
  });

  function load() {
    api.get<Provider[]>("/providers").then(setProviders);
  }
  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await api.post("/providers", {
      name: form.name,
      from_email: form.from_email,
      weight: form.weight,
      config: {
        host: form.host,
        port: Number(form.port),
        username: form.username,
        password: form.password,
      },
    });
    setShowForm(false);
    load();
  }

  async function toggleEnable(p: Provider) {
    if (p.enabled) {
      await api.patch(`/providers/${p.id}`, { enabled: false });
    } else {
      await api.post(`/providers/${p.id}/enable`);
    }
    load();
  }

  async function remove(id: number) {
    if (!confirm("Delete this provider?")) return;
    await api.delete(`/providers/${id}`);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <h2>Sending providers</h2>
        <button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "Add provider"}
        </button>
      </div>

      <p className="muted">
        Configure multiple SMTP providers. Sends are weighted across enabled providers and
        automatically fail over to the next one on error.
      </p>

      {showForm && (
        <form className="card" onSubmit={create}>
          <div className="form-row">
            <div>
              <label>Name</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label>From email</label>
              <input
                type="email"
                required
                value={form.from_email}
                onChange={(e) => setForm({ ...form, from_email: e.target.value })}
              />
            </div>
          </div>
          <div className="form-row">
            <div>
              <label>SMTP host</label>
              <input
                required
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
              />
            </div>
            <div>
              <label>Port</label>
              <input
                type="number"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="form-row">
            <div>
              <label>Username</label>
              <input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
            <div>
              <label>Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
          </div>
          <label>Weight (relative send share among enabled providers)</label>
          <input
            type="number"
            min={1}
            value={form.weight}
            onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })}
          />
          <div style={{ marginTop: 16 }}>
            <button type="submit">Save provider</button>
          </div>
        </form>
      )}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Host</th>
            <th>Weight</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td className="muted">{p.config.host}</td>
              <td>{p.weight}</td>
              <td>
                {p.enabled ? (
                  <span className="badge running">enabled</span>
                ) : (
                  <span className="badge cancelled" title={p.disabled_reason ?? ""}>
                    disabled
                  </span>
                )}
              </td>
              <td className="toolbar" style={{ marginBottom: 0 }}>
                <button className="secondary" onClick={() => toggleEnable(p)}>
                  {p.enabled ? "Disable" : "Enable"}
                </button>
                <button className="secondary" onClick={() => remove(p.id)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {providers.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No providers configured — campaigns can't send until at least one is added.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
