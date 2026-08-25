import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Campaign } from "../lib/types.js";
import Badge from "../components/Badge.js";
import {
  PageHeaderWrapper,
  BlockLayout,
  Button,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyState,
  toast,
} from "../components/ui/index.js";

export default function Campaigns() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [duplicatingId, setDuplicatingId] = useState<number | null>(null);

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
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={duplicatingId === c.id}
                    onClick={() => duplicate(c.id)}
                  >
                    {duplicatingId === c.id ? "Duplicating…" : "Duplicate"}
                  </Button>
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
