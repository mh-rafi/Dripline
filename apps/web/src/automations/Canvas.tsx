import { useCallback, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plus, TriangleAlert, Zap, type LucideIcon } from "lucide-react";
import { cn } from "../lib/utils.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/index.js";
import { useTheme } from "../lib/theme.js";
import { useAutomationData } from "./context.js";
import { getActionUi } from "./actions.js";
import { getTriggerUi } from "./triggers.js";
import { orderedNodes } from "./graph.js";
import type { Automation } from "../lib/types.js";

const NODE_WIDTH = 440;
const NODE_SPACING = 180;

interface BlockData extends Record<string, unknown> {
  title: string;
  summary: string;
  tone: "trigger" | "email" | "plain";
  icon: LucideIcon;
  selected: boolean;
  /** What's missing before this block can run, or null when it's ready. */
  warning: string | null;
}

function BlockNode({ data }: NodeProps<Node<BlockData>>) {
  const Icon = data.icon;
  return (
    <div className="relative" style={{ width: NODE_WIDTH }}>
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <button
        type="button"
        className={cn(
          "w-full rounded-lg border px-6 py-5 text-center shadow-sm transition",
          "hover:border-primary/60 hover:shadow-md",
          data.tone === "trigger" &&
            "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10",
          data.tone === "email" &&
            "border-teal-300 bg-teal-50 dark:border-teal-500/40 dark:bg-teal-500/10",
          data.tone === "plain" && "bg-card border-border",
          data.selected && "ring-primary ring-2",
        )}
      >
        <div className="text-foreground text-lg font-semibold">{data.title}</div>
        <div className="text-muted-foreground mt-1 text-sm">{data.summary}</div>
      </button>
      <span className="bg-background text-muted-foreground absolute -top-3 left-1/2 -translate-x-1/2 rounded border p-1">
        <Icon className="h-3.5 w-3.5" />
      </span>
      {data.warning && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="border-warning/40 bg-background text-warning absolute -top-2.5 -right-2.5 flex h-6 w-6 items-center justify-center rounded-full border shadow-sm"
                aria-label={`Not fully set up: ${data.warning}`}
              >
                <TriangleAlert className="h-3.5 w-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent>{data.warning}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
}

function EndNode() {
  return (
    <div className="text-muted-foreground bg-muted/60 rounded-full border px-4 py-1.5 text-xs">
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      End of automation
    </div>
  );
}

interface PlusEdgeData extends Record<string, unknown> {
  onAdd: () => void;
}

/** The `+` between two blocks: adding a step is always "on this edge", which
 * is also where a future condition node's yes/no split will be inserted. */
function PlusEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<Edge<PlusEdgeData>>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
  });

  return (
    <>
      <BaseEdge id={id} path={path} style={{ strokeDasharray: "4 4" }} />
      <EdgeLabelRenderer>
        <button
          type="button"
          onClick={() => data?.onAdd()}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          className="border-border bg-background text-muted-foreground hover:border-primary hover:text-primary pointer-events-auto absolute flex h-7 w-7 items-center justify-center rounded-full border shadow-sm transition"
          aria-label="Add a step here"
        >
          <Plus className="h-4 w-4" />
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { block: BlockNode, end: EndNode };
const edgeTypes = { plus: PlusEdge };

interface CanvasProps {
  automation: Automation;
  selectedNodeId: string | null;
  triggerSelected: boolean;
  onOpenTrigger: () => void;
  onOpenNode: (nodeId: string) => void;
  /** `afterNodeId` null means "insert directly below the trigger". */
  onAddAfter: (afterNodeId: string | null) => void;
}

export default function Canvas({
  automation,
  selectedNodeId,
  triggerSelected,
  onOpenTrigger,
  onOpenNode,
  onAddAfter,
}: CanvasProps) {
  const { theme } = useTheme();
  const { lists } = useAutomationData();

  const { nodes, edges } = useMemo(() => {
    const trigger = getTriggerUi(automation.trigger_type);
    const steps = orderedNodes(automation.graph);

    const flowNodes: Node[] = [
      {
        id: "trigger",
        type: "block",
        position: { x: 0, y: 0 },
        draggable: false,
        data: {
          title: trigger?.label ?? automation.trigger_type,
          summary: trigger
            ? trigger.summary(automation.trigger_config, { lists })
            : "Unknown trigger",
          tone: "trigger",
          icon: trigger?.icon ?? Zap,
          selected: triggerSelected,
          warning: trigger?.validate?.(automation.trigger_config) ?? null,
        } satisfies BlockData,
      },
    ];
    const flowEdges: Edge[] = [];

    steps.forEach((step, index) => {
      const ui = getActionUi(step.type);
      flowNodes.push({
        id: step.id,
        type: "block",
        position: { x: 0, y: (index + 1) * NODE_SPACING },
        draggable: false,
        data: {
          title: step.title?.trim() || ui?.label || step.type,
          summary: ui ? ui.summary(step.config, { lists }) : "Unknown action",
          tone: ui?.group === "Email" ? "email" : "plain",
          icon: ui?.icon ?? Zap,
          selected: selectedNodeId === step.id,
          warning: ui ? (ui.validate?.(step.config) ?? null) : "Unknown step type",
        } satisfies BlockData,
      });
    });

    flowNodes.push({
      id: "end",
      type: "end",
      position: { x: NODE_WIDTH / 2 - 70, y: (steps.length + 1) * NODE_SPACING },
      draggable: false,
      data: {},
    });

    const chain = ["trigger", ...steps.map((s) => s.id), "end"];
    for (let i = 0; i < chain.length - 1; i++) {
      const source = chain[i] as string;
      const target = chain[i + 1] as string;
      flowEdges.push({
        id: `${source}->${target}`,
        source,
        target,
        type: "plus",
        data: { onAdd: () => onAddAfter(i === 0 ? null : source) } satisfies PlusEdgeData,
      });
    }

    return { nodes: flowNodes, edges: flowEdges };
  }, [automation, lists, selectedNodeId, triggerSelected, onAddAfter]);

  /** Opening a block goes through React Flow's own node click rather than an
   * onClick inside the node: with selection and dragging both off, React Flow
   * sets `pointer-events: none` on every node wrapper unless one of those --
   * or this handler -- is present, which would leave the blocks unclickable. */
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.id === "trigger") return onOpenTrigger();
      if (node.id === "end") return;
      onOpenNode(node.id);
    },
    [onOpenTrigger, onOpenNode],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      colorMode={theme}
      fitView
      fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
      minZoom={0.3}
      maxZoom={1.5}
      onNodeClick={handleNodeClick}
      nodesConnectable={false}
      nodesDraggable={false}
      elementsSelectable={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
    </ReactFlow>
  );
}
