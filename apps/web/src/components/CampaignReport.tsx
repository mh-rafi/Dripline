import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { Info, Mail, MailOpen, MousePointerClick, Send, UserMinus } from "lucide-react";
import type { CampaignAnalytics } from "../lib/types.js";
import {
  BlockLayout,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/index.js";

/** Rates are unique-recipient counts over emails actually sent -- the same
 * denominator every ESP reports on, so the numbers are comparable to what
 * Mailchimp/FluentCRM/listmonk show for the same send. Click-to-open is the
 * exception: it is unique clicks over unique *openers*. */
function rate(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0.00%";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

const nf = new Intl.NumberFormat();

interface MetricRow {
  key: string;
  icon: typeof Mail;
  label: string;
  count: number | null;
  value: string;
  hint: string | null;
}

function Metric({ row }: { row: MetricRow }) {
  const Icon = row.icon;
  return (
    <div className="border-border flex items-center justify-between gap-3 border-b py-3 last:border-b-0">
      <div className="text-foreground flex min-w-0 items-center gap-2.5">
        <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <span className="truncate">
          {row.label}
          {row.count !== null && (
            <span className="text-muted-foreground"> ({nf.format(row.count)})</span>
          )}
        </span>
        {row.hint && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`How ${row.label} is calculated`}
                className="text-muted-foreground hover:text-foreground shrink-0 cursor-help"
              >
                <Info className="size-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{row.hint}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <span className="font-medium tabular-nums">{row.value}</span>
    </div>
  );
}

interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
}

function EngagementTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean;
  payload?: { payload: Segment }[];
  total: number;
}) {
  const segment = active ? payload?.[0]?.payload : undefined;
  if (!segment) return null;
  return (
    <div className="bg-popover text-popover-foreground border-border rounded-md border px-3 py-2 text-sm shadow-md">
      <div className="flex items-center gap-2">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: segment.color }}
          aria-hidden
        />
        <span>{segment.label}</span>
      </div>
      <div className="mt-0.5 font-medium tabular-nums">
        {nf.format(segment.value)}
        {total > 0 && (
          <span className="text-muted-foreground font-normal">
            {" "}
            · {rate(segment.value, total)} of sent
          </span>
        )}
      </div>
    </div>
  );
}

export default function CampaignReport({ analytics }: { analytics: CampaignAnalytics }) {
  const { sent, engagement } = analytics;

  const segments: Segment[] = useMemo(
    () => [
      {
        key: "clicked",
        label: "Clicked",
        value: engagement.clicked,
        color: "var(--color-chart-1)",
      },
      {
        key: "opened",
        label: "Opened, no click",
        value: engagement.opened_not_clicked,
        color: "var(--color-chart-2)",
      },
      {
        key: "unopened",
        label: "No recorded open",
        value: engagement.not_opened,
        color: "var(--color-chart-3)",
      },
    ],
    [engagement],
  );

  const plotted = segments.filter((s) => s.value > 0);

  const metrics: MetricRow[] = [
    {
      key: "sent",
      icon: Send,
      label: "Sent Emails",
      count: null,
      value: nf.format(sent),
      hint: null,
    },
    {
      key: "opens",
      icon: MailOpen,
      label: "Open Rate",
      count: analytics.unique_opens,
      value: rate(analytics.unique_opens, sent),
      hint: `Recipients who opened at least once, over emails sent. ${nf.format(analytics.opens)} opens in total.`,
    },
    {
      key: "clicks",
      icon: MousePointerClick,
      label: "Click Rate",
      count: analytics.unique_clicks,
      value: rate(analytics.unique_clicks, sent),
      hint: `Recipients who clicked at least one link, over emails sent. ${nf.format(analytics.clicks)} clicks in total.`,
    },
    {
      key: "ctor",
      icon: Mail,
      label: "Click To Open Rate",
      count: null,
      value: rate(analytics.unique_clicks, analytics.unique_opens),
      hint: "Recipients who clicked, over recipients who opened -- how compelling the content was to the people who actually saw it.",
    },
    {
      key: "unsubscribes",
      icon: UserMinus,
      label: "Unsubscribe",
      count: analytics.unique_unsubscribes,
      value: rate(analytics.unique_unsubscribes, sent),
      hint: `Recipients who left a list from this campaign, over emails sent. ${nf.format(analytics.unsubscribes)} unsubscribe actions in total.`,
    },
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <div className="grid gap-4 lg:grid-cols-3">
        <BlockLayout padding="sm">
          <h4 className="mt-0 mb-1 text-base font-semibold">Campaign Performance</h4>
          <div>
            {metrics.map((row) => (
              <Metric key={row.key} row={row} />
            ))}
          </div>
        </BlockLayout>

        <BlockLayout padding="sm">
          <h4 className="mt-0 mb-1 text-base font-semibold">Email Stats</h4>
          {plotted.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Nothing sent yet -- engagement appears once delivery starts.
            </p>
          ) : (
            <>
              <div className="relative h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={plotted}
                      dataKey="value"
                      nameKey="label"
                      innerRadius="58%"
                      outerRadius="88%"
                      stroke="var(--color-block-layout)"
                      strokeWidth={2}
                      isAnimationActive={false}
                    >
                      {plotted.map((segment) => (
                        <Cell key={segment.key} fill={segment.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip cursor={false} content={<EngagementTooltip total={sent} />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl leading-none font-semibold">{nf.format(sent)}</span>
                  <span className="text-muted-foreground mt-1 text-xs">sent</span>
                </div>
              </div>
              {/* Doubles as the legend and the table view: identity is never
                  carried by the slice colour alone. */}
              <ul className="mt-2 space-y-1.5 text-sm">
                {segments.map((segment) => (
                  <li key={segment.key} className="flex items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: segment.color }}
                      aria-hidden
                    />
                    <span className="text-muted-foreground truncate">{segment.label}</span>
                    <span className="ml-auto shrink-0 font-medium tabular-nums">
                      {nf.format(segment.value)}
                    </span>
                    <span className="text-muted-foreground w-16 shrink-0 text-right tabular-nums">
                      {rate(segment.value, sent)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </BlockLayout>

        <BlockLayout padding="sm">
          <h4 className="mt-0 mb-3 text-base font-semibold">Link activity</h4>
          {analytics.links.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No link clicks recorded yet.
            </p>
          ) : (
            <TableWrapper>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>URL</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Unique</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analytics.links.map((link) => (
                    <TableRow key={link.url}>
                      <TableCell className="max-w-0">
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          title={link.url}
                          className="text-primary block truncate hover:underline"
                        >
                          {link.url}
                        </a>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {nf.format(link.unique_clicks)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">
                        {nf.format(link.clicks)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          )}
        </BlockLayout>
      </div>
    </TooltipProvider>
  );
}
