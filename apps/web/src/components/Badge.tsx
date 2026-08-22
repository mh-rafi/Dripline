export default function Badge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{status}</span>;
}
