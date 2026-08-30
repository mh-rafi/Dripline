import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Campaign, CampaignAnalytics, Connection, List, Template } from "../lib/types.js";
import { useEmailHistory } from "../hooks/useEmailHistory.js";
import Badge from "../components/Badge.js";
import ProgressBar from "../components/ProgressBar.js";
import DurationInput from "../components/DurationInput.js";
import PreviewModal from "../components/PreviewModal.js";
import EmailHistoryInput from "../components/EmailHistoryInput.js";
import CampaignEmailsTable from "../components/CampaignEmailsTable.js";
import CampaignUnsubscribesTable from "../components/CampaignUnsubscribesTable.js";
import CampaignReport from "../components/CampaignReport.js";
import ContentTypeEditor, {
  type ContentType,
  type ContentValue,
} from "../components/content-editor/ContentTypeEditor.js";
import {
  PageHeaderWrapper,
  BlockLayout,
  Button,
  Input,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Checkbox,
  CheckboxLabel,
  FormLabel,
  FormRow,
  Popconfirm,
  Skeleton,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../components/ui/index.js";

const EDITABLE: Campaign["status"][] = ["draft", "scheduled", "paused"];

export default function CampaignDetail() {
  const { id } = useParams();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [analytics, setAnalytics] = useState<CampaignAnalytics | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [lists, setLists] = useState<List[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [altBody, setAltBody] = useState("");
  const [contentType, setContentType] = useState<ContentType>("richtext");
  const [content, setContent] = useState<ContentValue>({ body: "", body_source: null });
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [listIds, setListIds] = useState<number[]>([]);
  const [connectionIds, setConnectionIds] = useState<number[]>([]);
  const [rateLimitCount, setRateLimitCount] = useState("");
  const [rateLimitDurationSeconds, setRateLimitDurationSeconds] = useState<number | null>(null);
  const [trackOpens, setTrackOpens] = useState(true);
  const [trackClicks, setTrackClicks] = useState(true);
  const [saving, setSaving] = useState(false);
  const {
    emails: testEmails,
    addEmail: addTestEmail,
    removeEmail: removeTestEmail,
  } = useEmailHistory();
  const [testEmail, setTestEmail] = useState(() => testEmails[0] ?? "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error: string | null } | null>(null);

  const [preview, setPreview] = useState<{
    subject: string;
    preheader: string;
    html: string;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  /** Previews the current in-progress edits -- always a real server-side
   * render (template wrapper, merge fields, markdown conversion), not a
   * client-side approximation. */
  async function showPreview() {
    if (!campaign) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await api.post<{ subject: string; preheader: string; html: string }>(
        "/campaigns/preview",
        {
          subject,
          preheader: preheader || undefined,
          body: content.body,
          body_source: content.body_source,
          content_type: contentType,
          template_id: templateId ? Number(templateId) : undefined,
        },
      );
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
      setName(c.name);
      setSubject(c.subject);
      setPreheader(c.preheader ?? "");
      setAltBody(c.alt_body ?? "");
      setContentType(c.content_type);
      setContent({ body: c.body, body_source: c.body_source });
      setFromEmail(c.from_email ?? "");
      setFromName(c.from_name ?? "");
      setReplyTo(c.reply_to ?? "");
      setTemplateId(c.template_id ? String(c.template_id) : "");
      setRateLimitCount(c.rate_limit_count ? String(c.rate_limit_count) : "");
      setRateLimitDurationSeconds(c.rate_limit_duration_seconds);
      setTrackOpens(c.track_opens);
      setTrackClicks(c.track_clicks);
      setListIds(c.lists?.map((l) => l.id) ?? []);
      setConnectionIds(c.connections?.map((conn) => conn.id) ?? []);
    });
    api.get<CampaignAnalytics>(`/campaigns/${id}/analytics`).then(setAnalytics);
  }

  /** Refreshes only the live status/progress display (status badge, send
   * progress, analytics) -- unlike `load`, it never touches the editable
   * form fields, so it can poll in the background without clobbering
   * in-progress edits (typing, content-type switches, toolbar formatting)
   * every few seconds. */
  function refreshStatus() {
    api.get<Campaign>(`/campaigns/${id}`).then(setCampaign);
    api.get<CampaignAnalytics>(`/campaigns/${id}/analytics`).then(setAnalytics);
  }

  useEffect(() => {
    load();
    const interval = setInterval(refreshStatus, 4000);
    return () => clearInterval(interval);
  }, [id]);

  useEffect(() => {
    api.get<List[]>("/lists").then(setLists);
    api.get<Template[]>("/templates").then(setTemplates);
    api.get<Connection[]>("/connections").then(setConnections);
  }, []);

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
        preheader: preheader || null,
        body: content.body,
        body_source: content.body_source,
        alt_body: altBody || null,
        content_type: contentType,
        from_email: fromEmail || undefined,
        from_name: fromName || null,
        reply_to: replyTo || null,
        template_id: templateId ? Number(templateId) : null,
        rate_limit_count: rateLimitCount ? Number(rateLimitCount) : null,
        rate_limit_duration_seconds: rateLimitDurationSeconds,
        track_opens: trackOpens,
        track_clicks: trackClicks,
      });
      await api.put(`/campaigns/${id}/lists`, { list_ids: listIds });
      await api.put(`/campaigns/${id}/connections`, { connection_ids: connectionIds });
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
    addTestEmail(testEmail);
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.post<{ ok: boolean; error: string | null }>(
        `/campaigns/${id}/test`,
        {
          email: testEmail,
          subject,
          preheader: preheader || null,
          body: content.body,
          body_source: content.body_source,
          alt_body: altBody || null,
          content_type: contentType,
          from_email: fromEmail || null,
          from_name: fromName || null,
          reply_to: replyTo || null,
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
  const defaultTab = campaign.status === "draft" ? "details" : "overview";

  return (
    <div>
      <PageHeaderWrapper
        variant="title-with-actions"
        title={campaign.name}
        actions={<Badge status={campaign.status} />}
      />

      <BlockLayout>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveEdit();
          }}
          className="space-y-4"
        >
          <Tabs defaultValue={defaultTab}>
            <TabsList className="h-[60px]">
              <TabsTrigger value="overview" className="h-full cursor-pointer px-4 text-base">
                Overview
              </TabsTrigger>
              <TabsTrigger value="details" className="h-full cursor-pointer px-4 text-base">
                Details
              </TabsTrigger>
              <TabsTrigger value="content" className="h-full cursor-pointer px-4 text-base">
                Content
              </TabsTrigger>
              <TabsTrigger value="recipients" className="h-full cursor-pointer px-4 text-base">
                Recipients
              </TabsTrigger>
              <TabsTrigger value="settings" className="h-full cursor-pointer px-4 text-base">
                Settings
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div>
                <h3 className="mt-0 text-lg font-semibold">Progress</h3>
                {campaign.progress && <ProgressBar progress={campaign.progress} />}
              </div>

              {analytics && campaign.status !== "draft" && (
                <div>
                  <h3 className="mt-0 mb-2 text-lg font-semibold">Report</h3>
                  <CampaignReport analytics={analytics} />
                </div>
              )}

              <div className="flex gap-2">
                {(campaign.status === "draft" ||
                  campaign.status === "paused" ||
                  campaign.status === "scheduled") && (
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => action(() => api.post(`/campaigns/${id}/start`))}
                  >
                    {campaign.status === "paused" ? "Resume" : "Start sending"}
                  </Button>
                )}
                {campaign.status === "running" && (
                  <Button
                    type="button"
                    disabled={busy}
                    variant="outline"
                    onClick={() => action(() => api.post(`/campaigns/${id}/pause`))}
                  >
                    Pause
                  </Button>
                )}
                {/* Not offered on a draft: there is no send to stop, so the
                    only thing cancelling a draft achieves is making it
                    unusable -- next to "Start sending", that was a trap. */}
                {(campaign.status === "running" || campaign.status === "paused") && (
                  <Popconfirm
                    description="Cancel this campaign? Sending stops and no further emails go out. You can reopen it as a draft afterwards."
                    onConfirm={() => action(() => api.post(`/campaigns/${id}/cancel`))}
                    confirmText="Cancel campaign"
                  >
                    <Button type="button" disabled={busy} variant="destructive">
                      Cancel
                    </Button>
                  </Popconfirm>
                )}
                {campaign.status === "cancelled" && (
                  <Button
                    type="button"
                    disabled={busy}
                    variant="outline"
                    onClick={() => action(() => api.post(`/campaigns/${id}/reopen`))}
                  >
                    Reopen as draft
                  </Button>
                )}
              </div>

              {campaign.status !== "draft" && (
                <Tabs defaultValue="recipients">
                  <TabsList>
                    <TabsTrigger value="recipients">Recipient activity</TabsTrigger>
                    <TabsTrigger value="unsubscribers">
                      Unsubscribers
                      {analytics && analytics.unsubscribes > 0
                        ? ` (${analytics.unsubscribes})`
                        : ""}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="recipients">
                    <CampaignEmailsTable campaignId={campaign.id} />
                  </TabsContent>
                  <TabsContent value="unsubscribers">
                    <CampaignUnsubscribesTable campaignId={campaign.id} />
                  </TabsContent>
                </Tabs>
              )}
            </TabsContent>

            <TabsContent value="details" className="space-y-4">
              <FormRow>
                <div className="space-y-2">
                  <FormLabel required>Name (internal)</FormLabel>
                  <Input
                    required
                    disabled={!canEdit}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <FormLabel>From email (optional override)</FormLabel>
                  <Input
                    type="email"
                    disabled={!canEdit}
                    value={fromEmail}
                    onChange={(e) => setFromEmail(e.target.value)}
                  />
                </div>
              </FormRow>

              <FormRow>
                <div className="space-y-2">
                  <FormLabel>From name (optional override)</FormLabel>
                  <Input
                    disabled={!canEdit}
                    value={fromName}
                    onChange={(e) => setFromName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <FormLabel>Reply-To (optional override)</FormLabel>
                  <Input
                    type="email"
                    disabled={!canEdit}
                    value={replyTo}
                    onChange={(e) => setReplyTo(e.target.value)}
                  />
                </div>
              </FormRow>

              <div className="space-y-2">
                <FormLabel required>Subject</FormLabel>
                <Input
                  required
                  disabled={!canEdit}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <FormLabel>Email pre-header (optional)</FormLabel>
                <Input
                  disabled={!canEdit}
                  maxLength={150}
                  placeholder="A short teaser shown in the inbox, after the subject"
                  value={preheader}
                  onChange={(e) => setPreheader(e.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  Shown by mail clients in the inbox list, next to the subject. Never appears inside
                  the opened email.
                </p>
              </div>

              <div className="space-y-2">
                <FormLabel>Template (optional)</FormLabel>
                <Select
                  value={templateId || "none"}
                  disabled={!canEdit}
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
            </TabsContent>

            <TabsContent value="content" className="space-y-4">
              <div className="space-y-2">
                <FormLabel>
                  Body{" "}
                  <span className="text-muted-foreground text-xs">
                    (supports {"{{ Subscriber.Name }}"} etc.)
                  </span>
                </FormLabel>
                <div className={!canEdit ? "pointer-events-none opacity-70" : undefined}>
                  <ContentTypeEditor
                    contentType={contentType}
                    value={content}
                    onChangeType={setContentType}
                    onChangeValue={setContent}
                  />
                </div>
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

              {contentType !== "plain" && (
                <div className="space-y-2">
                  <FormLabel>Plain-text version (optional)</FormLabel>
                  <Textarea
                    rows={6}
                    disabled={!canEdit}
                    placeholder="Leave empty to generate it automatically from the HTML"
                    value={altBody}
                    onChange={(e) => setAltBody(e.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    Every email is sent with both an HTML and a plain-text part &mdash; HTML-only
                    mail scores worse with spam filters. This one is written for you from the HTML
                    unless you fill it in here. Merge fields work the same way.
                  </p>
                </div>
              )}

              {canEdit && (
                <div className="space-y-2">
                  <FormLabel>Send test email</FormLabel>
                  <div className="flex items-center gap-2">
                    <EmailHistoryInput
                      type="email"
                      placeholder="you@example.com"
                      value={testEmail}
                      onChange={setTestEmail}
                      emails={testEmails}
                      onRemoveEmail={removeTestEmail}
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
                        className={
                          testResult.ok ? "text-success text-sm" : "text-destructive text-sm"
                        }
                      >
                        {testResult.ok ? "Test sent" : `Failed: ${testResult.error}`}
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Tests these unsaved edits directly -- it doesn't save them or count as a real
                    send.
                  </p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="recipients" className="space-y-4">
              <div className="space-y-2">
                <FormLabel>Lists</FormLabel>
                <div className="flex flex-wrap gap-3">
                  {lists.map((l) => (
                    <div key={l.id} className="flex items-center gap-1.5">
                      <Checkbox
                        checked={listIds.includes(l.id)}
                        disabled={!canEdit}
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

              <div className="space-y-2">
                <FormLabel>
                  Sending connections{" "}
                  <span className="text-muted-foreground text-xs">
                    (primary first, then ordered fallbacks)
                  </span>
                </FormLabel>
                <div className="flex flex-wrap items-start gap-3">
                  <select
                    defaultValue=""
                    disabled={!canEdit}
                    onChange={(e) => {
                      addConnection(Number(e.target.value));
                      e.target.value = "";
                    }}
                    className="border-input w-auto rounded-md border bg-transparent px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
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
                        {canEdit && (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setConnectionIds((ids) => ids.filter((x) => x !== cid))
                              }
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
                          </>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            </TabsContent>

            <TabsContent value="settings" className="space-y-4">
              <div className="space-y-2">
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
                    disabled={!canEdit}
                    value={rateLimitCount}
                    onChange={(e) => setRateLimitCount(e.target.value)}
                    placeholder="e.g. 1"
                  />
                  <DurationInput
                    key={campaign.id}
                    seconds={rateLimitDurationSeconds}
                    onChange={setRateLimitDurationSeconds}
                    placeholder="e.g. 5"
                    disabled={!canEdit}
                  />
                </FormRow>
              </div>

              <div className="space-y-2">
                <FormLabel>Tracking</FormLabel>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={trackOpens}
                    disabled={!canEdit}
                    onCheckedChange={(v) => setTrackOpens(v === true)}
                  />
                  <span className="text-sm">Track opens</span>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={trackClicks}
                    disabled={!canEdit}
                    onCheckedChange={(v) => setTrackClicks(v === true)}
                  />
                  <span className="text-sm">Track clicks</span>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {error && <p className="text-destructive text-sm">{error}</p>}
          {canEdit && (
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
              {/* Named "Cancel" until it collided with the campaign-cancel
                  action above -- on a paused campaign both rendered at once,
                  one discarding edits and the other ending the send. */}
              <Popconfirm
                description="Discard your unsaved changes to this campaign?"
                onConfirm={() => load()}
                confirmText="Discard"
              >
                <Button type="button" variant="outline" disabled={saving}>
                  Discard changes
                </Button>
              </Popconfirm>
            </div>
          )}
        </form>
      </BlockLayout>

      {preview && (
        <PreviewModal
          subject={preview.subject}
          preheader={preview.preheader}
          html={preview.html}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
