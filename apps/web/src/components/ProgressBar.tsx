import type { CampaignProgress } from "../lib/types.js";

export default function ProgressBar({ progress }: { progress: CampaignProgress }) {
  const total = progress.total || 1;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div>
      <div className="progress-bar">
        <div className="sent" style={{ width: pct(progress.sent) }} />
        <div className="failed" style={{ width: pct(progress.failed) }} />
        <div className="pending" style={{ width: pct(progress.pending + progress.queued) }} />
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        {progress.sent} sent · {progress.failed} failed · {progress.pending + progress.queued}{" "}
        pending · {progress.total} total
      </div>
    </div>
  );
}
