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

export type UserType = "user" | "api";
export type UserStatus = "enabled" | "disabled";

export interface UsersTable {
  id: Generated<number>;
  email: string | null;
  password_hash: string | null;
  name: Generated<string>;
  type: Generated<UserType>;
  role_id: number;
  status: Generated<UserStatus>;
  api_key_prefix: string | null;
  api_key_hash: string | null;
  last_used_at: Timestamp | null;
  password_changed_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface PasswordResetTokensTable {
  id: Generated<number>;
  user_id: number;
  token_hash: string;
  expires_at: Timestamp;
  used_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export type RoleType = "user";

export interface RolesTable {
  id: Generated<number>;
  type: Generated<RoleType>;
  name: string;
  permissions: Generated<string[]>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
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

/** Per-connection bounce-mailbox (IMAP) scan config -- see
 * docs/plan/mailbox_bounce_scanning.md. Null on the row means scanning is
 * unavailable/never configured; `enabled` is the actual on/off switch once
 * configured (so a user can temporarily pause without losing the fields). */
export interface BounceMailboxConfig {
  enabled: boolean;
  // Always required when enabled -- an IMAP host is never safely derivable
  // from the connection's own sending config (different hostname almost
  // every time, even for the same mailbox).
  host: string;
  port: number;
  tls: boolean;
  /** IMAP login only -- not necessarily an email address (some providers,
   * e.g. shared/cPanel Dovecot setups, authenticate with a bare local-part
   * or SAM account name). Ignored in favor of this connection's own sending
   * login when use_sending_credentials is true (smtp connections only). */
  username: string;
  password: string;
  /** The address bounces should actually be sent to -- distinct from
   * `username` since an IMAP login isn't always a real email address (see
   * above). Required, and only meaningful, when use_sending_credentials is
   * false: drives the outgoing envelope-from override in
   * services/connections.ts so DSNs actually route to this mailbox. */
  email: string;
  use_sending_credentials: boolean;
  folder: string;
  max_age_days: number;
  max_messages_per_scan: number;
}

export interface ConnectionsTable {
  id: Generated<number>;
  name: string;
  type: Generated<ConnectionType>;
  config: ConnectionConfig;
  from_email: string;
  from_name: Generated<string>;
  /** Default Reply-To for everything this connection sends; a campaign's own
   * reply_to overrides it. Null leaves the header off entirely. */
  reply_to: string | null;
  rate_limit_count: number | null;
  rate_limit_duration_seconds: number | null;
  window_start: Timestamp | null;
  window_count: Generated<number>;
  enabled: Generated<boolean>;
  max_errors: Generated<number>;
  error_count: Generated<number>;
  disabled_reason: string | null;
  list_unsubscribe_header: Generated<boolean>;
  bounce_config: BounceMailboxConfig | null;
  /** Scanner-owned cursor state, not user-editable -- see
   * services/bounceScanner.ts. bounce_last_uidvalidity is BIGINT, which
   * node-postgres returns as a string (no custom type parser is registered
   * in this project -- see db.ts), not a JS number. */
  bounce_last_uid: number | null;
  bounce_last_uidvalidity: string | null;
  bounce_error_count: Generated<number>;
  bounce_disabled_reason: string | null;
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
  /** Inbox preview text -- shown next to the subject in the mail client's
   * list, never inside the opened email. Rendered as a hidden div, so it's
   * meaningless (and skipped) for plain-text campaigns. */
  preheader: string | null;
  from_email: string | null;
  /** Display name only -- valid on its own, in which case the connection's
   * from_email is still the address. See fromAddress() in services/connections.ts. */
  from_name: string | null;
  reply_to: string | null;
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
  message_id: string | null;
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

export type UnsubscribeSource = "one_click" | "preferences" | "all";

/** One row per unsubscribe *action*, for campaigns and automations alike --
 * `list_ids` carries which lists that single action actually left. At most one
 * of `campaign_id`/`automation_id` is set; both null means the signed link's
 * uuid no longer resolves. */
export interface CampaignUnsubscribesTable {
  id: Generated<string>;
  subscriber_id: number | null;
  campaign_id: number | null;
  automation_id: number | null;
  source: UnsubscribeSource;
  list_ids: Generated<number[]>;
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

export type AutomationStatus = "draft" | "published" | "paused";

export type AutomationReentryMode = "once" | "multiple";

/** Node graph shape -- see lib/automationGraph.ts for the validating schema and
 * docs/plan/automations_v2.md for why edges are pointers, not array order. */
export interface AutomationGraph {
  entry: string | null;
  nodes: {
    id: string;
    type: string;
    title?: string;
    note?: string;
    config: Record<string, unknown>;
    next: string | null;
  }[];
}

export interface AutomationsTable {
  id: Generated<number>;
  uuid: Generated<string>;
  name: string;
  status: Generated<AutomationStatus>;
  /** Registry key from automations/triggers.ts -- deliberately not a DB enum. */
  trigger_type: string;
  trigger_config: Generated<Record<string, unknown>>;
  graph: Generated<AutomationGraph>;
  reentry_mode: Generated<AutomationReentryMode>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export type AutomationEnrollmentStatus = "active" | "completed" | "cancelled";

export interface AutomationEnrollmentsTable {
  id: Generated<string>;
  automation_id: number;
  subscriber_id: number;
  status: Generated<AutomationEnrollmentStatus>;
  current_node_id: string | null;
  next_run_at: Timestamp | null;
  context: Generated<Record<string, unknown>>;
  started_at: Generated<Timestamp>;
  completed_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface AutomationEventsTable {
  id: Generated<string>;
  source: string;
  event_key: string;
  subscriber_id: number | null;
  payload: Generated<Record<string, unknown>>;
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

export interface SettingsTable {
  key: string;
  value: Record<string, unknown>;
  updated_at: Generated<Timestamp>;
}

export interface MediaTable {
  id: Generated<number>;
  uuid: Generated<string>;
  provider: Generated<string>;
  filename: string;
  content_type: Generated<string>;
  // BIGINT comes back from pg as a string; nothing reads it arithmetically
  // server-side, so it's carried through as-is and formatted in the UI.
  size: Generated<string | number>;
  meta: Generated<Record<string, unknown>>;
  created_at: Generated<Timestamp>;
}

export interface Database {
  subscribers: SubscribersTable;
  lists: ListsTable;
  subscriber_lists: SubscriberListsTable;
  templates: TemplatesTable;
  users: UsersTable;
  roles: RolesTable;
  password_reset_tokens: PasswordResetTokensTable;
  connections: ConnectionsTable;
  campaigns: CampaignsTable;
  campaign_lists: CampaignListsTable;
  campaign_connections: CampaignConnectionsTable;
  campaign_emails: CampaignEmailsTable;
  campaign_views: CampaignViewsTable;
  campaign_unsubscribes: CampaignUnsubscribesTable;
  links: LinksTable;
  link_clicks: LinkClicksTable;
  automations: AutomationsTable;
  automation_enrollments: AutomationEnrollmentsTable;
  automation_events: AutomationEventsTable;
  bounces: BouncesTable;
  settings: SettingsTable;
  media: MediaTable;
}
