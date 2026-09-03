import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Connection } from "../lib/types.js";
import {
  PageHeaderWrapper,
  Button,
  DataTable,
  TableEmptyState,
  toast,
} from "../components/ui/index.js";
import type { DataTableAction, DataTableColumn } from "../components/ui/index.js";

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
  const navigate = useNavigate();
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

  const columns: DataTableColumn<Connection>[] = [
    {
      key: "name",
      header: "Name",
      mobile: "title",
      cell: (c) => (
        <Link to={`/connections/${c.id}`} className="text-primary hover:underline">
          {c.name}
        </Link>
      ),
    },
    {
      key: "type",
      header: "Type",
      mobile: "subtitle",
      className: "text-muted-foreground",
      cell: (c) => configSummary(c),
    },
    {
      key: "from",
      header: "From",
      className: "text-muted-foreground",
      cell: (c) => (c.from_name ? `${c.from_name} <${c.from_email}>` : c.from_email),
    },
    {
      key: "rate_limit",
      header: "Rate limit",
      mobileLabel: "Rate",
      className: "text-muted-foreground",
      cell: (c) => rateLimitSummary(c),
    },
    {
      key: "status",
      header: "Status",
      mobile: "status",
      cell: (c) => (
        <>
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
        </>
      ),
    },
  ];

  function rowActions(c: Connection): DataTableAction[] {
    return [
      { label: "Edit", appearance: "outline", onClick: () => navigate(`/connections/${c.id}`) },
      {
        label: c.enabled ? "Disable" : "Enable",
        appearance: "outline",
        onClick: () => toggleEnable(c),
      },
      {
        label: "Delete",
        appearance: "outline",
        variant: "destructive",
        confirm: { description: "Delete this connection?", confirmText: "Delete" },
        onClick: () => remove(c.id),
      },
    ];
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

      <DataTable
        columns={columns}
        rows={connections}
        rowKey={(c) => c.id}
        rowActions={rowActions}
        empty={
          <TableEmptyState
            title="No connections configured"
            description="Campaigns can't send until at least one is added."
          />
        }
      />
    </div>
  );
}
