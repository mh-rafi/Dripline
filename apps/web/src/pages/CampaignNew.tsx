import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Campaign, Connection, List, Template } from "../lib/types.js";
import { useEmailHistory } from "../hooks/useEmailHistory.js";
import DurationInput from "../components/DurationInput.js";
import ContentTypeEditor, {
  type ContentType,
  type ContentValue,
} from "../components/content-editor/ContentTypeEditor.js";
import PreviewModal from "../components/PreviewModal.js";
import EmailHistoryInput from "../components/EmailHistoryInput.js";
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
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  toast,
} from "../components/ui/index.js";

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
  const [fromName, setFromName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [listIds, setListIds] = useState<number[]>([]);
  const [connectionIds, setConnectionIds] = useState<number[]>([]);
  const [rateLimitCount, setRateLimitCount] = useState("");
  const [rateLimitDurationSeconds, setRateLimitDurationSeconds] = useState<number | null>(null);
  const [trackOpens, setTrackOpens] = useState(true);
  const [trackClicks, setTrackClicks] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Set once a draft has been silently created by a "Send test" click, so a
  // later "Send test" or the real submit reuses/updates the same row instead
  // of creating a new draft campaign every time.
  const [createdId, setCreatedId] = useState<number | null>(null);
  const {
    emails: testEmails,
    addEmail: addTestEmail,
    removeEmail: removeTestEmail,
  } = useEmailHistory();
  const [testEmail, setTestEmail] = useState(() => testEmails[0] ?? "");
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

  /** Required fields are spread across tabs, and a hidden (inactive) tab's
   * inputs are exempt from the browser's own `required` validation -- so a
   * user on e.g. the Content tab could submit past an empty Name on Details
   * with no feedback. This runs regardless of which tab is active. */
  function missingFields(): string[] {
    const missing: string[] = [];
    if (!name.trim()) missing.push("Name");
    if (!subject.trim()) missing.push("Subject");
    if (!content.body.replace(/<[^>]*>/g, "").trim()) missing.push("Body");
    if (listIds.length === 0) missing.push("Recipient list");
    if (connectionIds.length === 0) missing.push("Sending connection");
    return missing;
  }

  function buildPayload() {
    return {
      name,
      subject,
      body: content.body,
      body_source: content.body_source,
      content_type: contentType,
      from_email: fromEmail || undefined,
      from_name: fromName || undefined,
      reply_to: replyTo || undefined,
      template_id: templateId ? Number(templateId) : undefined,
      list_ids: listIds,
      connection_ids: connectionIds,
      rate_limit_count: rateLimitCount ? Number(rateLimitCount) : undefined,
      rate_limit_duration_seconds: rateLimitDurationSeconds ?? undefined,
      track_opens: trackOpens,
      track_clicks: trackClicks,
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
    const missing = missingFields();
    if (missing.length > 0) {
      toast.error(`Missing required fields: ${missing.join(", ")}`);
      return;
    }
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
    addTestEmail(testEmail);
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
      <PageHeaderWrapper variant="title-only" title="New campaign" />

      <BlockLayout>
        <form onSubmit={submit} className="space-y-4">
          <Tabs defaultValue="details">
            <TabsList className="h-[60px]">
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

            <TabsContent value="details" className="space-y-4">
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

              <FormRow>
                <div className="space-y-2">
                  <FormLabel>From name (optional override)</FormLabel>
                  <Input value={fromName} onChange={(e) => setFromName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <FormLabel>Reply-To (optional override)</FormLabel>
                  <Input
                    type="email"
                    value={replyTo}
                    onChange={(e) => setReplyTo(e.target.value)}
                  />
                </div>
              </FormRow>

              <div className="space-y-2">
                <FormLabel required>Subject</FormLabel>
                <Input required value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>

              <div className="space-y-2">
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
            </TabsContent>

            <TabsContent value="content" className="space-y-4">
              <div className="space-y-2">
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
                  Saves this campaign as a draft first (needed to pick a sending connection), then
                  sends a one-off test -- it doesn't count as a real send.
                </p>
              </div>
            </TabsContent>

            <TabsContent value="recipients" className="space-y-4">
              <div className="space-y-2">
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
                    <span className="text-muted-foreground">No lists yet — create one first.</span>
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
                    <span className="text-muted-foreground">
                      No connection selected — at least one is required to send.
                    </span>
                  )}
                </div>
                <ol className="mt-2 list-decimal space-y-1 pl-5">
                  {connectionIds.map((id, i) => {
                    const c = connections.find((x) => x.id === id);
                    return (
                      <li key={id} className="flex items-center gap-1">
                        <span>
                          {i === 0 ? (
                            <strong>primary: </strong>
                          ) : (
                            <span className="text-muted-foreground">fallback: </span>
                          )}
                          {c ? `${c.name} — ${c.from_email} (${c.type})` : id}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setConnectionIds((ids) => ids.filter((x) => x !== id))}
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
                    value={rateLimitCount}
                    onChange={(e) => setRateLimitCount(e.target.value)}
                    placeholder="e.g. 1"
                  />
                  <DurationInput
                    seconds={rateLimitDurationSeconds}
                    onChange={setRateLimitDurationSeconds}
                    placeholder="e.g. 5"
                  />
                </FormRow>
              </div>

              <div className="space-y-2">
                <FormLabel>Tracking</FormLabel>
                <div className="flex items-center gap-3">
                  <Switch checked={trackOpens} onCheckedChange={(v) => setTrackOpens(v === true)} />
                  <span className="text-sm">Track opens</span>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={trackClicks}
                    onCheckedChange={(v) => setTrackClicks(v === true)}
                  />
                  <span className="text-sm">Track clicks</span>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {error && <p className="text-destructive text-sm">{error}</p>}
          <div>
            <Button type="submit">Create campaign</Button>
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
