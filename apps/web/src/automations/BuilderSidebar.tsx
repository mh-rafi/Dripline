import { useEffect, useState } from "react";
import { ChevronRight, Trash2, X } from "lucide-react";
import { actionGroups, getActionUi } from "./actions.js";
import { getTriggerUi } from "./triggers.js";
import type { NodeConfig } from "./registry.js";
import type { Automation, AutomationNode } from "../lib/types.js";
import {
  Alert,
  AlertDescription,
  Button,
  FormLabel,
  Input,
  Textarea,
} from "../components/ui/index.js";

/** What the single right-hand editing panel is currently showing. Everything
 * the builder can edit goes through here -- clicking a block, clicking a `+`,
 * or clicking the trigger. */
export type Panel =
  | { kind: "trigger" }
  | { kind: "picker"; afterNodeId: string | null }
  | { kind: "node"; nodeId: string }
  | null;

interface BuilderSidebarProps {
  panel: Panel;
  automation: Automation;
  onClose: () => void;
  onSaveTrigger: (config: NodeConfig) => Promise<void>;
  onPickAction: (type: string, afterNodeId: string | null) => void;
  onSaveNode: (nodeId: string, patch: Partial<AutomationNode>) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
}

function PanelShell({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <aside className="bg-background absolute inset-y-0 right-0 z-20 flex w-[520px] max-w-full flex-col border-l shadow-xl">
      <header className="flex items-start justify-between gap-4 border-b px-6 py-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {subtitle && <p className="text-muted-foreground mt-0.5 text-sm">{subtitle}</p>}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close panel">
          <X className="h-4 w-4" />
        </Button>
      </header>
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">{children}</div>
      {footer && <footer className="flex gap-2 border-t px-6 py-4">{footer}</footer>}
    </aside>
  );
}

function TriggerPanel({
  automation,
  onClose,
  onSave,
}: {
  automation: Automation;
  onClose: () => void;
  onSave: (config: NodeConfig) => Promise<void>;
}) {
  const ui = getTriggerUi(automation.trigger_type);
  const [config, setConfig] = useState<NodeConfig>(automation.trigger_config);
  const [saving, setSaving] = useState(false);

  useEffect(() => setConfig(automation.trigger_config), [automation.trigger_config]);

  const Settings = ui?.Settings;

  return (
    <PanelShell
      title={ui?.label ?? automation.trigger_type}
      subtitle={ui?.description}
      onClose={onClose}
      footer={
        Settings ? (
          <>
            <Button
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                await onSave(config).finally(() => setSaving(false));
              }}
            >
              {saving ? "Saving…" : "Save trigger"}
            </Button>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </>
        ) : undefined
      }
    >
      {Settings ? (
        <Settings config={config} onChange={setConfig} automation={automation} />
      ) : (
        <Alert>
          <AlertDescription>This trigger has no settings — it fires for everyone.</AlertDescription>
        </Alert>
      )}
    </PanelShell>
  );
}

function PickerPanel({
  afterNodeId,
  onClose,
  onPick,
}: {
  afterNodeId: string | null;
  onClose: () => void;
  onPick: (type: string, afterNodeId: string | null) => void;
}) {
  return (
    <PanelShell
      title="Add a step"
      subtitle="Pick what should happen at this point in the flow."
      onClose={onClose}
    >
      {actionGroups().map(({ group, actions }) => (
        <div key={group} className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {group}
          </p>
          <div className="space-y-2">
            {actions.map((action) => (
              <button
                key={action.type}
                type="button"
                onClick={() => onPick(action.type, afterNodeId)}
                className="hover:border-primary hover:bg-accent/40 flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition"
              >
                <action.icon className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{action.label}</span>
                  <span className="text-muted-foreground block text-sm">{action.description}</span>
                </span>
                <ChevronRight className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </PanelShell>
  );
}

function NodePanel({
  node,
  automation,
  onClose,
  onSave,
  onDelete,
}: {
  node: AutomationNode;
  automation: Automation;
  onClose: () => void;
  onSave: (nodeId: string, patch: Partial<AutomationNode>) => Promise<void>;
  onDelete: (nodeId: string) => Promise<void>;
}) {
  const ui = getActionUi(node.type);
  const [config, setConfig] = useState<NodeConfig>(node.config);
  const [title, setTitle] = useState(node.title ?? "");
  const [note, setNote] = useState(node.note ?? "");
  const [saving, setSaving] = useState(false);

  // Re-seed the draft when the panel switches to a different block.
  useEffect(() => {
    setConfig(node.config);
    setTitle(node.title ?? "");
    setNote(node.note ?? "");
  }, [node.id, node.config, node.title, node.note]);

  const Settings = ui?.Settings;

  return (
    <PanelShell
      title={ui?.label ?? node.type}
      subtitle={ui?.description}
      onClose={onClose}
      footer={
        <>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onSave(node.id, { config, title, note }).finally(() => setSaving(false));
            }}
          >
            {saving ? "Saving…" : "Save step"}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className="text-destructive ml-auto"
            onClick={() => onDelete(node.id)}
          >
            <Trash2 className="mr-1 h-4 w-4" /> Delete
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <FormLabel>Internal note title</FormLabel>
        <Input
          value={title}
          placeholder={ui?.label ?? node.type}
          onChange={(e) => setTitle(e.target.value)}
        />
        <p className="text-muted-foreground text-xs">
          Shown on the block instead of the default name. Only your team sees it.
        </p>
      </div>

      <div className="space-y-2">
        <FormLabel>Description</FormLabel>
        <Textarea
          rows={2}
          value={note}
          placeholder="Why this step exists…"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="border-t pt-5">
        {Settings ? (
          <Settings config={config} onChange={setConfig} automation={automation} />
        ) : (
          <Alert>
            <AlertDescription>
              This step type is not available in this version of Dripline.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </PanelShell>
  );
}

export default function BuilderSidebar({
  panel,
  automation,
  onClose,
  onSaveTrigger,
  onPickAction,
  onSaveNode,
  onDeleteNode,
}: BuilderSidebarProps) {
  if (!panel) return null;

  if (panel.kind === "trigger") {
    return <TriggerPanel automation={automation} onClose={onClose} onSave={onSaveTrigger} />;
  }

  if (panel.kind === "picker") {
    return <PickerPanel afterNodeId={panel.afterNodeId} onClose={onClose} onPick={onPickAction} />;
  }

  const node = automation.graph.nodes.find((n) => n.id === panel.nodeId);
  if (!node) return null;

  return (
    <NodePanel
      key={node.id}
      node={node}
      automation={automation}
      onClose={onClose}
      onSave={onSaveNode}
      onDelete={onDeleteNode}
    />
  );
}
