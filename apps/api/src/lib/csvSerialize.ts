import type { SubscriberRow } from "./subscriberExport.js";

/**
 * Serializes an array of subscriber rows into a CSV string. Quoting follows
 * RFC 4180: a field is wrapped in double-quotes if it contains the
 * delimiter, a double-quote, or a newline; embedded double-quotes are
 * escaped by doubling. No external CSV library — this is a handful of
 * columns and the quoting rules are simple.
 *
 * For dataset sizes this self-hosted tool deals with (thousands, not
 * millions), building the full string in memory before responding is fine.
 * A true streamed response would be the fix if this ever becomes a memory
 * problem, but that's solving a problem this project doesn't have yet.
 */
export function subscribersToCSV(rows: SubscriberRow[]): string {
  const DELIMITER = ",";
  const NEWLINE = "\n";
  const HEADER = ["email", "name", "status", "attribs", "lists"];

  const lines: string[] = [HEADER.map(quoteField).join(DELIMITER)];

  for (const row of rows) {
    const fields = [
      row.email,
      row.name,
      row.status,
      row.attribs ? JSON.stringify(row.attribs) : "",
      row.lists,
    ];
    lines.push(fields.map((f) => quoteField(f ?? "")).join(DELIMITER));
  }

  return lines.join(NEWLINE) + NEWLINE;
}

function quoteField(value: string): string {
  if (value === "") return "";
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
