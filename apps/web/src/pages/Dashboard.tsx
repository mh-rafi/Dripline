import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Campaign, List, Subscriber } from "../lib/types.js";
import Badge from "../components/Badge.js";

export default function Dashboard() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    api.get<Subscriber[]>("/subscribers?limit=200").then(setSubscribers);
    api.get<List[]>("/lists").then(setLists);
    api.get<Campaign[]>("/campaigns").then(setCampaigns);
  }, []);

  const running = campaigns.filter((c) => c.status === "running");
  const subscriberCountLabel = subscribers.length >= 200 ? "200+" : String(subscribers.length);

  return (
    <div>
      <div className="page-header">
        <h2>Dashboard</h2>
      </div>

      <div className="form-row">
        <div className="card">
          <div className="muted">Subscribers</div>
          <div style={{ fontSize: 28 }}>{subscriberCountLabel}</div>
        </div>
        <div className="card">
          <div className="muted">Lists</div>
          <div style={{ fontSize: 28 }}>{lists.length}</div>
        </div>
        <div className="card">
          <div className="muted">Campaigns</div>
          <div style={{ fontSize: 28 }}>{campaigns.length}</div>
        </div>
        <div className="card">
          <div className="muted">Running now</div>
          <div style={{ fontSize: 28 }}>{running.length}</div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Recent campaigns</h3>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Sent</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.slice(0, 8).map((c) => (
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
              </tr>
            ))}
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  No campaigns yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
