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
import {
  PageHeaderWrapper,
  BlockLayout,
  Button,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Checkbox,
  CheckboxLabel,
  FormLabel,
  FormRow,
  Skeleton,
} from "../components/ui/index.js";

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

  if (!campaign) return <Skeleton className="h-48" />;

  const canEdit = EDITABLE.includes(campaign.status);

  if (editing) {
    return (
      <div>
        <PageHeaderWrapper
          variant="title-with-actions"
          title="Edit campaign"
          actions={<Badge status={campaign.status} />}
        />

        <BlockLayout>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveEdit();
            }}
          >
            <FormRow>
              <div className="space-y-2">
                <FormLabel required>Name (internal)</FormLabel>
                <Input required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <FormLabel>From email (optional override)</FormLabel>
                <Input
                  type="email"
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                />
              </div>
            </FormRow>

            <div className="mt-4 space-y-2">
              <FormLabel required>Subject</FormLabel>
              <Input required value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>

            <div className="mt-4 space-y-2">
              <FormLabel>Template (optional)</FormLabel>
              <Select
                value={templateId || "none"}
                onValueChange={(v) => setTemplateId(v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="mt-4 space-y-2">
              <FormLabel>
                Body{" "}
                <span className="text-muted-foreground text-xs">
                  (supports {"{{ Subscriber.Name }}"} etc.)
                </span>
              </FormLabel>
              <ContentTypeEditor
                contentType={contentType}
                value={content}
                onChangeType={setContentType}
                onChangeValue={setContent}
              />
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={showPreview}
                  disabled={previewLoading}
                >
                  {previewLoading ? "Loading preview…" : "Preview"}
                </Button>
                {previewError && <span className="text-destructive text-sm">{previewError}</span>}
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <FormLabel>Lists</FormLabel>
              <div className="flex flex-wrap gap-3">
                {lists.map((l) => (
                  <div key={l.id} className="flex items-center gap-1.5">
                    <Checkbox
                      checked={listIds.includes(l.id)}
                      onCheckedChange={() => toggleList(l.id)}
                      id={`list-${l.id}`}
                    />
                    <CheckboxLabel htmlFor={`list-${l.id}`}>{l.name}</CheckboxLabel>
                  </div>
                ))}
                {lists.length === 0 && (
                  <span className="text-muted-foreground">No lists exist yet.</span>
                )}
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <FormLabel>
                Sending connections{" "}
                <span className="text-muted-foreground text-xs">
                  (primary first, then ordered fallbacks)
                </span>
              </FormLabel>
              <div className="flex flex-wrap items-start gap-3">
                <select
                  defaultValue=""
                  onChange={(e) => {
                    addConnection(Number(e.target.value));
                    e.target.value = "";
                  }}
                  className="border-input w-auto rounded-md border bg-transparent px-3 py-2 text-sm"
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
                  <span className="text-muted-foreground">At least one is required to send.</span>
                )}
              </div>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                {connectionIds.map((cid, i) => {
                  const c = connections.find((x) => x.id === cid);
                  return (
                    <li key={cid} className="flex items-center gap-1">
                      <span>
                        {i === 0 ? (
                          <strong>primary: </strong>
                        ) : (
                          <span className="text-muted-foreground">fallback: </span>
                        )}
                        {c ? `${c.name} — ${c.from_email} (${c.type})` : cid}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setConnectionIds((ids) => ids.filter((x) => x !== cid))}
                      >
                        remove
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => moveConnection(i, -1)}
                        disabled={i === 0}
                      >
                        ↑
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => moveConnection(i, 1)}
                        disabled={i === connectionIds.length - 1}
                      >
                        ↓
                      </Button>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="mt-4 space-y-2">
              <FormLabel>
                Campaign throttle{" "}
                <span className="text-muted-foreground text-xs">
                  (optional, additional cap on top of the connection's own rate limit — blank = no
                  extra cap)
                </span>
              </FormLabel>
              <FormRow>
                <Input
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
              </FormRow>
            </div>

            <div className="mt-4 space-y-2">
              <FormLabel>Send test email</FormLabel>
              <div className="flex items-center gap-2">
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  className="max-w-[280px]"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={testing || !testEmail}
                  onClick={sendTest}
                >
                  {testing ? "Sending…" : "Send test"}
                </Button>
                {testResult && (
                  <span
                    className={testResult.ok ? "text-success text-sm" : "text-destructive text-sm"}
                  >
                    {testResult.ok ? "Test sent" : `Failed: ${testResult.error}`}
                  </span>
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                Tests these unsaved edits directly -- it doesn't save them or count as a real send.
              </p>
            </div>

            {error && <p className="text-destructive mt-4 text-sm">{error}</p>}
            <div className="mt-4 flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  load();
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </BlockLayout>

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
      <PageHeaderWrapper
        variant="title-with-actions"
        title={campaign.name}
        actions={<Badge status={campaign.status} />}
      />

      <BlockLayout>
        <div>
          <strong>Subject:</strong> {campaign.subject}
        </div>
        <div className="mt-2">
          <strong>Lists:</strong>{" "}
          {campaign.lists?.map((l) => l.name).join(", ") || (
            <span className="text-muted-foreground">none</span>
          )}
        </div>
        <div className="mt-2">
          <strong>Connections:</strong>{" "}
          {campaign.connections && campaign.connections.length > 0 ? (
            campaign.connections.map((c, i) => (
              <span key={c.id} className="text-muted-foreground">
                {i === 0 ? `${c.name}` : ` → ${c.name}`}
              </span>
            ))
          ) : (
            <span className="text-muted-foreground">none</span>
          )}
        </div>
        <div className="mt-2">
          <strong>Throttle:</strong>{" "}
          {formatRateLimit(campaign.rate_limit_count, campaign.rate_limit_duration_seconds)}
        </div>
      </BlockLayout>

      <BlockLayout>
        <h3 className="mt-0 text-lg font-semibold">Progress</h3>
        {campaign.progress && <ProgressBar progress={campaign.progress} />}
      </BlockLayout>

      {analytics && (
        <BlockLayout>
          <h3 className="mt-0 text-lg font-semibold">Engagement</h3>
          <FormRow>
            <div>
              <div className="text-muted-foreground">Opens</div>
              <div className="text-xl font-semibold">
                {analytics.unique_opens}{" "}
                <span className="text-muted-foreground text-sm">({analytics.opens} total)</span>
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Clicks</div>
              <div className="text-xl font-semibold">
                {analytics.unique_clicks}{" "}
                <span className="text-muted-foreground text-sm">({analytics.clicks} total)</span>
              </div>
            </div>
          </FormRow>
        </BlockLayout>
      )}

      {error && <p className="text-destructive mt-4 text-sm">{error}</p>}

      <div className="mt-4 flex gap-2">
        {canEdit && (
          <Button disabled={busy} onClick={beginEdit}>
            Edit
          </Button>
        )}
        {(campaign.status === "draft" ||
          campaign.status === "paused" ||
          campaign.status === "scheduled") && (
          <Button disabled={busy} onClick={() => action(() => api.post(`/campaigns/${id}/start`))}>
            {campaign.status === "paused" ? "Resume" : "Start sending"}
          </Button>
        )}
        {campaign.status === "running" && (
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => action(() => api.post(`/campaigns/${id}/pause`))}
          >
            Pause
          </Button>
        )}
        {(campaign.status === "running" ||
          campaign.status === "paused" ||
          campaign.status === "draft") && (
          <Button
            disabled={busy}
            variant="destructive"
            onClick={() => action(() => api.post(`/campaigns/${id}/cancel`))}
          >
            Cancel
          </Button>
        )}
      </div>

      <BlockLayout>
        <h3 className="mt-0 text-lg font-semibold">Body</h3>
        <div className="flex gap-2">
          <Button variant="outline" onClick={showPreview} disabled={previewLoading}>
            {previewLoading ? "Loading preview…" : "Preview"}
          </Button>
          {previewError && <span className="text-destructive text-sm">{previewError}</span>}
        </div>
      </BlockLayout>

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
