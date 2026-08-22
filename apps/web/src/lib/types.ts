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

export interface Provider {
  id: number;
  name: string;
  type: "smtp";
  from_email: string;
  weight: number;
  enabled: boolean;
  max_errors: number;
  error_count: number;
  disabled_reason: string | null;
  config: { host: string; port: number; secure?: boolean; username?: string; password?: string };
}

export type CampaignStatus =
  "draft" | "scheduled" | "running" | "paused" | "finished" | "cancelled";

export interface Campaign {
  id: number;
  uuid: string;
  name: string;
  subject: string;
  body: string;
  status: CampaignStatus;
  from_email: string | null;
  template_id: number | null;
  messages_per_minute: number;
  to_send: number;
  sent: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  lists?: { id: number; name: string }[];
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
