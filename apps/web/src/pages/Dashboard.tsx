import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Campaign, List, Subscriber } from "../lib/types.js";
import Badge from "../components/Badge.js";
import {
  PageHeaderWrapper,
  BlockLayout,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyState,
  Typography,
} from "../components/ui/index.js";

export default function Dashboard() {
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [lists, setLists] = useState<List[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    api
      .get<{ subscribers: Subscriber[]; total: number }>("/subscribers?limit=1")
      .then((res) => setSubscriberCount(res.total));
    api.get<List[]>("/lists").then(setLists);
    api.get<Campaign[]>("/campaigns").then(setCampaigns);
  }, []);

  const running = campaigns.filter((c) => c.status === "running");

  const stats = [
    { label: "Subscribers", value: subscriberCount },
    { label: "Lists", value: lists.length },
    { label: "Campaigns", value: campaigns.length },
    { label: "Running now", value: running.length },
  ];

  return (
    <div>
      <PageHeaderWrapper variant="title-only" title="Dashboard" />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <BlockLayout key={s.label} padding="sm">
            <Typography variant="muted">{s.label}</Typography>
            <div className="text-2xl font-medium">{s.value}</div>
          </BlockLayout>
        ))}
      </div>

      <BlockLayout>
        <Typography variant="h3" className="mb-4">
          Recent campaigns
        </Typography>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sent</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.slice(0, 8).map((c) => (
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
