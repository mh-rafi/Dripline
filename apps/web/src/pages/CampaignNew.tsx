import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Campaign, List, Template } from "../lib/types.js";

export default function CampaignNew() {
  const navigate = useNavigate();
  const [lists, setLists] = useState<List[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("<p>Hi {{ Subscriber.Name }},</p>\n<p>...</p>");
  const [fromEmail, setFromEmail] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [listIds, setListIds] = useState<number[]>([]);
  const [messagesPerMinute, setMessagesPerMinute] = useState(60);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<List[]>("/lists").then(setLists);
    api.get<Template[]>("/templates").then(setTemplates);
  }, []);

  function toggleList(id: number) {
    setListIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const campaign = await api.post<Campaign>("/campaigns", {
        name,
        subject,
        body,
        from_email: fromEmail || undefined,
        template_id: templateId ? Number(templateId) : undefined,
        list_ids: listIds,
        messages_per_minute: messagesPerMinute,
      });
      navigate(`/campaigns/${campaign.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create campaign");
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>New campaign</h2>
      </div>

      <form className="card" onSubmit={submit}>
        <div className="form-row">
          <div>
            <label>Name (internal)</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label>From email (optional override)</label>
            <input type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} />
          </div>
        </div>

        <label>Subject</label>
        <input required value={subject} onChange={(e) => setSubject(e.target.value)} />

        <label>Template (optional)</label>
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">None</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <label>Body (HTML, supports {"{{ Subscriber.Name }}"} etc.)</label>
        <textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} />

        <label>Lists</label>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {lists.map((l) => (
            <label
              key={l.id}
              style={{ display: "flex", alignItems: "center", gap: 6, width: "auto", margin: 0 }}
            >
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={listIds.includes(l.id)}
                onChange={() => toggleList(l.id)}
              />
              {l.name}
            </label>
          ))}
          {lists.length === 0 && <span className="muted">No lists yet — create one first.</span>}
        </div>

        <label>Messages per minute (throttle)</label>
        <input
          type="number"
          min={1}
          value={messagesPerMinute}
          onChange={(e) => setMessagesPerMinute(Number(e.target.value))}
        />

        {error && <p className="error-text">{error}</p>}
        <div style={{ marginTop: 20 }}>
          <button type="submit">Create campaign</button>
        </div>
      </form>
    </div>
  );
}
