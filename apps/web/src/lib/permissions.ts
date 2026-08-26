/** Mirrors apps/api/src/lib/permissions.ts -- keep the resource/verb pairs in
 * sync with the backend catalog. Labels here are display-only. */
export interface PermissionCategory {
  resource: string;
  label: string;
  permissions: { value: string; label: string }[];
}

export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    resource: "lists",
    label: "Lists",
    permissions: [
      { value: "lists:get", label: "View lists" },
      { value: "lists:manage", label: "Create, edit, and delete lists" },
    ],
  },
  {
    resource: "subscribers",
    label: "Subscribers",
    permissions: [
      { value: "subscribers:get", label: "View subscribers" },
      { value: "subscribers:manage", label: "Add, edit, and delete subscribers" },
      { value: "subscribers:import", label: "Import subscribers" },
    ],
  },
  {
    resource: "campaigns",
    label: "Campaigns",
    permissions: [
      { value: "campaigns:get", label: "View campaigns and analytics" },
      { value: "campaigns:manage", label: "Create, edit, and delete campaigns" },
      { value: "campaigns:send", label: "Start, pause, and cancel campaigns" },
    ],
  },
  {
    resource: "automations",
    label: "Automations",
    permissions: [
      { value: "automations:get", label: "View automations" },
      { value: "automations:manage", label: "Create, edit, and delete automations" },
    ],
  },
  {
    resource: "connections",
    label: "Sending connections",
    permissions: [
      { value: "connections:get", label: "View sending connections" },
      { value: "connections:manage", label: "Create, edit, and delete sending connections" },
    ],
  },
  {
    resource: "templates",
    label: "Templates",
    permissions: [
      { value: "templates:get", label: "View templates" },
      { value: "templates:manage", label: "Create, edit, and delete templates" },
    ],
  },
  {
    resource: "bounces",
    label: "Bounces",
    permissions: [
      { value: "bounces:get", label: "View bounces" },
      { value: "bounces:manage", label: "Process bounces" },
      { value: "bounces:receive", label: "Submit bounce webhook events" },
    ],
  },
  {
    resource: "users",
    label: "Users",
    permissions: [
      { value: "users:get", label: "View users" },
      { value: "users:manage", label: "Create, edit, and delete users" },
    ],
  },
  {
    resource: "roles",
    label: "Roles",
    permissions: [
      { value: "roles:get", label: "View roles" },
      { value: "roles:manage", label: "Create, edit, and delete roles" },
    ],
  },
];
