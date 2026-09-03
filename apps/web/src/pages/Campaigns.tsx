import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Copy, Pause, Play, Trash2 } from "lucide-react";
import { api } from "../lib/api.js";
import type { Campaign } from "../lib/types.js";
import Badge from "../components/Badge.js";
import {
  PageHeaderWrapper,
  Button,
  DataTable,
  TableEmptyState,
  toast,
} from "../components/ui/index.js";
import type { DataTableAction, DataTableColumn } from "../components/ui/index.js";

// Matches the API's delete guard (routes/campaigns.ts) -- deleting any other
// status is a silent no-op there, so the button isn't offered for those.
// "finished" is included deliberately -- it's a hard delete that cascades
// away that campaign's open/click/bounce history, so the confirm copy below
// warns about that specifically; "running"/"paused" stay excluded since a
// send could still be in flight.
const DELETABLE: Campaign["status"][] = ["draft", "scheduled", "finished"];

// Matches CampaignDetail's own start/pause buttons -- "start" doubles as
// resume for a paused campaign.
const STARTABLE: Campaign["status"][] = ["draft", "scheduled", "paused"];

export default function Campaigns() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [duplicatingId, setDuplicatingId] = useState<number | null>(null);
  const [actingId, setActingId] = useState<number | null>(null);

  function load() {
    api.get<Campaign[]>("/campaigns").then(setCampaigns);
  }
  useEffect(load, []);

  async function duplicate(id: number) {
    setDuplicatingId(id);
    try {
      const copy = await api.post<Campaign>(`/campaigns/${id}/duplicate`);
      toast.success("Campaign duplicated");
      navigate(`/campaigns/${copy.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "failed to duplicate campaign");
    } finally {
      setDuplicatingId(null);
    }
  }

  async function start(c: Campaign) {
    setActingId(c.id);
    try {
      await api.post(`/campaigns/${c.id}/start`);
      toast.success(c.status === "paused" ? "Campaign resumed" : "Campaign started");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "failed to start campaign");
    } finally {
      setActingId(null);
    }
  }

  async function pause(id: number) {
    setActingId(id);
    try {
      await api.post(`/campaigns/${id}/pause`);
      toast.success("Campaign paused");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "failed to pause campaign");
    } finally {
      setActingId(null);
    }
  }

  async function remove(id: number) {
    try {
      await api.delete(`/campaigns/${id}`);
      toast.success("Campaign deleted");
      setCampaigns((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "failed to delete campaign");
    }
  }

  const columns: DataTableColumn<Campaign>[] = [
    {
      key: "name",
      header: "Name",
      mobile: "title",
      cell: (c) => (
        <Link to={`/campaigns/${c.id}`} className="text-primary hover:underline">
          {c.name}
        </Link>
      ),
    },
    {
      key: "status",
      header: "Status",
      mobile: "status",
      cell: (c) => <Badge status={c.status} />,
    },
    {
      key: "sent",
      header: "Sent",
      cell: (c) => `${c.sent} / ${c.to_send}`,
    },
    {
      key: "created",
      header: "Created",
      className: "text-muted-foreground",
      cell: (c) => new Date(c.created_at).toLocaleDateString(),
    },
  ];

  function rowActions(c: Campaign): DataTableAction[] {
    const actions: DataTableAction[] = [];
    if (STARTABLE.includes(c.status)) {
      actions.push({
        label: c.status === "paused" ? "Resume" : "Start sending",
        icon: <Play className="h-4 w-4" />,
        appearance: "icon",
        disabled: actingId === c.id,
        onClick: () => start(c),
      });
    }
    if (c.status === "running") {
      actions.push({
        label: "Pause",
        icon: <Pause className="h-4 w-4" />,
        appearance: "icon",
        disabled: actingId === c.id,
        onClick: () => pause(c.id),
      });
    }
    actions.push({
      label: duplicatingId === c.id ? "Duplicating…" : "Duplicate",
      icon: <Copy className="h-4 w-4" />,
      appearance: "icon",
      disabled: duplicatingId === c.id,
      onClick: () => duplicate(c.id),
    });
    if (DELETABLE.includes(c.status)) {
      actions.push({
        label: "Delete",
        icon: <Trash2 className="h-4 w-4" />,
        appearance: "icon",
        variant: "destructive",
        confirm: {
          description:
            c.status === "finished"
              ? `Delete "${c.name}"? This permanently deletes its send, open, and click history and can't be undone.`
              : `Delete "${c.name}"? This can't be undone.`,
          confirmText: "Delete",
        },
        onClick: () => remove(c.id),
      });
    }
    return actions;
  }

  return (
    <div>
      <PageHeaderWrapper
        variant="title-with-actions"
        title="Campaigns"
        actions={
          <Button asChild variant="default">
            <Link to="/campaigns/new">New campaign</Link>
          </Button>
        }
      />

      <DataTable
        columns={columns}
        rows={campaigns}
        rowKey={(c) => c.id}
        rowActions={rowActions}
        empty={
          <TableEmptyState
            title="No campaigns yet"
            description="Create your first campaign to get started."
          />
        }
      />
    </div>
  );
}
