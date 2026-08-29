import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import type { CampaignEmail } from "../lib/types.js";
import Badge from "./Badge.js";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyState,
  TablePagination,
} from "./ui/index.js";

export default function CampaignEmailsTable({ campaignId }: { campaignId: number }) {
  const [emails, setEmails] = useState<CampaignEmail[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    api
      .get<{ emails: CampaignEmail[]; total: number }>(
        `/campaigns/${campaignId}/emails?limit=${pageSize}&offset=${(page - 1) * pageSize}`,
      )
      .then((res) => {
        setEmails(res.emails);
        setTotal(res.total);
      });
  }, [campaignId, page, pageSize]);

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Subscriber</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Sent at</TableHead>
            <TableHead className="text-right">Opens</TableHead>
            <TableHead className="text-right">Clicks</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {emails.map((e) => (
            <TableRow key={e.id}>
              <TableCell>
                <div>{e.subscriber_email}</div>
                {e.subscriber_name && (
                  <div className="text-muted-foreground text-xs">{e.subscriber_name}</div>
                )}
              </TableCell>
              <TableCell>
                <Badge status={e.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {e.sent_at ? new Date(e.sent_at).toLocaleString() : "—"}
              </TableCell>
              <TableCell className="text-right">{e.opens}</TableCell>
              <TableCell className="text-right">{e.clicks}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {total === 0 && (
        <TableEmptyState
          title="No recipients yet"
          description="Emails show up here once this campaign starts sending."
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
