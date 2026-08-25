import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Connection } from "../lib/types.js";
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
  Popconfirm,
  toast,
} from "../components/ui/index.js";

function configSummary(c: Connection): string {
  const cfg = c.config as Record<string, unknown>;
  if (c.type === "ses") return `SES · ${cfg.region ?? "?"}`;
  return `SMTP · ${cfg.host ?? "?"}:${cfg.port ?? "?"}`;
}

function rateLimitSummary(c: Connection): string {
  if (!c.rate_limit_count || !c.rate_limit_duration_seconds) return "unlimited";
  const mins = Math.round(c.rate_limit_duration_seconds / 60);
  return `${c.rate_limit_count} / ${mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}m`}`;
}

export default function Connections() {
  const [connections, setConnections] = useState<Connection[]>([]);

  function load() {
    api.get<Connection[]>("/connections").then(setConnections);
  }
  useEffect(load, []);

  async function toggleEnable(c: Connection) {
    if (c.enabled) {
      await api.patch(`/connections/${c.id}`, { enabled: false });
    } else {
      await api.post(`/connections/${c.id}/enable`);
    }
    load();
  }

  async function remove(id: number) {
    await api.delete(`/connections/${id}`);
    load();
    toast.success("Connection deleted");
  }

  return (
    <div>
      <PageHeaderWrapper
        variant="title-with-actions"
        title="Sending connections"
        actions={
          <Button asChild>
            <Link to="/connections/new">Add connection</Link>
          </Button>
        }
      />

      <p className="text-muted-foreground mb-6 text-sm">
        Each connection is a distinct sending identity (SMTP or AWS SES). Campaigns and automation
        steps pick a primary connection and optional ordered fallbacks — there is no automatic pool,
        so each site's mail stays on its own domain.
      </p>

      <BlockLayout padding="sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Rate limit</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {connections.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link to={`/connections/${c.id}`} className="text-primary hover:underline">
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{configSummary(c)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {c.from_name ? `${c.from_name} <${c.from_email}>` : c.from_email}
                </TableCell>
                <TableCell className="text-muted-foreground">{rateLimitSummary(c)}</TableCell>
                <TableCell>
                  {c.enabled ? (
                    <span className="bg-success/15 text-success inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
                      enabled
                    </span>
                  ) : (
                    <span
                      className="bg-destructive/15 text-destructive inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                      title={c.disabled_reason ?? ""}
                    >
                      disabled
                    </span>
                  )}
                  {c.bounce_config?.enabled && (
                    <span
                      className={
                        c.bounce_disabled_reason
                          ? "bg-destructive/15 text-destructive ml-1 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                          : "bg-success/15 text-success ml-1 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                      }
                      title={c.bounce_disabled_reason ?? "Bounce mailbox scanning is active"}
                    >
                      {c.bounce_disabled_reason ? "bounce scan error" : "bounce scan on"}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/connections/${c.id}`}>Edit</Link>
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => toggleEnable(c)}>
                      {c.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Popconfirm
                      description="Delete this connection?"
                      onConfirm={() => remove(c.id)}
                      confirmText="Delete"
                    >
                      <Button variant="outline" size="sm">
                        Delete
                      </Button>
                    </Popconfirm>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {connections.length === 0 && (
          <TableEmptyState
            title="No connections configured"
            description="Campaigns can't send until at least one is added."
          />
        )}
      </BlockLayout>
    </div>
  );
}
