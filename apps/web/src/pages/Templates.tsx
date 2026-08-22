import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import type { Template } from "../lib/types.js";

const DEFAULT_BODY = "<div>\n  {{ Body }}\n</div>";

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState(DEFAULT_BODY);

  function load() {
    api.get<Template[]>("/templates").then(setTemplates);
  }
  useEffect(load, []);

  function startNew() {
    setEditing({ id: 0, name: "", subject: "", body: DEFAULT_BODY, is_default: false });
    setName("");
    setBody(DEFAULT_BODY);
  }

  function startEdit(t: Template) {
    setEditing(t);
    setName(t.name);
    setBody(t.body);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (editing.id === 0) {
      await api.post("/templates", { name, body });
    } else {
      await api.patch(`/templates/${editing.id}`, { name, body });
    }
    setEditing(null);
    load();
  }

  async function remove(id: number) {
    if (!confirm("Delete this template?")) return;
    await api.delete(`/templates/${id}`);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <h2>Templates</h2>
        <button onClick={startNew}>New template</button>
      </div>

      {editing && (
        <form className="card" onSubmit={save}>
          <label>Name</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} />
          <label>Body (wrap the campaign content with {"{{ Body }}"})</label>
          <textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="submit">Save</button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td className="toolbar" style={{ marginBottom: 0 }}>
                <button className="secondary" onClick={() => startEdit(t)}>
                  Edit
                </button>
                <button className="secondary" onClick={() => remove(t.id)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {templates.length === 0 && (
            <tr>
              <td colSpan={2} className="muted">
                No templates yet — campaigns can also be sent without one.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
