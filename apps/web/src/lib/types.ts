export interface Subscriber {
  id: number;
  uuid: string;
  email: string;
  name: string;
  attribs: Record<string, unknown>;
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

export interface Connection {
  id: number;
  name: string;
  type: ConnectionType;
  from_email: string;
  from_name: string;
  rate_limit_count: number | null;
  rate_limit_duration_seconds: number | null;
  enabled: boolean;
  max_errors: number;
  error_count: number;
  disabled_reason: string | null;
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
  body: string;
  body_source: string | null;
  content_type: ContentType;
  status: CampaignStatus;
  from_email: string | null;
  template_id: number | null;
  rate_limit_count: number | null;
  rate_limit_duration_seconds: number | null;
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

export type WorkflowTriggerType =
  "list_joined" | "tag_applied" | "webhook" | "link_clicked" | "manual";
export type WorkflowStatus = "draft" | "active" | "paused";

export interface Workflow {
  id: number;
  uuid: string;
  name: string;
  trigger_type: WorkflowTriggerType;
  trigger_config: Record<string, unknown>;
  steps: unknown[];
  status: WorkflowStatus;
  reentry_allowed: boolean;
  enrollment_counts?: { status: string; count: number }[];
}

export interface ApiKey {
  id: number;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  created_at: string;
}
