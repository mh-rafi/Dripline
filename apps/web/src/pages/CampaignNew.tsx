import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Campaign, Connection, List, Template } from "../lib/types.js";
import DurationInput from "../components/DurationInput.js";
import ContentTypeEditor, {
  type ContentType,
  type ContentValue,
} from "../components/content-editor/ContentTypeEditor.js";
import PreviewModal from "../components/PreviewModal.js";

export default function CampaignNew() {
  const navigate = useNavigate();
  const [lists, setLists] = useState<List[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [contentType, setContentType] = useState<ContentType>("richtext");
  const [content, setContent] = useState<ContentValue>({
    body: "<p>Hi {{ Subscriber.Name }},</p>\n<p>...</p>",
    body_source: null,
  });
  const [fromEmail, setFromEmail] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [listIds, setListIds] = useState<number[]>([]);
  const [connectionIds, setConnectionIds] = useState<number[]>([]);
  const [rateLimitCount, setRateLimitCount] = useState("");
  const [rateLimitDurationSeconds, setRateLimitDurationSeconds] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Set once a draft has been silently created by a "Send test" click, so a
  // later "Send test" or the real submit reuses/updates the same row instead
  // of creating a new draft campaign every time.
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error: string | null } | null>(null);

  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  async function showPreview() {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await api.post<{ subject: string; html: string }>("/campaigns/preview", {
        subject,
        body: content.body,
        body_source: content.body_source,
        content_type: contentType,
        template_id: templateId ? Number(templateId) : undefined,
      });
      setPreview(result);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "preview failed");
    } finally {
      setPreviewLoading(false);
    }
  }

  useEffect(() => {
    api.get<List[]>("/lists").then(setLists);
    api.get<Template[]>("/templates").then(setTemplates);
    api.get<Connection[]>("/connections").then(setConnections);
  }, []);

  function toggleList(id: number) {
    setListIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  function addConnection(id: number) {
    if (!id) return;
    setConnectionIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
  }

  function moveConnection(index: number, dir: -1 | 1) {
    setConnectionIds((ids) => {
      const next = [...ids];
      const target = index + dir;
      if (target < 0 || target >= next.length) return ids;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function buildPayload() {
    return {
      name,
      subject,
      body: content.body,
      body_source: content.body_source,
      content_type: contentType,
      from_email: fromEmail || undefined,
      template_id: templateId ? Number(templateId) : undefined,
      list_ids: listIds,
      connection_ids: connectionIds,
      rate_limit_count: rateLimitCount ? Number(rateLimitCount) : undefined,
      rate_limit_duration_seconds: rateLimitDurationSeconds ?? undefined,
    };
  }

  /** Creates the draft on first call; on later calls (e.g. a second "Send
   * test" after more edits, or the final submit after a test was sent)
   * updates that same row instead of creating a duplicate draft. */
  async function persist(): Promise<Campaign> {
    if (createdId) {
      const campaign = await api.patch<Campaign>(`/campaigns/${createdId}`, buildPayload());
      await api.put(`/campaigns/${createdId}/lists`, { list_ids: listIds });
      await api.put(`/campaigns/${createdId}/connections`, { connection_ids: connectionIds });
      return campaign;
    }
    const campaign = await api.post<Campaign>("/campaigns", buildPayload());
    setCreatedId(campaign.id);
    return campaign;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const campaign = await persist();
      navigate(`/campaigns/${campaign.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create campaign");
    }
  }

  async function sendTest(e: React.FormEvent) {
    e.preventDefault();
    if (!testEmail) return;
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      // Saving first (as a draft) is unavoidable here -- unlike editing an
      // existing campaign, there's no row yet to test against.
      const campaign = await persist();
      const result = await api.post<{ ok: boolean; error: string | null }>(
        `/campaigns/${campaign.id}/test`,
        { email: testEmail },
      );
      setTestResult(result);
    } catch (err) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : "failed to send test",
      });
    } finally {
      setTesting(false);
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

        <label>
          Body{" "}
          <span className="muted" style={{ fontSize: 12 }}>
            (supports {"{{ Subscriber.Name }}"} etc.)
          </span>
        </label>
        <ContentTypeEditor
          contentType={contentType}
          value={content}
          onChangeType={setContentType}
          onChangeValue={setContent}
        />
        <div className="toolbar" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="secondary"
            onClick={showPreview}
            disabled={previewLoading}
          >
            {previewLoading ? "Loading preview…" : "Preview"}
          </button>
          {previewError && <span className="error-text">{previewError}</span>}
        </div>

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

        <label>
          Sending connections{" "}
          <span className="muted" style={{ fontSize: 12 }}>
            (primary first, then ordered fallbacks)
          </span>
        </label>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <select
            defaultValue=""
            onChange={(e) => {
              addConnection(Number(e.target.value));
              e.target.value = "";
            }}
            style={{ width: "auto" }}
          >
            <option value="" disabled>
              Add a connection…
            </option>
            {connections
              .filter((c) => !connectionIds.includes(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.from_email} ({c.type})
                </option>
              ))}
          </select>
          {connectionIds.length === 0 && (
            <span className="muted">
              No connection selected — at least one is required to send.
            </span>
          )}
        </div>
        <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
          {connectionIds.map((id, i) => {
            const c = connections.find((x) => x.id === id);
            return (
              <li key={id} style={{ marginBottom: 4 }}>
                {i === 0 ? <strong>primary: </strong> : <span className="muted">fallback: </span>}
                {c ? `${c.name} — ${c.from_email} (${c.type})` : id}
                <button
                  type="button"
                  className="secondary"
                  style={{ marginLeft: 8, padding: "2px 8px" }}
                  onClick={() => setConnectionIds((ids) => ids.filter((x) => x !== id))}
                >
                  remove
                </button>
                <button
                  type="button"
                  className="secondary"
                  style={{ marginLeft: 4, padding: "2px 8px" }}
                  onClick={() => moveConnection(i, -1)}
                  disabled={i === 0}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="secondary"
                  style={{ marginLeft: 4, padding: "2px 8px" }}
                  onClick={() => moveConnection(i, 1)}
                  disabled={i === connectionIds.length - 1}
                >
                  ↓
                </button>
              </li>
            );
          })}
        </ol>

        <label>
          Campaign throttle{" "}
          <span className="muted" style={{ fontSize: 12 }}>
            (optional, additional cap on top of the connection's own rate limit — blank = no extra
            cap)
          </span>
        </label>
        <div className="form-row">
          <input
            type="number"
            min={1}
            value={rateLimitCount}
            onChange={(e) => setRateLimitCount(e.target.value)}
            placeholder="e.g. 1"
          />
          <DurationInput
            seconds={rateLimitDurationSeconds}
            onChange={setRateLimitDurationSeconds}
            placeholder="e.g. 5"
          />
        </div>

        <label>Send test email</label>
        <div className="toolbar">
          <input
            type="email"
            placeholder="you@example.com"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            style={{ maxWidth: 280 }}
          />
          <button
            type="button"
            className="secondary"
            disabled={testing || !testEmail}
            onClick={sendTest}
          >
            {testing ? "Sending…" : "Send test"}
          </button>
          {testResult && (
            <span
              style={{
                color: testResult.ok ? "var(--success)" : "var(--danger, #c00)",
                fontSize: 13,
              }}
            >
              {testResult.ok ? "Test sent" : `Failed: ${testResult.error}`}
            </span>
          )}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
          Saves this campaign as a draft first (needed to pick a sending connection), then sends a
          one-off test -- it doesn't count as a real send.
        </p>

        {error && <p className="error-text">{error}</p>}
        <div style={{ marginTop: 20 }}>
          <button type="submit">Create campaign</button>
        </div>
      </form>

      {preview && (
        <PreviewModal
          subject={preview.subject}
          html={preview.html}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
