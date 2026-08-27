import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Copy, Pause, Play, Trash2 } from "lucide-react";
import { api } from "../lib/api.js";
import type { Campaign } from "../lib/types.js";
import Badge from "../components/Badge.js";
import {
  PageHeaderWrapper,
  BlockLayout,
  Button,
  Popconfirm,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyState,
  toast,
} from "../components/ui/index.js";

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

      <BlockLayout padding="sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link to={`/campaigns/${c.id}`} className="text-primary hover:underline">
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge status={c.status} />
                </TableCell>
                <TableCell>
                  {c.sent} / {c.to_send}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(c.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {STARTABLE.includes(c.status) && (
                      <Button
                        variant="ghost"
                        size="sm-icon"
                        tooltip={c.status === "paused" ? "Resume" : "Start sending"}
                        disabled={actingId === c.id}
                        onClick={() => start(c)}
                      >
                        <Play className="h-4 w-4" />
                      </Button>
                    )}
                    {c.status === "running" && (
                      <Button
                        variant="ghost"
                        size="sm-icon"
                        tooltip="Pause"
                        disabled={actingId === c.id}
                        onClick={() => pause(c.id)}
                      >
                        <Pause className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm-icon"
                      tooltip={duplicatingId === c.id ? "Duplicating…" : "Duplicate"}
                      disabled={duplicatingId === c.id}
                      onClick={() => duplicate(c.id)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    {DELETABLE.includes(c.status) && (
                      <Popconfirm
                        description={
                          c.status === "finished"
                            ? `Delete "${c.name}"? This permanently deletes its send, open, and click history and can't be undone.`
                            : `Delete "${c.name}"? This can't be undone.`
                        }
                        onConfirm={() => remove(c.id)}
                        confirmText="Delete"
                      >
                        <Button variant="ghost" size="sm-icon" tooltip="Delete">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </Popconfirm>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {campaigns.length === 0 && (
          <TableEmptyState
            title="No campaigns yet"
            description="Create your first campaign to get started."
          />
        )}
      </BlockLayout>
    </div>
  );
}
