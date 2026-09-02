import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, BarChart3, Settings2 } from "lucide-react";
import { api, ApiError } from "../lib/api.js";
import type { Automation, AutomationGraph, AutomationNode } from "../lib/types.js";
import Badge from "../components/Badge.js";
import Canvas from "../automations/Canvas.js";
import BuilderSidebar, { type Panel } from "../automations/BuilderSidebar.js";
import { AutomationDataProvider } from "../automations/context.js";
import { getActionUi } from "../automations/actions.js";
import { deleteNode, insertNode, newNodeId, updateNode } from "../automations/graph.js";
import type { NodeConfig } from "../automations/registry.js";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  FormLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  toast,
} from "../components/ui/index.js";

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError || err instanceof Error) return err.message;
  return fallback;
}

function SettingsDialog({
  automation,
  open,
  onOpenChange,
  onSave,
}: {
  automation: Automation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (patch: Partial<Automation>) => Promise<void>;
}) {
  const [name, setName] = useState(automation.name);
  const [reentry, setReentry] = useState(automation.reentry_mode);

  useEffect(() => {
    setName(automation.name);
    setReentry(automation.reentry_mode);
  }, [automation.name, automation.reentry_mode, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Automation settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <FormLabel required>Name</FormLabel>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <FormLabel>Re-entry</FormLabel>
            <Select
              value={reentry}
              onValueChange={(v) => setReentry(v as Automation["reentry_mode"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="once">Each contact can enter only once</SelectItem>
                <SelectItem value="multiple">A contact can enter again later</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={async () => {
              await onSave({ name, reentry_mode: reentry });
              onOpenChange(false);
            }}
          >
            Save settings
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AutomationBuilder() {
  const { id } = useParams();
  const [automation, setAutomation] = useState<Automation | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    api
      .get<Automation>(`/automations/${id}`)
      .then(setAutomation)
      .catch((err) => toast.error(errorMessage(err, "failed to load automation")));
  }, [id]);

  const patch = useCallback(
    async (body: Partial<Automation>) => {
      const updated = await api.patch<Automation>(`/automations/${id}`, body);
      // The response is the source of truth (the server may normalise the
      // graph), so the canvas always renders what was actually stored.
      setAutomation((current) => (current ? { ...current, ...updated } : updated));
      return updated;
    },
    [id],
  );

  const saveGraph = useCallback(
    async (graph: AutomationGraph) => {
      try {
        await patch({ graph });
      } catch (err) {
        toast.error(errorMessage(err, "failed to save"));
      }
    },
    [patch],
  );

  const openTrigger = useCallback(() => setPanel({ kind: "trigger" }), []);
  const openNode = useCallback((nodeId: string) => setPanel({ kind: "node", nodeId }), []);
  const addAfter = useCallback(
    (afterNodeId: string | null) => setPanel({ kind: "picker", afterNodeId }),
    [],
  );

  if (!automation) {
    return (
      <div className="p-8">
        <Skeleton className="h-64" />
      </div>
    );
  }

  async function pickAction(type: string, afterNodeId: string | null) {
    if (!automation) return;
    const ui = getActionUi(type);
    const node: AutomationNode = {
      id: newNodeId(),
      type,
      title: "",
      note: "",
      config: { ...(ui?.defaultConfig ?? {}) },
      next: null,
    };
    await saveGraph(insertNode(automation.graph, afterNodeId, node));
    // Land straight in that step's settings -- picking an action and
    // configuring it are one continuous move in the same panel.
    setPanel({ kind: "node", nodeId: node.id });
  }

  async function saveNode(nodeId: string, nodePatch: Partial<AutomationNode>) {
    if (!automation) return;
    await saveGraph(updateNode(automation.graph, nodeId, nodePatch));
    toast.success("Step saved");
  }

  async function removeNode(nodeId: string) {
    if (!automation) return;
    await saveGraph(deleteNode(automation.graph, nodeId));
    setPanel(null);
  }

  async function saveTrigger(config: NodeConfig) {
    try {
      await patch({ trigger_config: config });
      toast.success("Trigger saved");
    } catch (err) {
      toast.error(errorMessage(err, "failed to save trigger"));
    }
  }

  async function togglePublished(next: boolean) {
    try {
      await patch({ status: next ? "published" : "paused" });
      toast.success(next ? "Automation published" : "Automation paused");
    } catch (err) {
      toast.error(errorMessage(err, "failed to change status"));
    }
  }

  return (
    <AutomationDataProvider>
      <div className="bg-background flex h-screen flex-col">
        <header className="flex items-center gap-4 border-b px-6 py-3">
          <Link
            to="/automations"
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="h-4 w-4" /> Automations
          </Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="truncate text-sm font-semibold">{automation.name}</h1>
          <Badge status={automation.status} />

          <div className="ml-auto flex items-center gap-3">
            <Button variant="outline" size="sm" asChild>
              <Link to={`/automations/${id}/reports`}>
                <BarChart3 className="mr-1 h-4 w-4" /> Reports
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="mr-1 h-4 w-4" /> Settings
            </Button>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                {automation.status === "published" ? "Published" : "Not live"}
              </span>
              <Switch
                checked={automation.status === "published"}
                onCheckedChange={togglePublished}
              />
            </label>
          </div>
        </header>

        <div className="relative flex-1">
          <Canvas
            automation={automation}
            selectedNodeId={panel?.kind === "node" ? panel.nodeId : null}
            triggerSelected={panel?.kind === "trigger"}
            onOpenTrigger={openTrigger}
            onOpenNode={openNode}
            onAddAfter={addAfter}
          />
          <BuilderSidebar
            panel={panel}
            automation={automation}
            onClose={() => setPanel(null)}
            onSaveTrigger={saveTrigger}
            onPickAction={pickAction}
            onSaveNode={saveNode}
            onDeleteNode={removeNode}
          />
        </div>

        <SettingsDialog
          automation={automation}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onSave={async (body) => {
            try {
              await patch(body);
              toast.success("Settings saved");
            } catch (err) {
              toast.error(errorMessage(err, "failed to save settings"));
            }
          }}
        />
      </div>
    </AutomationDataProvider>
  );
}
