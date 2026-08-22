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

export type ProviderType = "smtp";

export interface SmtpProviderConfig {
  host: string;
  port: number;
  secure?: boolean;
  username?: string;
  password?: string;
}

export interface ProvidersTable {
  id: Generated<number>;
  name: string;
  type: Generated<ProviderType>;
  config: SmtpProviderConfig;
  from_email: string;
  weight: Generated<number>;
  enabled: Generated<boolean>;
  max_errors: Generated<number>;
  error_count: Generated<number>;
  disabled_reason: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export type CampaignStatus =
  "draft" | "scheduled" | "running" | "paused" | "finished" | "cancelled";

export interface CampaignsTable {
  id: Generated<number>;
  uuid: Generated<string>;
  name: string;
  subject: string;
  from_email: string | null;
  template_id: number | null;
  body: Generated<string>;
  status: Generated<CampaignStatus>;
  send_at: Timestamp | null;
  messages_per_minute: Generated<number>;
  max_send_errors: Generated<number>;
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
  provider_id: number | null;
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
  providers: ProvidersTable;
  campaigns: CampaignsTable;
  campaign_lists: CampaignListsTable;
  campaign_emails: CampaignEmailsTable;
  campaign_views: CampaignViewsTable;
  links: LinksTable;
  link_clicks: LinkClicksTable;
  workflows: WorkflowsTable;
  workflow_enrollments: WorkflowEnrollmentsTable;
  workflow_events: WorkflowEventsTable;
  bounces: BouncesTable;
}
