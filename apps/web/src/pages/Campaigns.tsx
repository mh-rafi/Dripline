import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Campaign } from "../lib/types.js";
import Badge from "../components/Badge.js";

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    api.get<Campaign[]>("/campaigns").then(setCampaigns);
  }, []);

  return (
    <div>
      <div className="page-header">
        <h2>Campaigns</h2>
        <Link to="/campaigns/new" className="btn">
          New campaign
        </Link>
      </div>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Sent</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.id}>
              <td>
                <Link to={`/campaigns/${c.id}`}>{c.name}</Link>
              </td>
              <td>
                <Badge status={c.status} />
              </td>
              <td>
                {c.sent} / {c.to_send}
              </td>
              <td className="muted">{new Date(c.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
          {campaigns.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No campaigns yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
