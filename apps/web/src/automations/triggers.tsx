import { useState } from "react";
import { Copy, ListMinus, ListPlus, UserPlus, Webhook } from "lucide-react";
import { ListPicker } from "./fields.js";
import {
  listIdsOf,
  listNames,
  stringOf,
  type NodeConfig,
  type NodeUi,
  type SettingsProps,
  type SummaryContext,
} from "./registry.js";
import { Alert, AlertDescription, Button, FormLabel, Input } from "../components/ui/index.js";

function ListTriggerSettings({ config, onChange }: SettingsProps) {
  return (
    <ListPicker
      label="Lists"
      value={listIdsOf(config)}
      onChange={(list_ids) => onChange({ ...config, list_ids })}
      emptyHint="Select at least one list — this trigger can't run until you do."
    />
  );
}

function requireLists(config: NodeConfig): string | null {
  return listIdsOf(config).length === 0 ? "No list selected" : null;
}

function listSummary(prefix: string) {
  return (config: NodeConfig, ctx: SummaryContext) => {
    const ids = listIdsOf(config);
    return ids.length === 0 ? "No list selected" : `${prefix} ${listNames(ids, ctx.lists)}`;
  };
}

function WebhookSettings({ config }: SettingsProps) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/api/v1/automations/hooks/${stringOf(config, "key")}`;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <FormLabel>Webhook URL</FormLabel>
        <div className="flex gap-2">
          <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            <Copy className="mr-1 h-4 w-4" />
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
      <Alert>
        <AlertDescription>
          POST JSON to this URL with an <code>email</code> (plus optional <code>name</code> and{" "}
          <code>attribs</code>), or an existing <code>subscriber_id</code>. A contact that does not
          exist yet is created. The key in the URL is the only credential — treat it as a secret.
        </AlertDescription>
      </Alert>
    </div>
  );
}

export const TRIGGERS: NodeUi[] = [
  {
    type: "list_applied",
    label: "List applied",
    description: "Runs when a contact is added to one of the selected lists.",
    icon: ListPlus,
    group: "Contact",
    defaultConfig: { list_ids: [] },
    summary: listSummary("Added to"),
    validate: requireLists,
    Settings: ListTriggerSettings,
  },
  {
    type: "list_removed",
    label: "List removed",
    description: "Runs when a contact is removed from one of the selected lists.",
    icon: ListMinus,
    group: "Contact",
    defaultConfig: { list_ids: [] },
    summary: listSummary("Removed from"),
    validate: requireLists,
    Settings: ListTriggerSettings,
  },
  {
    type: "contact_created",
    label: "Contact created",
    description: "Runs once for every new contact, however they were added.",
    icon: UserPlus,
    group: "Contact",
    defaultConfig: {},
    summary: () => "Any new contact",
  },
  {
    type: "webhook_incoming",
    label: "Incoming webhook",
    description: "Runs when your app, form or CRM posts a contact to this automation's URL.",
    icon: Webhook,
    group: "Integration",
    defaultConfig: {},
    summary: () => "Posted to this automation's webhook URL",
    Settings: WebhookSettings,
  },
];

export function getTriggerUi(type: string): NodeUi | undefined {
  return TRIGGERS.find((t) => t.type === type);
}
