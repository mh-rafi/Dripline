/** A subscriber row formatted for CSV export. */
export interface SubscriberRow {
  email: string;
  name: string;
  status: string;
  attribs: Record<string, unknown> | null;
  tags: string[] | null;
  lists: string;
}
