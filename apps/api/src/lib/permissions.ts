/** Every granular permission a role can be given, grouped by resource.
 * Mirrors listmonk's `resource:verb` shape, sized to Dripline's actual
 * routes (see docs/plan/... roles plan) rather than a blind copy. Keep in
 * sync with the mirrored catalog in apps/web/src/lib/permissions.ts. */
export const PERMISSIONS = {
  lists: ["get", "manage"],
  subscribers: ["get", "manage", "import"],
  campaigns: ["get", "manage", "send"],
  automations: ["get", "manage"],
  connections: ["get", "manage"],
  templates: ["get", "manage"],
  media: ["get", "manage"],
  bounces: ["get", "manage", "receive"],
  users: ["get", "manage"],
  roles: ["get", "manage"],
  settings: ["get", "manage"],
} as const;

type PermissionResource = keyof typeof PERMISSIONS;
type PermissionVerb<R extends PermissionResource> = (typeof PERMISSIONS)[R][number];
export type Permission = {
  [R in PermissionResource]: `${R}:${PermissionVerb<R>}`;
}[PermissionResource];

export const ALL_PERMISSIONS: Permission[] = (
  Object.entries(PERMISSIONS) as [PermissionResource, readonly string[]][]
).flatMap(([resource, verbs]) => verbs.map((verb) => `${resource}:${verb}` as Permission));

const ALL_PERMISSIONS_SET = new Set<string>(ALL_PERMISSIONS);
export function isPermission(value: string): value is Permission {
  return ALL_PERMISSIONS_SET.has(value);
}

/** The primordial role, seeded by migration 1755820800017. Bypasses every
 * permission check by id -- its `permissions` array is never read. */
export const SUPER_ADMIN_ROLE_ID = 1;
