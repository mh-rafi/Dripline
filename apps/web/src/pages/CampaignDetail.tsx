import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Campaign, Connection, List, Template } from "../lib/types.js";
import Badge from "../components/Badge.js";
import ProgressBar from "../components/ProgressBar.js";
import DurationInput from "../components/DurationInput.js";
import PreviewModal from "../components/PreviewModal.js";
import ContentTypeEditor, {
  type ContentType,
  type ContentValue,
} from "../components/content-editor/ContentTypeEditor.js";

interface Analytics {
  opens: number;
  unique_opens: number;
  clicks: number;
  unique_clicks: number;
}

const EDITABLE: Campaign["status"][] = ["draft", "scheduled", "paused"];

function formatRateLimit(count: number | null, durationSeconds: number | null): string {
  if (!count || !durationSeconds) return "no extra cap (limited only by the connection)";
  const mins = durationSeconds / 60;
  const window = mins >= 60 ? `${mins / 60}h` : mins >= 1 ? `${mins}m` : `${durationSeconds}s`;
  return `${count} / ${window}`;
}

export default function CampaignDetail() {
  const { id } = useParams();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [lists, setLists] = useState<List[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [contentType, setContentType] = useState<ContentType>("richtext");
  const [content, setContent] = useState<ContentValue>({ body: "", body_source: null });
  const [fromEmail, setFromEmail] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [listIds, setListIds] = useState<number[]>([]);
  const [connectionIds, setConnectionIds] = useState<number[]>([]);
  const [rateLimitCount, setRateLimitCount] = useState("");
  const [rateLimitDurationSeconds, setRateLimitDurationSeconds] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error: string | null } | null>(null);

  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  /** Previews the current in-progress edits while editing, or the saved
   * campaign as-is otherwise -- either way it's a real server-side render
   * (template wrapper, merge fields, markdown conversion), not a client-side
   * approximation. */
  async function showPreview() {
    if (!campaign) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await api.post<{ subject: string; html: string }>("/campaigns/preview", {
        subject: editing ? subject : campaign.subject,
        body: editing ? content.body : campaign.body,
        body_source: editing ? content.body_source : campaign.body_source,
        content_type: editing ? contentType : campaign.content_type,
        template_id: editing
          ? templateId
            ? Number(templateId)
            : undefined
          : (campaign.template_id ?? undefined),
      });
      setPreview(result);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "preview failed");
    } finally {
      setPreviewLoading(false);
    }
  }

  function load() {
    api.get<Campaign>(`/campaigns/${id}`).then((c) => {
      setCampaign(c);
      if (!editing) {
        setName(c.name);
        setSubject(c.subject);
        setContentType(c.content_type);
        setContent({ body: c.body, body_source: c.body_source });
        setFromEmail(c.from_email ?? "");
        setTemplateId(c.template_id ? String(c.template_id) : "");
        setRateLimitCount(c.rate_limit_count ? String(c.rate_limit_count) : "");
        setRateLimitDurationSeconds(c.rate_limit_duration_seconds);
        setListIds(c.lists?.map((l) => l.id) ?? []);
        setConnectionIds(c.connections?.map((conn) => conn.id) ?? []);
      }
    });
    api.get<Analytics>(`/campaigns/${id}/analytics`).then(setAnalytics);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [id, editing]);

  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "action failed");
    } finally {
      setBusy(false);
    }
  }

  async function beginEdit() {
    setError(null);
    await Promise.all([
      api.get<List[]>("/lists").then(setLists),
      api.get<Template[]>("/templates").then(setTemplates),
      api.get<Connection[]>("/connections").then(setConnections),
    ]);
    if (!campaign) return;
    setName(campaign.name);
    setSubject(campaign.subject);
    setContentType(campaign.content_type);
    setContent({ body: campaign.body, body_source: campaign.body_source });
    setFromEmail(campaign.from_email ?? "");
    setTemplateId(campaign.template_id ? String(campaign.template_id) : "");
    setRateLimitCount(campaign.rate_limit_count ? String(campaign.rate_limit_count) : "");
    setRateLimitDurationSeconds(campaign.rate_limit_duration_seconds);
    setListIds(campaign.lists?.map((l) => l.id) ?? []);
    setConnectionIds(campaign.connections?.map((c) => c.id) ?? []);
    setEditing(true);
  }

  function toggleList(lid: number) {
    setListIds((ids) => (ids.includes(lid) ? ids.filter((x) => x !== lid) : [...ids, lid]));
  }

  function addConnection(cid: number) {
    if (!cid) return;
    setConnectionIds((ids) => (ids.includes(cid) ? ids : [...ids, cid]));
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

  async function saveEdit() {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/campaigns/${id}`, {
        name,
        subject,
        body: content.body,
        body_source: content.body_source,
        content_type: contentType,
        from_email: fromEmail || undefined,
        template_id: templateId ? Number(templateId) : null,
        rate_limit_count: rateLimitCount ? Number(rateLimitCount) : null,
        rate_limit_duration_seconds: rateLimitDurationSeconds,
      });
      await api.put(`/campaigns/${id}/lists`, { list_ids: listIds });
      await api.put(`/campaigns/${id}/connections`, { connection_ids: connectionIds });
      setEditing(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  /** Tests the *current, possibly-unsaved* edits -- overrides are sent
   * straight through without touching the saved campaign row, so you can try
   * something out before committing to "Save changes". */
  async function sendTest(e: React.FormEvent) {
    e.preventDefault();
    if (!testEmail) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.post<{ ok: boolean; error: string | null }>(
        `/campaigns/${id}/test`,
        {
          email: testEmail,
          subject,
          body: content.body,
          body_source: content.body_source,
          content_type: contentType,
          from_email: fromEmail || null,
          template_id: templateId ? Number(templateId) : null,
        },
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

  if (!campaign) return <p className="muted">Loading…</p>;

  const canEdit = EDITABLE.includes(campaign.status);

  if (editing) {
    return (
      <div>
        <div className="page-header">
          <h2>Edit campaign</h2>
          <Badge status={campaign.status} />
        </div>

        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            saveEdit();
          }}
        >
          <div className="form-row">
            <div>
              <label>Name (internal)</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label>From email (optional override)</label>
              <input
                type="email"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
              />
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
            {lists.length === 0 && <span className="muted">No lists exist yet.</span>}
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
              <span className="muted">At least one is required to send.</span>
            )}
          </div>
          <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            {connectionIds.map((cid, i) => {
              const c = connections.find((x) => x.id === cid);
              return (
                <li key={cid} style={{ marginBottom: 4 }}>
                  {i === 0 ? <strong>primary: </strong> : <span className="muted">fallback: </span>}
                  {c ? `${c.name} — ${c.from_email} (${c.type})` : cid}
                  <button
                    type="button"
                    className="secondary"
                    style={{ marginLeft: 8, padding: "2px 8px" }}
                    onClick={() => setConnectionIds((ids) => ids.filter((x) => x !== cid))}
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
              key={campaign.id}
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
            Tests these unsaved edits directly -- it doesn't save them or count as a real send.
          </p>

          {error && <p className="error-text">{error}</p>}
          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={saving}
              onClick={() => {
                setEditing(false);
                load();
              }}
            >
              Cancel
            </button>
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

  return (
    <div>
      <div className="page-header">
        <h2>{campaign.name}</h2>
        <Badge status={campaign.status} />
      </div>

      <div className="card">
        <div>
          <strong>Subject:</strong> {campaign.subject}
        </div>
        <div style={{ marginTop: 8 }}>
          <strong>Lists:</strong>{" "}
          {campaign.lists?.map((l) => l.name).join(", ") || <span className="muted">none</span>}
        </div>
        <div style={{ marginTop: 8 }}>
          <strong>Connections:</strong>{" "}
          {campaign.connections && campaign.connections.length > 0 ? (
            campaign.connections.map((c, i) => (
              <span key={c.id} className="muted">
                {i === 0 ? `${c.name}` : ` → ${c.name}`}
              </span>
            ))
          ) : (
            <span className="muted">none</span>
          )}
        </div>
        <div style={{ marginTop: 8 }}>
          <strong>Throttle:</strong>{" "}
          {formatRateLimit(campaign.rate_limit_count, campaign.rate_limit_duration_seconds)}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Progress</h3>
        {campaign.progress && <ProgressBar progress={campaign.progress} />}
      </div>

      {analytics && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Engagement</h3>
          <div className="form-row">
            <div>
              <div className="muted">Opens</div>
              <div style={{ fontSize: 22 }}>
                {analytics.unique_opens}{" "}
                <span className="muted" style={{ fontSize: 14 }}>
                  ({analytics.opens} total)
                </span>
              </div>
            </div>
            <div>
              <div className="muted">Clicks</div>
              <div style={{ fontSize: 22 }}>
                {analytics.unique_clicks}{" "}
                <span className="muted" style={{ fontSize: 14 }}>
                  ({analytics.clicks} total)
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      <div className="toolbar">
        {canEdit && (
          <button disabled={busy} onClick={beginEdit}>
            Edit
          </button>
        )}
        {(campaign.status === "draft" ||
          campaign.status === "paused" ||
          campaign.status === "scheduled") && (
          <button disabled={busy} onClick={() => action(() => api.post(`/campaigns/${id}/start`))}>
            {campaign.status === "paused" ? "Resume" : "Start sending"}
          </button>
        )}
        {campaign.status === "running" && (
          <button
            disabled={busy}
            className="secondary"
            onClick={() => action(() => api.post(`/campaigns/${id}/pause`))}
          >
            Pause
          </button>
        )}
        {(campaign.status === "running" ||
          campaign.status === "paused" ||
          campaign.status === "draft") && (
          <button
            disabled={busy}
            className="danger"
            onClick={() => action(() => api.post(`/campaigns/${id}/cancel`))}
          >
            Cancel
          </button>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Body</h3>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button className="secondary" onClick={showPreview} disabled={previewLoading}>
            {previewLoading ? "Loading preview…" : "Preview"}
          </button>
          {previewError && <span className="error-text">{previewError}</span>}
        </div>
      </div>

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
