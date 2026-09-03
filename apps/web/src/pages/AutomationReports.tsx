import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, Search } from "lucide-react";
import { api } from "../lib/api.js";
import type {
  Automation,
  AutomationEnrollment,
  AutomationEnrollmentPage,
  AutomationReport,
  AutomationReportStep,
} from "../lib/types.js";
import Badge from "../components/Badge.js";
import {
  BlockLayout,
  Button,
  Input,
  PageContainer,
  PageHeaderWrapper,
  DataTable,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  TableEmptyState,
  TablePagination,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "../components/ui/index.js";
import type { DataTableAction, DataTableColumn } from "../components/ui/index.js";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

const nf = new Intl.NumberFormat();

function rate(part: number, whole: number): string {
  if (whole <= 0) return "0.00%";
  return `${((part / whole) * 100).toFixed(2)}%`;
}

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

/** A progress ring. Hand-drawn rather than a chart library's radial series:
 * it is one arc with one number in it, and an SVG circle renders that more
 * crisply than a 260-degree pie with a hole. */
function Ring({ pct, tone }: { pct: number; tone: string }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(100, pct));
  return (
    <svg viewBox="0 0 120 120" className="size-28" role="img" aria-label={`${filled}%`}>
      <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--color-muted)" strokeWidth="8" />
      <circle
        cx="60"
        cy="60"
        r={radius}
        fill="none"
        stroke={tone}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${(filled / 100) * circumference} ${circumference}`}
        transform="rotate(-90 60 60)"
      />
      <text
        x="60"
        y="60"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-foreground text-xl font-semibold"
        style={{ fontSize: "22px" }}
      >
        {filled}%
      </text>
    </svg>
  );
}

function FunnelTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: AutomationReportStep }[];
}) {
  const step = active ? payload?.[0]?.payload : undefined;
  if (!step) return null;
  return (
    <div className="bg-popover text-popover-foreground border-border rounded-md border px-3 py-2 text-sm shadow-md">
      <div className="font-medium">{step.label}</div>
      <div className="text-muted-foreground mt-0.5 tabular-nums">
        {nf.format(step.contacts)} contacts · {step.pct}% of entrants
      </div>
    </div>
  );
}

function ChartReport({ report }: { report: AutomationReport }) {
  const data = [
    {
      node_id: "__entrance__",
      type: "entrance",
      label: "Entrance",
      contacts: report.entered,
      pct: report.entered > 0 ? 100 : 0,
      drop_pct: 0,
      email: null,
    } satisfies AutomationReportStep,
    ...report.steps,
  ];

  return (
    <BlockLayout>
      <div className="h-96">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: "var(--color-border)" }}
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
              interval={0}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={44}
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
              allowDecimals={false}
            />
            <RechartsTooltip cursor={{ fill: "var(--color-muted)" }} content={<FunnelTooltip />} />
            <Bar
              dataKey="contacts"
              fill="var(--color-chart-2)"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div
        className="text-muted-foreground grid gap-2 pt-2 text-center text-xs"
        style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}
      >
        {data.map((step) => (
          <div key={step.node_id} className="tabular-nums">
            {step.pct}%
          </div>
        ))}
      </div>
    </BlockLayout>
  );
}

function StepReport({ report }: { report: AutomationReport }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <BlockLayout className="flex flex-col items-center gap-3 text-center">
        <Ring pct={report.entered > 0 ? 100 : 0} tone="var(--color-chart-1)" />
        <div className="font-semibold">Entrance</div>
        <div className="flex flex-wrap justify-center gap-1.5 text-xs">
          <span className="bg-muted rounded px-2 py-1 tabular-nums">
            {nf.format(report.entered)} contacts
          </span>
        </div>
      </BlockLayout>

      {report.steps.map((step) => (
        <BlockLayout key={step.node_id} className="flex flex-col items-center gap-3 text-center">
          <Ring pct={step.pct} tone="var(--color-chart-2)" />
          <div className="font-semibold">{step.label}</div>
          <div className="flex flex-wrap justify-center gap-1.5 text-xs">
            <span className="bg-muted rounded px-2 py-1 tabular-nums">
              {nf.format(step.contacts)} contacts
            </span>
            {step.drop_pct > 0 && (
              <span className="bg-destructive/10 text-destructive rounded px-2 py-1 tabular-nums">
                ↓ {step.drop_pct}%
              </span>
            )}
            {step.email && (
              <>
                <span className="bg-muted rounded px-2 py-1 tabular-nums">
                  {nf.format(step.email.unique_opens)} opened
                </span>
                <span className="bg-muted rounded px-2 py-1 tabular-nums">
                  {nf.format(step.email.unique_clicks)} clicked
                </span>
              </>
            )}
          </div>
        </BlockLayout>
      ))}

      <BlockLayout className="flex flex-col items-center gap-3 text-center">
        <Ring pct={report.conversion_pct} tone="var(--color-success)" />
        <div className="font-semibold">Reached the final step</div>
        <p className="text-muted-foreground text-xs">
          Of everyone who ever entered this automation.
        </p>
      </BlockLayout>
    </div>
  );
}

function EmailsAnalytics({ report }: { report: AutomationReport }) {
  const emails = report.steps.filter((step) => step.email !== null);
  if (emails.length === 0) {
    return (
      <BlockLayout>
        <p className="text-muted-foreground py-8 text-center text-sm">
          No email steps have sent anything yet.
        </p>
      </BlockLayout>
    );
  }

  return (
    <div className="space-y-3">
      {emails.map((step) => {
        const email = step.email!;
        return (
          <BlockLayout key={step.node_id} padding="sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {step.label}
                  {email.subject && (
                    <span className="text-muted-foreground"> ( {email.subject} )</span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-center sm:flex sm:shrink-0 sm:gap-6">
                {[
                  ["Sent", nf.format(email.sent)],
                  ["Opened", rate(email.unique_opens, email.sent)],
                  ["Clicked", rate(email.unique_clicks, email.sent)],
                  ["Unsubscribed", rate(email.unsubscribes, email.sent)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div className="text-lg font-semibold tabular-nums">{value}</div>
                    <div className="text-muted-foreground text-xs">{label}</div>
                  </div>
                ))}
              </div>
            </div>
            {email.links.length > 0 && (
              <ul className="border-border mt-3 space-y-1 border-t pt-3 text-xs">
                {email.links.map((link) => (
                  <li key={link.url} className="flex items-center gap-2">
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      title={link.url}
                      className="text-primary min-w-0 flex-1 truncate hover:underline"
                    >
                      {link.url}
                    </a>
                    <span className="shrink-0 tabular-nums">
                      {nf.format(link.unique_clicks)} unique
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </BlockLayout>
        );
      })}
    </div>
  );
}

const STATUSES = ["all", "active", "completed", "cancelled"] as const;

function IndividualReporting({
  automationId,
  steps,
}: {
  automationId: string;
  steps: AutomationReportStep[];
}) {
  const [rows, setRows] = useState<AutomationEnrollment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  // Node ids are opaque; the graph is what turns one into a readable step
  // name, and it does so for historical rows too.
  const labelOf = (nodeId: string | null) =>
    nodeId ? (steps.find((s) => s.node_id === nodeId)?.label ?? nodeId) : "—";

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
      status,
    });
    if (query) params.set("query", query);
    api
      .get<AutomationEnrollmentPage>(`/automations/${automationId}/enrollments?${params}`)
      .then((data) => {
        setRows(data.enrollments);
        setTotal(data.total);
      })
      .catch((err) => toast.error(errorMessage(err, "failed to load contacts")))
      .finally(() => setLoading(false));
  }, [automationId, page, perPage, status, query]);

  useEffect(load, [load]);

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  async function act(fn: () => Promise<unknown>, message: string) {
    try {
      await fn();
      toast.success(message);
      load();
    } catch (err) {
      toast.error(errorMessage(err, "action failed"));
    }
  }

  const columns: DataTableColumn<AutomationEnrollment>[] = [
    {
      key: "contact",
      header: "Contact",
      mobile: "title",
      cell: (row) => (
        <>
          <Link to={`/subscribers/${row.subscriber_id}`} className="text-primary hover:underline">
            {row.name || row.email}
          </Link>
          {row.name && <div className="text-muted-foreground text-xs">{row.email}</div>}
        </>
      ),
    },
    {
      key: "step",
      header: "Current step",
      mobile: "subtitle",
      cell: (row) => labelOf(row.current_node_id),
    },
    {
      key: "status",
      header: "Status",
      mobile: "status",
      cell: (row) => <Badge status={row.status} />,
    },
    {
      key: "next_run",
      header: "Next run",
      className: "text-muted-foreground",
      cell: (row) => when(row.next_run_at),
    },
    {
      key: "entered",
      header: "Entered",
      className: "text-muted-foreground",
      cell: (row) => when(row.started_at),
    },
  ];

  function rowActions(row: AutomationEnrollment): DataTableAction[] {
    const actions: DataTableAction[] = [];
    if (row.status === "active") {
      actions.push({
        label: "Cancel",
        appearance: "outline",
        onClick: () =>
          act(
            () => api.post(`/automations/${automationId}/enrollments/${row.id}/cancel`),
            "Contact cancelled",
          ),
      });
    }
    actions.push({
      label: "Remove",
      appearance: "destructive",
      variant: "destructive",
      confirm: {
        description:
          "Remove this contact from the automation? Their history here is deleted too, so the funnel stops counting them.",
        confirmText: "Remove",
      },
      onClick: () =>
        act(
          () => api.delete(`/automations/${automationId}/enrollments/${row.id}`),
          "Contact removed",
        ),
    });
    return actions;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h3 className="m-0 text-base font-semibold">Individual reporting</h3>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v as (typeof STATUSES)[number]);
              setPage(1);
            }}
          >
            <SelectTrigger width="auto" className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "all" ? "All statuses" : s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or email"
              className="w-full pl-8 sm:w-56"
            />
          </div>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        rowActions={rowActions}
        empty={
          loading ? (
            <TableEmptyState title="Loading…" description="Fetching contacts." />
          ) : (
            <TableEmptyState
              title="No contacts match"
              description="Contacts appear here once the trigger fires for them."
            />
          )
        }
      />

      {total > 0 && (
        <TablePagination
          current={page}
          pageSize={perPage}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPerPage(size);
            setPage(1);
          }}
        />
      )}
    </div>
  );
}

export default function AutomationReports() {
  const { id } = useParams();
  const [automation, setAutomation] = useState<Automation | null>(null);
  const [report, setReport] = useState<AutomationReport | null>(null);

  useEffect(() => {
    api
      .get<Automation>(`/automations/${id}`)
      .then(setAutomation)
      .catch((err) => toast.error(errorMessage(err, "failed to load automation")));
    api
      .get<AutomationReport>(`/automations/${id}/report`)
      .then(setReport)
      .catch((err) => toast.error(errorMessage(err, "failed to load report")));
  }, [id]);

  return (
    <PageContainer>
      <PageHeaderWrapper
        variant="title-with-actions"
        title={automation?.name ?? "Report"}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {automation && <Badge status={automation.status} />}
            <Button variant="outline" size="sm" asChild>
              <Link to={`/automations/${id}`}>
                <ArrowLeft className="mr-1 size-4" /> Back to builder
              </Link>
            </Button>
          </div>
        }
      />

      {!report ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Tabs defaultValue="chart" className="space-y-4">
          <TabsList>
            <TabsTrigger value="chart">Chart report</TabsTrigger>
            <TabsTrigger value="steps">Step report</TabsTrigger>
            <TabsTrigger value="emails">Emails analytics</TabsTrigger>
          </TabsList>

          <TabsContent value="chart">
            <ChartReport report={report} />
          </TabsContent>
          <TabsContent value="steps">
            <StepReport report={report} />
          </TabsContent>
          <TabsContent value="emails" className="space-y-4">
            <EmailsAnalytics report={report} />
            <IndividualReporting automationId={String(id)} steps={report.steps} />
          </TabsContent>
        </Tabs>
      )}
    </PageContainer>
  );
}
