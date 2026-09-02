import { useEffect, useState } from "react";
import { Clock, ListMinus, ListPlus, MailPlus } from "lucide-react";
import { api } from "../lib/api.js";
import { useEmailHistory } from "../hooks/useEmailHistory.js";
import EmailHistoryInput from "../components/EmailHistoryInput.js";
import PreviewModal from "../components/PreviewModal.js";
import ContentTypeEditor, {
  type ContentType,
} from "../components/content-editor/ContentTypeEditor.js";
import { ConnectionChainPicker, ListPicker } from "./fields.js";
import { useAutomationData } from "./context.js";
import {
  boolOf,
  listIdsOf,
  listNames,
  numberOf,
  stringOf,
  type NodeConfig,
  type NodeUi,
  type SettingsProps,
  type SummaryContext,
} from "./registry.js";
import {
  Button,
  FormLabel,
  Input,
  Switch,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/index.js";

const UNITS = ["minutes", "hours", "days"] as const;
type Unit = (typeof UNITS)[number];

function unitOf(config: NodeConfig): Unit {
  const value = config.unit;
  return UNITS.includes(value as Unit) ? (value as Unit) : "days";
}

function WaitSettings({ config, onChange }: SettingsProps) {
  return (
    <div className="space-y-2">
      <FormLabel required>Wait for</FormLabel>
      <div className="flex gap-2">
        <Input
          type="number"
          min={1}
          value={numberOf(config, "amount", 1)}
          onChange={(e) =>
            onChange({ ...config, amount: Math.max(1, Number(e.target.value) || 1) })
          }
          className="flex-1"
        />
        <Select value={unitOf(config)} onValueChange={(unit) => onChange({ ...config, unit })}>
          <SelectTrigger width="auto" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UNITS.map((unit) => (
              <SelectItem key={unit} value={unit}>
                {unit}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-muted-foreground text-xs">
        The contact waits here, then continues with the next block.
      </p>
    </div>
  );
}

function ApplyListSettings({ config, onChange }: SettingsProps) {
  const status = stringOf(config, "status", "");
  return (
    <div className="space-y-4">
      <ListPicker
        label="Lists to apply"
        value={listIdsOf(config)}
        onChange={(list_ids) => onChange({ ...config, list_ids })}
        emptyHint="Pick at least one list."
      />
      <div className="space-y-2">
        <FormLabel>Subscription status</FormLabel>
        <Select
          value={status || "default"}
          onValueChange={(v) => onChange({ ...config, status: v === "default" ? undefined : v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Per list opt-in setting (recommended)</SelectItem>
            <SelectItem value="unconfirmed">Unconfirmed</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          Leave on the default so double opt-in lists still ask the contact to confirm.
        </p>
      </div>
    </div>
  );
}

function RemoveListSettings({ config, onChange }: SettingsProps) {
  return (
    <ListPicker
      label="Lists to remove"
      value={listIdsOf(config)}
      onChange={(list_ids) => onChange({ ...config, list_ids })}
      emptyHint="Pick at least one list."
    />
  );
}

const EMAIL_CONTENT_TYPES: ContentType[] = ["richtext", "html", "markdown", "plain"];

function contentTypeOf(config: NodeConfig): ContentType {
  const value = config.content_type;
  return EMAIL_CONTENT_TYPES.includes(value as ContentType) ? (value as ContentType) : "richtext";
}

function numbersOf(config: NodeConfig, key: string): number[] {
  const value = config[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is number => typeof v === "number");
}

function SendCustomEmailSettings({ config, onChange, automation, nodeId }: SettingsProps) {
  const { templates } = useAutomationData();
  const connectionId = typeof config.connection_id === "number" ? config.connection_id : undefined;
  const templateId = typeof config.template_id === "number" ? String(config.template_id) : "none";
  const bodySource = config.body_source;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <FormLabel required>Subject</FormLabel>
        <Input
          value={stringOf(config, "subject")}
          onChange={(e) => onChange({ ...config, subject: e.target.value })}
          placeholder="Your first steps with us"
        />
      </div>

      <div className="space-y-2">
        <FormLabel required>
          Body{" "}
          <span className="text-muted-foreground text-xs">
            (supports {"{{ Subscriber.Name }}"}, {"{{ UnsubscribeURL }}"})
          </span>
        </FormLabel>
        <ContentTypeEditor
          contentType={contentTypeOf(config)}
          value={{
            body: stringOf(config, "body"),
            body_source: typeof bodySource === "string" ? bodySource : null,
          }}
          allowedTypes={EMAIL_CONTENT_TYPES}
          mergeFieldScope="automation"
          onChangeType={(content_type) => onChange({ ...config, content_type })}
          onChangeValue={(value) =>
            onChange({ ...config, body: value.body, body_source: value.body_source })
          }
        />
      </div>

      <div className="space-y-2">
        <FormLabel>Template (optional)</FormLabel>
        <Select
          value={templateId}
          onValueChange={(v) =>
            onChange({ ...config, template_id: v === "none" ? null : Number(v) })
          }
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
        <p className="text-muted-foreground text-xs">
          Wraps the body in the template's {"{{ Body }}"} slot. Ignored for plain-text emails.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <FormLabel>From name (optional)</FormLabel>
          <Input
            value={stringOf(config, "from_name")}
            onChange={(e) => onChange({ ...config, from_name: e.target.value || null })}
            placeholder="Leave blank to use the connection's"
          />
        </div>
        <div className="space-y-2">
          <FormLabel>Reply-to (optional)</FormLabel>
          <Input
            type="email"
            value={stringOf(config, "reply_to")}
            onChange={(e) => onChange({ ...config, reply_to: e.target.value || null })}
            placeholder="replies@example.com"
          />
        </div>
      </div>

      <div className="space-y-2">
        <FormLabel>Tracking</FormLabel>
        <div className="flex items-center gap-3">
          <Switch
            checked={boolOf(config, "track_opens")}
            onCheckedChange={(v) => onChange({ ...config, track_opens: v === true })}
          />
          <span className="text-sm">Track opens</span>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={boolOf(config, "track_clicks")}
            onCheckedChange={(v) => onChange({ ...config, track_clicks: v === true })}
          />
          <span className="text-sm">Track clicks</span>
        </div>
        <p className="text-muted-foreground text-xs">
          Counted per step, not per automation. Previews and test sends are never counted.
        </p>
      </div>

      <ConnectionChainPicker
        connectionId={connectionId}
        fallbackIds={numbersOf(config, "fallback_connection_ids")}
        onChange={(next) =>
          onChange({
            ...config,
            connection_id: next.connection_id,
            fallback_connection_ids: next.fallback_connection_ids,
          })
        }
      />

      {nodeId && <NodeStats automationId={automation.id} nodeId={nodeId} />}

      <PreviewAndTestRow automationId={automation.id} config={config} />
    </div>
  );
}

interface EmailNodeStats {
  node_id: string;
  sent: number;
  opens: number;
  unique_opens: number;
  clicks: number;
  unique_clicks: number;
  links: { url: string; clicks: number; unique_clicks: number }[];
}

const nf = new Intl.NumberFormat();

function pct(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0.00%";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

/** Engagement for this one step. Rates use the same denominators the campaign
 * report does -- unique recipients over emails sent -- so a drip step and a
 * campaign are read the same way. */
function NodeStats({ automationId, nodeId }: { automationId: number; nodeId: string }) {
  const [stats, setStats] = useState<EmailNodeStats | null>(null);

  useEffect(() => {
    let live = true;
    api
      .get<{ nodes?: EmailNodeStats[] }>(`/automations/${automationId}/analytics`)
      .then((data) => {
        if (live) setStats(data.nodes?.find((n) => n.node_id === nodeId) ?? null);
      })
      .catch(() => {
        if (live) setStats(null);
      });
    return () => {
      live = false;
    };
  }, [automationId, nodeId]);

  // Nothing sent from this step yet -- an empty stats card would just be five
  // zeros, so the block stays out of the panel entirely.
  if (!stats || stats.sent === 0) return null;

  const rows: [string, string][] = [
    ["Sent", nf.format(stats.sent)],
    [`Opened (${nf.format(stats.unique_opens)})`, pct(stats.unique_opens, stats.sent)],
    [`Clicked (${nf.format(stats.unique_clicks)})`, pct(stats.unique_clicks, stats.sent)],
  ];

  return (
    <div className="space-y-2">
      <FormLabel>This step&apos;s performance</FormLabel>
      <div className="border-border rounded-md border px-3 py-1">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="border-border flex items-center justify-between border-b py-2 text-sm last:border-b-0"
          >
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium tabular-nums">{value}</span>
          </div>
        ))}
      </div>
      {stats.links.length > 0 && (
        <ul className="space-y-1 text-xs">
          {stats.links.map((link) => (
            <li key={link.url} className="flex items-center gap-2">
              <span className="text-muted-foreground min-w-0 flex-1 truncate" title={link.url}>
                {link.url}
              </span>
              <span className="shrink-0 tabular-nums">{nf.format(link.unique_clicks)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Previews and test-sends this step's current, unsaved config -- the
 * automation analogue of the campaign page's "Preview" and "Send test", down to
 * sharing the same modal and the same saved address history. */
function PreviewAndTestRow({ automationId, config }: { automationId: number; config: NodeConfig }) {
  const { emails, addEmail, removeEmail } = useEmailHistory();
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [email, setEmail] = useState(() => emails[0] ?? "");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error: string | null } | null>(null);

  async function send() {
    if (!email) return;
    addEmail(email);
    setSending(true);
    setResult(null);
    try {
      setResult(
        await api.post<{ ok: boolean; error: string | null }>(`/automations/${automationId}/test`, {
          ...config,
          email,
        }),
      );
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : "test send failed" });
    } finally {
      setSending(false);
    }
  }

  async function showPreview() {
    setPreviewing(true);
    setPreviewError(null);
    try {
      setPreview(
        await api.post<{ subject: string; html: string }>(
          `/automations/${automationId}/preview`,
          config,
        ),
      );
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "preview failed");
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className="space-y-2">
      <div>
        <Button type="button" variant="outline" disabled={previewing} onClick={showPreview}>
          {previewing ? "Loading preview…" : "Preview"}
        </Button>
        {previewError && <p className="text-destructive mt-1 text-sm">{previewError}</p>}
      </div>

      <FormLabel>Send test email</FormLabel>
      <div className="flex items-center gap-2">
        <EmailHistoryInput
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={setEmail}
          emails={emails}
          onRemoveEmail={removeEmail}
          className="min-w-0 flex-1"
        />
        <Button type="button" variant="outline" disabled={sending || !email} onClick={send}>
          {sending ? "Sending…" : "Send test"}
        </Button>
      </div>
      {result && (
        <p className={result.ok ? "text-success text-sm" : "text-destructive text-sm"}>
          {result.ok ? "Test sent" : `Failed: ${result.error}`}
        </p>
      )}
      <p className="text-muted-foreground text-xs">
        Both use this step as configured right now -- neither saves the automation, enrols anyone,
        or advances a contact.
      </p>

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

function requireLists(config: NodeConfig): string | null {
  return listIdsOf(config).length === 0 ? "No list selected" : null;
}

/** Mirrors the send_custom_email zod schema on the API: subject, a body, and
 * an explicit connection (there is no implicit "any enabled connection"
 * fallback -- see services/connections.ts). */
function validateSendCustomEmail(config: NodeConfig): string | null {
  const missing: string[] = [];
  if (!stringOf(config, "subject").trim()) missing.push("subject");
  if (!stringOf(config, "body").trim()) missing.push("body");
  if (typeof config.connection_id !== "number") missing.push("sending connection");
  if (missing.length > 0) return `Missing ${missing.join(", ")}`;
  // Caught here rather than only at publish time, where the zod error names
  // the field but not the block it belongs to.
  const replyTo = stringOf(config, "reply_to").trim();
  if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) return "Reply-to is not an email";
  return null;
}

function listSummary(prefix: string) {
  return (config: NodeConfig, ctx: SummaryContext) => {
    const ids = listIdsOf(config);
    return ids.length === 0 ? "No list selected" : `${prefix} ${listNames(ids, ctx.lists)}`;
  };
}

export const ACTIONS: NodeUi[] = [
  {
    type: "wait",
    label: "Wait X days/hours",
    description: "Pause the contact here for a set amount of time.",
    icon: Clock,
    group: "Timing",
    defaultConfig: { unit: "days", amount: 1 },
    summary: (config) => `Wait ${numberOf(config, "amount", 1)} ${unitOf(config)}`,
    validate: (config) =>
      numberOf(config, "amount", 0) >= 1 ? null : "Wait time must be at least 1",
    Settings: WaitSettings,
  },
  {
    type: "send_custom_email",
    label: "Send custom email",
    description: "Write a one-off email and send it to the contact.",
    icon: MailPlus,
    group: "Email",
    defaultConfig: {
      subject: "",
      body: "",
      content_type: "richtext",
      template_id: null,
      from_name: null,
      reply_to: null,
      track_opens: true,
      track_clicks: true,
      fallback_connection_ids: [],
    },
    summary: (config) => stringOf(config, "subject") || "No subject yet",
    validate: validateSendCustomEmail,
    Settings: SendCustomEmailSettings,
  },
  {
    type: "apply_list",
    label: "Apply list",
    description: "Add the contact to one or more lists.",
    icon: ListPlus,
    group: "Contact",
    defaultConfig: { list_ids: [] },
    summary: listSummary("Add to"),
    validate: requireLists,
    Settings: ApplyListSettings,
  },
  {
    type: "remove_list",
    label: "Remove list",
    description: "Remove the contact from one or more lists.",
    icon: ListMinus,
    group: "Contact",
    defaultConfig: { list_ids: [] },
    summary: listSummary("Remove from"),
    validate: requireLists,
    Settings: RemoveListSettings,
  },
];

export function getActionUi(type: string): NodeUi | undefined {
  return ACTIONS.find((a) => a.type === type);
}

/** Actions grouped for the sidebar picker, in registry order. */
export function actionGroups(): { group: string; actions: NodeUi[] }[] {
  const groups: { group: string; actions: NodeUi[] }[] = [];
  for (const action of ACTIONS) {
    const existing = groups.find((g) => g.group === action.group);
    if (existing) existing.actions.push(action);
    else groups.push({ group: action.group, actions: [action] });
  }
  return groups;
}
