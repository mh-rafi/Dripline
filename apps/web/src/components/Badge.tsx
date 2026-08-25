import { Badge as UIBadge } from "./ui/index.js";

interface BadgeProps {
  status: string;
  label?: string;
  title?: string;
}

const statusColorMap: Record<string, string> = {
  running: "bg-success/15 text-success border border-success/20",
  active: "bg-success/15 text-success border border-success/20",
  published: "bg-success/15 text-success border border-success/20",
  finished: "bg-primary/15 text-primary border border-primary/20",
  completed: "bg-primary/15 text-primary border border-primary/20",
  confirmed: "bg-success/15 text-success border border-success/20",
  enabled: "bg-success/15 text-success border border-success/20",
  scheduled: "bg-warning/15 text-warning border border-warning/20",
  paused: "bg-warning/15 text-warning border border-warning/20",
  unconfirmed: "bg-warning/15 text-warning border border-warning/20",
  cancelled: "bg-destructive/15 text-destructive border border-destructive/20",
  blocklisted: "bg-destructive/15 text-destructive border border-destructive/20",
  unsubscribed: "bg-destructive/15 text-destructive border border-destructive/20",
  failed: "bg-destructive/15 text-destructive border border-destructive/20",
  draft: "bg-muted text-muted-foreground",
  skipped: "bg-muted text-muted-foreground",
  public: "bg-primary/15 text-primary border border-primary/20",
  private: "bg-warning/15 text-warning border border-warning/20",
};

export default function Badge({ status, label, title }: BadgeProps) {
  const colorClass = statusColorMap[status] ?? "bg-muted text-muted-foreground";
  return (
    <UIBadge className={colorClass} title={title}>
      {label ?? status}
    </UIBadge>
  );
}
