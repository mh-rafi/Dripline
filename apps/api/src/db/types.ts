import type { ColumnType, Generated } from "kysely";

type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface SubscribersTable {
  id: Generated<number>;
  uuid: Generated<string>;
  email: string;
  name: Generated<string>;
  attribs: Generated<Record<string, unknown>>;
  status: Generated<"enabled" | "blocklisted">;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface ListsTable {
  id: Generated<number>;
  uuid: Generated<string>;
  name: string;
  type: "public" | "private";
  optin: "single" | "double";
  description: Generated<string>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface SubscriberListsTable {
  subscriber_id: number;
  list_id: number;
  status: Generated<"unconfirmed" | "confirmed" | "unsubscribed">;
  // Set by blocklistSubscriber() to remember this membership's status right
  // before it force-unsubscribed it, so unblocklistSubscriber() can restore
  // exactly that -- null means either never blocklisted, or already
  // unsubscribed by the subscriber's own action before blocklisting (in
  // which case there's nothing to restore).
  pre_blocklist_status: "unconfirmed" | "confirmed" | "unsubscribed" | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface TemplatesTable {
  id: Generated<number>;
  name: string;
  subject: Generated<string>;
  body: string;
  is_default: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface UsersTable {
  id: Generated<number>;
  email: string;
  password_hash: string;
  name: Generated<string>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface ApiKeysTable {
  id: Generated<number>;
  name: string;
  key_prefix: string;
  key_hash: string;
  last_used_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export type ConnectionType = "smtp" | "ses";

export type TlsMode = "none" | "starttls" | "tls";
export type AuthMethod = "none" | "login" | "plain" | "cram-md5";

export interface SmtpConnectionConfig {
  host: string;
  port: number;
  tls_mode: TlsMode;
  tls_skip_verify: boolean;
  auth_method: AuthMethod;
  username?: string;
  password?: string;
}

export interface SesConnectionConfig {
  region: string;
  access_key_id?: string;
  secret_access_key?: string;
  /** Use the ambient IAM/instance role instead of static keys. */
  use_iam_role?: boolean;
}

export type ConnectionConfig = SmtpConnectionConfig | SesConnectionConfig;

export interface ConnectionsTable {
  id: Generated<number>;
  name: string;
  type: Generated<ConnectionType>;
  config: ConnectionConfig;
  from_email: string;
  from_name: Generated<string>;
  rate_limit_count: number | null;
  rate_limit_duration_seconds: number | null;
  window_start: Timestamp | null;
  window_count: Generated<number>;
  enabled: Generated<boolean>;
  max_errors: Generated<number>;
  error_count: Generated<number>;
  disabled_reason: string | null;
  list_unsubscribe_header: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface CampaignConnectionsTable {
  campaign_id: number;
  connection_id: number;
  priority: Generated<number>;
  created_at: Generated<Timestamp>;
}

export type CampaignStatus =
  "draft" | "scheduled" | "running" | "paused" | "finished" | "cancelled";

export type CampaignContentType = "richtext" | "html" | "plain" | "markdown" | "visual";

export interface CampaignsTable {
  id: Generated<number>;
  uuid: Generated<string>;
  name: string;
  subject: string;
  from_email: string | null;
  template_id: number | null;
  body: Generated<string>;
  /** Original editor source (markdown text, visual builder JSON, or a mirror
   * of `body` for richtext/html/plain). `body` is always the final HTML. */
  body_source: string | null;
  content_type: Generated<CampaignContentType>;
  status: Generated<CampaignStatus>;
  send_at: Timestamp | null;
  /** Optional secondary throttle: at most `rate_limit_count` sends per
   * `rate_limit_duration_seconds`, on top of the connection's own (primary)
   * rate limit. Null means no additional campaign-level cap. */
  rate_limit_count: number | null;
  rate_limit_duration_seconds: number | null;
  window_start: Timestamp | null;
  window_count: Generated<number>;
  max_send_errors: Generated<number>;
  track_opens: Generated<boolean>;
  track_clicks: Generated<boolean>;
  to_send: Generated<number>;
  sent: Generated<number>;
  failed: Generated<number>;
  started_at: Timestamp | null;
  finished_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface CampaignListsTable {
  campaign_id: number;
  list_id: number;
}

export type CampaignEmailStatus = "pending" | "queued" | "sent" | "failed" | "skipped";

export interface CampaignEmailsTable {
  id: Generated<string>;
  campaign_id: number;
  subscriber_id: number;
  status: Generated<CampaignEmailStatus>;
  connection_id: number | null;
  attempts: Generated<number>;
  error: string | null;
  sent_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface CampaignViewsTable {
  id: Generated<string>;
  campaign_id: number;
  subscriber_id: number | null;
  created_at: Generated<Timestamp>;
}

export interface LinksTable {
  id: Generated<number>;
  uuid: Generated<string>;
  url: string;
  created_at: Generated<Timestamp>;
}

export interface LinkClicksTable {
  id: Generated<string>;
  link_id: number;
  campaign_id: number | null;
  subscriber_id: number | null;
  created_at: Generated<Timestamp>;
}

export type WorkflowTriggerType =
  "list_joined" | "tag_applied" | "webhook" | "link_clicked" | "manual";

export type WorkflowStatus = "draft" | "active" | "paused";

export interface WorkflowsTable {
  id: Generated<number>;
  uuid: Generated<string>;
  name: string;
  trigger_type: WorkflowTriggerType;
  trigger_config: Generated<Record<string, unknown>>;
  steps: unknown[];
  status: Generated<WorkflowStatus>;
  reentry_allowed: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export type WorkflowEnrollmentStatus = "active" | "completed" | "cancelled";

export interface WorkflowEnrollmentsTable {
  id: Generated<string>;
  workflow_id: number;
  subscriber_id: number;
  status: Generated<WorkflowEnrollmentStatus>;
  current_step: Generated<number>;
  next_run_at: Timestamp | null;
  context: Generated<Record<string, unknown>>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface WorkflowEventsTable {
  id: Generated<string>;
  source: string;
  event_key: string;
  subscriber_id: number | null;
  payload: Generated<Record<string, unknown>>;
  processed: Generated<boolean>;
  created_at: Generated<Timestamp>;
}

export type BounceType = "hard" | "soft" | "complaint";

export interface BouncesTable {
  id: Generated<string>;
  subscriber_id: number;
  campaign_id: number | null;
  type: BounceType;
  source: Generated<string>;
  meta: Generated<Record<string, unknown>>;
  created_at: Generated<Timestamp>;
}

export interface Database {
  subscribers: SubscribersTable;
  lists: ListsTable;
  subscriber_lists: SubscriberListsTable;
  templates: TemplatesTable;
  users: UsersTable;
  api_keys: ApiKeysTable;
  connections: ConnectionsTable;
  campaigns: CampaignsTable;
  campaign_lists: CampaignListsTable;
  campaign_connections: CampaignConnectionsTable;
  campaign_emails: CampaignEmailsTable;
  campaign_views: CampaignViewsTable;
  links: LinksTable;
  link_clicks: LinkClicksTable;
  workflows: WorkflowsTable;
  workflow_enrollments: WorkflowEnrollmentsTable;
  workflow_events: WorkflowEventsTable;
  bounces: BouncesTable;
}
