interface BadgeProps {
  status: string;
  /** Overrides the displayed text while `status` still controls the color. */
  label?: string;
  title?: string;
}

export default function Badge({ status, label, title }: BadgeProps) {
  return (
    <span className={`badge ${status}`} title={title}>
      {label ?? status}
    </span>
  );
}
