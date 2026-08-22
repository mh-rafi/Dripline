import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import type { List, Subscriber } from "../lib/types.js";
import Badge from "../components/Badge.js";

interface SubscriberWithLists extends Subscriber {
  lists: { id: number; name: string; status: string }[];
}

export default function SubscriberDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [subscriber, setSubscriber] = useState<SubscriberWithLists | null>(null);
  const [lists, setLists] = useState<List[]>([]);
  const [addListId, setAddListId] = useState<string>("");
  const [newTag, setNewTag] = useState("");

  function load() {
    api.get<SubscriberWithLists>(`/subscribers/${id}`).then(setSubscriber);
  }

  useEffect(() => {
    load();
    api.get<List[]>("/lists").then(setLists);
  }, [id]);

  if (!subscriber) return <p className="muted">Loading…</p>;

  const tags = Array.isArray(subscriber.attribs.tags) ? (subscriber.attribs.tags as string[]) : [];
  const availableLists = lists.filter((l) => !subscriber.lists.some((sl) => sl.id === l.id));

  async function addToList() {
    if (!addListId) return;
    await api.put(`/subscribers/${id}/lists/${addListId}`, {});
    setAddListId("");
    load();
  }

  async function removeFromList(listId: number) {
    await api.delete(`/subscribers/${id}/lists/${listId}`);
    load();
  }

  async function addTag(e: React.FormEvent) {
    e.preventDefault();
    if (!newTag) return;
    await api.put(`/subscribers/${id}/tags/${encodeURIComponent(newTag)}`, {});
    setNewTag("");
    load();
  }

  async function removeTag(tag: string) {
    await api.delete(`/subscribers/${id}/tags/${encodeURIComponent(tag)}`);
    load();
  }

  async function blocklist() {
    await api.post(`/subscribers/${id}/blocklist`);
    load();
  }

  async function remove() {
    if (!confirm("Delete this subscriber permanently?")) return;
    await api.delete(`/subscribers/${id}`);
    navigate("/subscribers");
  }

  return (
    <div>
      <div className="page-header">
        <h2>{subscriber.email}</h2>
        <Badge status={subscriber.status} />
      </div>

      <div className="card">
        <div>
          <strong>Name:</strong> {subscriber.name || <span className="muted">—</span>}
        </div>
        <div style={{ marginTop: 8 }}>
          <strong>Attributes:</strong>
          <pre>{JSON.stringify(subscriber.attribs, null, 2)}</pre>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Lists</h3>
        <table>
          <tbody>
            {subscriber.lists.map((l) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td>
                  <Badge status={l.status} />
                </td>
                <td>
                  <button className="secondary" onClick={() => removeFromList(l.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <select
            value={addListId}
            onChange={(e) => setAddListId(e.target.value)}
            style={{ maxWidth: 240 }}
          >
            <option value="">Add to list…</option>
            {availableLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <button onClick={addToList} disabled={!addListId}>
            Add
          </button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Tags</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {tags.map((t) => (
            <span key={t} className="badge draft">
              {t}{" "}
              <button
                className="secondary"
                style={{ padding: "0 4px", marginLeft: 4, fontSize: 11 }}
                onClick={() => removeTag(t)}
              >
                ×
              </button>
            </span>
          ))}
          {tags.length === 0 && <span className="muted">No tags.</span>}
        </div>
        <form className="toolbar" onSubmit={addTag}>
          <input
            placeholder="new tag"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            style={{ maxWidth: 200 }}
          />
          <button type="submit">Add tag</button>
        </form>
      </div>

      <div className="toolbar">
        {subscriber.status !== "blocklisted" && (
          <button className="danger" onClick={blocklist}>
            Blocklist
          </button>
        )}
        <button className="danger" onClick={remove}>
          Delete
        </button>
      </div>
    </div>
  );
}
