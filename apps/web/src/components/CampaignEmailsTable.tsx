import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import type { CampaignEmail } from "../lib/types.js";
import Badge from "./Badge.js";
import { DataTable, TableEmptyState, TablePagination } from "./ui/index.js";
import type { DataTableColumn } from "./ui/index.js";

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

  const columns: DataTableColumn<CampaignEmail>[] = [
    {
      key: "subscriber",
      header: "Subscriber",
      mobile: "title",
      cell: (e) => (
        <>
          <div>{e.subscriber_email}</div>
          {e.subscriber_name && (
            <div className="text-muted-foreground text-xs">{e.subscriber_name}</div>
          )}
        </>
      ),
    },
    { key: "status", header: "Status", mobile: "status", cell: (e) => <Badge status={e.status} /> },
    {
      key: "sent_at",
      header: "Sent at",
      className: "text-muted-foreground",
      cell: (e) => (e.sent_at ? new Date(e.sent_at).toLocaleString() : "—"),
    },
    { key: "opens", header: "Opens", align: "right", cell: (e) => e.opens },
    { key: "clicks", header: "Clicks", align: "right", cell: (e) => e.clicks },
  ];

  return (
    <div>
      <DataTable
        columns={columns}
        rows={emails}
        rowKey={(e) => e.id}
        empty={
          <TableEmptyState
            title="No recipients yet"
            description="Emails show up here once this campaign starts sending."
          />
        }
      />
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
