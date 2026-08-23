import type { CampaignProgress } from "../lib/types.js";

export default function ProgressBar({ progress }: { progress: CampaignProgress }) {
  const total = progress.total || 1;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div>
      <div className="border-input bg-muted flex h-2 w-full overflow-hidden rounded-md border">
        <div className="bg-success transition-all" style={{ width: pct(progress.sent) }} />
        <div className="bg-destructive transition-all" style={{ width: pct(progress.failed) }} />
        <div
          className="bg-muted-foreground/30 transition-all"
          style={{ width: pct(progress.pending + progress.queued) }}
        />
      </div>
      <div className="text-muted-foreground mt-1.5 text-xs">
        {progress.sent} sent · {progress.failed} failed · {progress.pending + progress.queued}{" "}
        pending · {progress.total} total
      </div>
    </div>
  );
}
