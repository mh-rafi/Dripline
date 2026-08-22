import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Campaign } from "../lib/types.js";
import Badge from "../components/Badge.js";
import ProgressBar from "../components/ProgressBar.js";

interface Analytics {
  opens: number;
  unique_opens: number;
  clicks: number;
  unique_clicks: number;
}

export default function CampaignDetail() {
  const { id } = useParams();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get<Campaign>(`/campaigns/${id}`).then(setCampaign);
    api.get<Analytics>(`/campaigns/${id}/analytics`).then(setAnalytics);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [id]);

  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "action failed");
    } finally {
      setBusy(false);
    }
  }

  if (!campaign) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="page-header">
        <h2>{campaign.name}</h2>
        <Badge status={campaign.status} />
      </div>

      <div className="card">
        <div>
          <strong>Subject:</strong> {campaign.subject}
        </div>
        <div style={{ marginTop: 8 }}>
          <strong>Lists:</strong>{" "}
          {campaign.lists?.map((l) => l.name).join(", ") || <span className="muted">none</span>}
        </div>
        <div style={{ marginTop: 8 }}>
          <strong>Throttle:</strong> {campaign.messages_per_minute} messages/minute
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Progress</h3>
        {campaign.progress && <ProgressBar progress={campaign.progress} />}
      </div>

      {analytics && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Engagement</h3>
          <div className="form-row">
            <div>
              <div className="muted">Opens</div>
              <div style={{ fontSize: 22 }}>
                {analytics.unique_opens}{" "}
                <span className="muted" style={{ fontSize: 14 }}>
                  ({analytics.opens} total)
                </span>
              </div>
            </div>
            <div>
              <div className="muted">Clicks</div>
              <div style={{ fontSize: 22 }}>
                {analytics.unique_clicks}{" "}
                <span className="muted" style={{ fontSize: 14 }}>
                  ({analytics.clicks} total)
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      <div className="toolbar">
        {(campaign.status === "draft" ||
          campaign.status === "paused" ||
          campaign.status === "scheduled") && (
          <button disabled={busy} onClick={() => action(() => api.post(`/campaigns/${id}/start`))}>
            {campaign.status === "paused" ? "Resume" : "Start sending"}
          </button>
        )}
        {campaign.status === "running" && (
          <button
            disabled={busy}
            className="secondary"
            onClick={() => action(() => api.post(`/campaigns/${id}/pause`))}
          >
            Pause
          </button>
        )}
        {(campaign.status === "running" ||
          campaign.status === "paused" ||
          campaign.status === "draft") && (
          <button
            disabled={busy}
            className="danger"
            onClick={() => action(() => api.post(`/campaigns/${id}/cancel`))}
          >
            Cancel
          </button>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Body preview</h3>
        <div dangerouslySetInnerHTML={{ __html: campaign.body }} />
      </div>
    </div>
  );
}
