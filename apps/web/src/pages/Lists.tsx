import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import type { List } from "../lib/types.js";

export default function Lists() {
  const [lists, setLists] = useState<List[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [optin, setOptin] = useState<"single" | "double">("single");
  const [type, setType] = useState<"public" | "private">("private");

  function load() {
    api.get<List[]>("/lists").then(setLists);
  }
  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await api.post("/lists", { name, optin, type });
    setName("");
    setShowForm(false);
    load();
  }

  async function remove(id: number) {
    if (!confirm("Delete this list? Subscribers are not deleted.")) return;
    await api.delete(`/lists/${id}`);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <h2>Lists</h2>
        <button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "New list"}</button>
      </div>

      {showForm && (
        <form className="card" onSubmit={create}>
          <label>Name</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} />
          <div className="form-row">
            <div>
              <label>Opt-in</label>
              <select
                value={optin}
                onChange={(e) => setOptin(e.target.value as "single" | "double")}
              >
                <option value="single">Single opt-in</option>
                <option value="double">Double opt-in</option>
              </select>
            </div>
            <div>
              <label>Visibility</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as "public" | "private")}
              >
                <option value="private">Private</option>
                <option value="public">Public</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <button type="submit">Create</button>
          </div>
        </form>
      )}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Opt-in</th>
            <th>Subscribers</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lists.map((l) => (
            <tr key={l.id}>
              <td>{l.name}</td>
              <td className="muted">{l.optin}</td>
              <td>{l.subscriber_count ?? 0}</td>
              <td>
                <button className="secondary" onClick={() => remove(l.id)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {lists.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No lists yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
