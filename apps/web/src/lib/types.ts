export interface Subscriber {
  id: number;
  uuid: string;
  email: string;
  name: string;
  attribs: Record<string, unknown>;
  tags: string[];
  status: "enabled" | "blocklisted";
  created_at: string;
}

export interface List {
  id: number;
  name: string;
  type: "public" | "private";
  optin: "single" | "double";
  description: string;
  subscriber_count?: number;
  unsubscribed_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Template {
  id: number;
  name: string;
  subject: string;
  body: string;
  is_default: boolean;
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
  use_iam_role?: boolean;
}

export type ConnectionConfig = SmtpConnectionConfig | SesConnectionConfig;

export interface BounceMailboxConfig {
  enabled: boolean;
  host: string;
  port: number;
  tls: boolean;
  username: string;
  password: string;
  /** Where bounces should be sent -- distinct from `username`, which is an
   * IMAP login and not always a real email address. */
  email: string;
  use_sending_credentials: boolean;
  folder: string;
  max_age_days: number;
  max_messages_per_scan: number;
}

export interface Connection {
  id: number;
  name: string;
  type: ConnectionType;
  from_email: string;
  from_name: string;
  reply_to: string | null;
  rate_limit_count: number | null;
  rate_limit_duration_seconds: number | null;
  enabled: boolean;
  max_errors: number;
  error_count: number;
  disabled_reason: string | null;
  list_unsubscribe_header: boolean;
  bounce_config: BounceMailboxConfig | null;
  bounce_error_count: number;
  bounce_disabled_reason: string | null;
  config: ConnectionConfig & Record<string, unknown>;
}

export type CampaignStatus =
  "draft" | "scheduled" | "running" | "paused" | "finished" | "cancelled";
export type ContentType = "richtext" | "html" | "plain" | "markdown" | "visual";

export interface Campaign {
  id: number;
  uuid: string;
  name: string;
  subject: string;
  preheader: string | null;
  body: string;
  body_source: string | null;
  /** Hand-written plain-text alternative. Null means it's generated from the
   * HTML at send time. */
  alt_body: string | null;
  content_type: ContentType;
  status: CampaignStatus;
  from_email: string | null;
  from_name: string | null;
  reply_to: string | null;
  template_id: number | null;
  rate_limit_count: number | null;
  rate_limit_duration_seconds: number | null;
  track_opens: boolean;
  track_clicks: boolean;
  to_send: number;
  sent: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  lists?: { id: number; name: string }[];
  connections?: {
    id: number;
    name: string;
    from_email: string;
    type: ConnectionType;
    priority: number;
  }[];
  progress?: CampaignProgress;
}

export interface CampaignProgress {
  pending: number;
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  total: number;
}

export type CampaignEmailStatus = "pending" | "queued" | "sent" | "failed" | "skipped";

export interface CampaignEmail {
  id: string;
  subscriber_id: number;
  subscriber_email: string;
  subscriber_name: string;
  status: CampaignEmailStatus;
  sent_at: string | null;
  opens: number;
  clicks: number;
}

export interface CampaignLinkActivity {
  url: string;
  clicks: number;
  unique_clicks: number;
}

/** Campaign engagement. Rates are derived client-side from `sent` -- the
 * industry convention: unique opens/clicks over emails actually sent.
 * `engagement` is the same population split into three disjoint buckets that
 * sum to `sent`, so it can be charted as a part-to-whole. */
export interface CampaignAnalytics {
  sent: number;
  opens: number;
  unique_opens: number;
  clicks: number;
  unique_clicks: number;
  unsubscribes: number;
  unique_unsubscribes: number;
  /** Only the departures that named a reason, most common first. Everything
   * left over in `unsubscribes` is someone who skipped the question. */
  reasons: { reason: string; count: number }[];
  engagement: {
    clicked: number;
    opened_not_clicked: number;
    not_opened: number;
  };
  links: CampaignLinkActivity[];
}

export type UnsubscribeSource = "one_click" | "preferences" | "all";

/** One unsubscribe action. `lists` names the lists left; a list deleted since
 * then stays in `list_ids` without a matching entry in `lists`. */
export interface CampaignUnsubscribe {
  id: string;
  subscriber_id: number | null;
  subscriber_email: string | null;
  subscriber_name: string | null;
  source: UnsubscribeSource;
  /** Optional feedback given on the preference page after leaving. Null for
   * one-click departures and for anyone who skipped the question. */
  reason: string | null;
  reason_comment: string | null;
  list_ids: number[];
  lists: { id: number; name: string }[];
  created_at: string;
}

export type AutomationStatus = "draft" | "published" | "paused";
export type AutomationReentryMode = "once" | "multiple";

/** One block on the builder canvas. `next` is a node id (or null for the end
 * of a path) -- pointer edges, not array order, so conditional branches can be
 * added later. See docs/plan/automations_v2.md. */
export interface AutomationNode {
  id: string;
  type: string;
  title?: string;
  note?: string;
  config: Record<string, unknown>;
  next: string | null;
}

export interface AutomationGraph {
  entry: string | null;
  nodes: AutomationNode[];
}

export interface Automation {
  id: number;
  uuid: string;
  name: string;
  status: AutomationStatus;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  graph: AutomationGraph;
  reentry_mode: AutomationReentryMode;
  created_at: string;
  updated_at: string;
  enrollment_counts?: { status: string; count: string }[];
}

export interface AutomationEnrollment {
  id: string;
  status: "active" | "completed" | "cancelled";
  current_node_id: string | null;
  next_run_at: string | null;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
  subscriber_id: number;
  email: string;
  name: string;
}

export interface AutomationEnrollmentPage {
  enrollments: AutomationEnrollment[];
  total: number;
  page: number;
  per_page: number;
}

export interface AutomationReportEmail {
  subject: string;
  sent: number;
  opens: number;
  unique_opens: number;
  clicks: number;
  unique_clicks: number;
  unsubscribes: number;
  links: { url: string; clicks: number; unique_clicks: number }[];
}

/** One graph node in path order. `contacts` is how many reached it, from the
 * node-run log -- not where anyone currently sits. */
export interface AutomationReportStep {
  node_id: string;
  type: string;
  label: string;
  contacts: number;
  pct: number;
  drop_pct: number;
  email: AutomationReportEmail | null;
}

export interface AutomationReport {
  entered: number;
  enrollment_counts: { active: number; completed: number; cancelled: number };
  steps: AutomationReportStep[];
  conversion_pct: number;
}

export type UserType = "user" | "api";
export type UserStatus = "enabled" | "disabled";

export interface User {
  id: number;
  name: string;
  email: string | null;
  type: UserType;
  role_id: number;
  role_name: string;
  status: UserStatus;
  api_key_prefix: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Only present in the response right after creating/regenerating an API
 * user's token -- shown to the admin exactly once. */
export interface UserWithToken extends User {
  token: string;
}

export interface Role {
  id: number;
  name: string;
  permissions: string[];
  created_at: string;
  updated_at: string;
}

export interface MediaItem {
  id: number;
  uuid: string;
  provider: string;
  filename: string;
  content_type: string;
  size: number;
  meta: Record<string, unknown>;
  created_at: string;
  /** Resolved server-side on every read -- a private bucket returns a
   * pre-signed URL that expires, so this must not be cached or stored. */
  url: string;
}

export interface S3Settings {
  url: string;
  public_url: string;
  region: string;
  access_key_id: string;
  /** Comes back masked when one is stored; sending the mask back unchanged
   * keeps the saved key. */
  secret_access_key: string;
  bucket: string;
  bucket_path: string;
  bucket_type: "public" | "private";
  expiry_seconds: number;
  force_path_style: boolean | null;
}

export interface MediaSettings {
  provider: "s3";
  extensions: string[];
  max_size_mb: number;
  s3: S3Settings;
}

export interface SystemSettings {
  /** Connection used for mail Dripline sends on its own behalf (password
   * resets). `null` means system email is switched off. */
  connection_id: number | null;
}

export interface Settings {
  media: MediaSettings;
  system: SystemSettings;
}
