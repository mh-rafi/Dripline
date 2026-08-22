import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import type { List, Subscriber } from "../lib/types.js";
import Badge from "../components/Badge.js";

interface SubscriberWithLists extends Subscriber {
  lists: { id: number; name: string; optin: "single" | "double"; status: string }[];
}

/** Single opt-in lists don't gate sending on unconfirmed/confirmed at all --
 * showing that distinction there just reads as "needs action" when it
 * doesn't. Only double opt-in lists actually require confirmation before a
 * subscriber receives campaigns (see queries/campaigns.ts eligibility). */
function listMembershipBadge(l: { optin: "single" | "double"; status: string }) {
  if (l.status === "unsubscribed") {
    return {
      status: "unsubscribed",
      label: "unsubscribed",
      title: "Won't receive campaigns from this list.",
    };
  }
  if (l.optin === "double") {
    return l.status === "confirmed"
      ? {
          status: "confirmed",
          label: "confirmed",
          title: "Confirmed their double opt-in -- eligible to receive campaigns.",
        }
      : {
          status: "unconfirmed",
          label: "awaiting confirmation",
          title:
            "Double opt-in list: excluded from campaigns until they confirm. No confirmation email is sent yet -- this flow isn't built.",
        };
  }
  return {
    status: "confirmed",
    label: "subscribed",
    title: "Single opt-in list -- eligible to receive campaigns.",
  };
}

export default function SubscriberDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [subscriber, setSubscriber] = useState<SubscriberWithLists | null>(null);
  const [lists, setLists] = useState<List[]>([]);
  const [addListId, setAddListId] = useState<string>("");
  const [newTag, setNewTag] = useState("");
  const [editingProfile, setEditingProfile] = useState(false);
  const [name, setName] = useState("");
  const [attribsText, setAttribsText] = useState("{}");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

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
    if (
      !confirm(
        "Blocklist this subscriber? They'll be unsubscribed from every list and excluded from all future campaigns.",
      )
    )
      return;
    await api.post(`/subscribers/${id}/blocklist`);
    load();
  }

  async function unblocklist() {
    if (
      !confirm(
        "Remove this subscriber from the blocklist? They will not be automatically re-added to any lists -- do that separately if appropriate.",
      )
    )
      return;
    await api.post(`/subscribers/${id}/unblocklist`);
    load();
  }

  async function remove() {
    if (!confirm("Delete this subscriber permanently?")) return;
    await api.delete(`/subscribers/${id}`);
    navigate("/subscribers");
  }

  function beginEditProfile() {
    if (!subscriber) return;
    setName(subscriber.name);
    setAttribsText(JSON.stringify(subscriber.attribs, null, 2));
    setProfileError(null);
    setEditingProfile(true);
  }

  async function saveProfile() {
    let attribs: Record<string, unknown>;
    try {
      attribs = JSON.parse(attribsText);
    } catch {
      setProfileError("Attributes must be valid JSON.");
      return;
    }
    setSavingProfile(true);
    setProfileError(null);
    try {
      await api.patch(`/subscribers/${id}`, { name, attribs });
      setEditingProfile(false);
      load();
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSavingProfile(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>{subscriber.email}</h2>
        <Badge status={subscriber.status} />
      </div>

      <div className="card">
        {editingProfile ? (
          <>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <label>Attributes (JSON)</label>
            <textarea
              rows={8}
              value={attribsText}
              onChange={(e) => setAttribsText(e.target.value)}
              style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
            />
            {profileError && <p className="error-text">{profileError}</p>}
            <div className="toolbar" style={{ marginTop: 12 }}>
              <button onClick={saveProfile} disabled={savingProfile}>
                {savingProfile ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={savingProfile}
                onClick={() => {
                  setEditingProfile(false);
                  setProfileError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <strong>Name:</strong> {subscriber.name || <span className="muted">—</span>}
            </div>
            <div style={{ marginTop: 8 }}>
              <strong>Attributes:</strong>
              <pre>{JSON.stringify(subscriber.attribs, null, 2)}</pre>
            </div>
            <div className="toolbar" style={{ marginTop: 12 }}>
              <button className="secondary" onClick={beginEditProfile}>
                Edit
              </button>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Lists</h3>
        <table>
          <tbody>
            {subscriber.lists.map((l) => {
              const badge = listMembershipBadge(l);
              return (
                <tr key={l.id}>
                  <td>
                    {l.name} <span className="muted">({l.optin} opt-in)</span>
                  </td>
                  <td>
                    <Badge status={badge.status} label={badge.label} title={badge.title} />
                  </td>
                  <td>
                    <button className="secondary" onClick={() => removeFromList(l.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
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
        {subscriber.status === "blocklisted" ? (
          <button className="secondary" onClick={unblocklist}>
            Remove from blocklist
          </button>
        ) : (
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
