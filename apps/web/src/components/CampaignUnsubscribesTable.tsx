import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import type { CampaignUnsubscribe, UnsubscribeSource } from "../lib/types.js";
import { unsubscribeReasonLabel } from "../lib/unsubscribeReasons.js";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyState,
  TablePagination,
  Tag,
} from "./ui/index.js";

const SOURCE_LABELS: Record<UnsubscribeSource, string> = {
  one_click: "One-click",
  preferences: "Preference page",
  all: "Left everything",
};

export default function CampaignUnsubscribesTable({ campaignId }: { campaignId: number }) {
  const [rows, setRows] = useState<CampaignUnsubscribe[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    api
      .get<{ unsubscribes: CampaignUnsubscribe[]; total: number }>(
        `/campaigns/${campaignId}/unsubscribes?limit=${pageSize}&offset=${(page - 1) * pageSize}`,
      )
      .then((res) => {
        setRows(res.unsubscribes);
        setTotal(res.total);
      });
  }, [campaignId, page, pageSize]);

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Subscriber</TableHead>
            <TableHead>Lists left</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Via</TableHead>
            <TableHead>When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((u) => (
            <TableRow key={u.id}>
              <TableCell>
                {u.subscriber_id ? (
                  <Link
                    to={`/subscribers/${u.subscriber_id}`}
                    className="text-primary hover:underline"
                  >
                    {u.subscriber_email}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">deleted contact</span>
                )}
                {u.subscriber_name && (
                  <div className="text-muted-foreground text-xs">{u.subscriber_name}</div>
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1.5">
                  {u.lists.map((l) => (
                    <Tag key={l.id}>{l.name}</Tag>
                  ))}
                  {/* A list deleted since the unsubscribe has no name to show,
                      but it still counted -- don't silently under-report. */}
                  {u.list_ids.length > u.lists.length && (
                    <span className="text-muted-foreground text-xs">
                      +{u.list_ids.length - u.lists.length} deleted
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                {u.reason ? (
                  <>
                    {unsubscribeReasonLabel(u.reason)}
                    {/* Free text from a public page -- rendered as text, never
                        as markup, and clamped so one long answer can't stretch
                        the row. */}
                    {u.reason_comment && (
                      <div
                        className="text-muted-foreground line-clamp-3 text-xs"
                        title={u.reason_comment}
                      >
                        {u.reason_comment}
                      </div>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">{SOURCE_LABELS[u.source]}</TableCell>
              <TableCell className="text-muted-foreground">
                {new Date(u.created_at).toLocaleString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {total === 0 && (
        <TableEmptyState
          title="No unsubscribes"
          description="Nobody has unsubscribed from this campaign."
        />
      )}
      {total > 0 && (
        <TablePagination
          current={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
        />
      )}
    </div>
  );
}
