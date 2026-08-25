import { Clock, ListMinus, ListPlus, MailPlus } from "lucide-react";
import ContentTypeEditor, {
  type ContentType,
} from "../components/content-editor/ContentTypeEditor.js";
import { ConnectionChainPicker, ListPicker } from "./fields.js";
import {
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
  FormLabel,
  Input,
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

function SendCustomEmailSettings({ config, onChange }: SettingsProps) {
  const connectionId = typeof config.connection_id === "number" ? config.connection_id : undefined;
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
  if (missing.length === 0) return null;
  return `Missing ${missing.join(", ")}`;
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
    defaultConfig: { subject: "", body: "", content_type: "richtext", fallback_connection_ids: [] },
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
