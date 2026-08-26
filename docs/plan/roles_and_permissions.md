# Roles, permissions, and user types

Addendum to Phase 1 (which originally shipped instance-wide, unscoped API
keys). Replaces that with a listmonk-style model: every account is a
**user**, of one of two **types**, and is assigned exactly one **role** — a
named set of granular permissions.

## User types

- `user` — logs in with email + password (`POST /auth/login`).
- `api` — no email or password; authenticates with a bearer token
  (`dk_<prefix>_<secret>`, SHA-256 hashed at rest — see
  `apps/api/src/lib/apiKeys.ts`), shown to the admin exactly once, at
  creation or via `POST /users/:id/regenerate-token`. This is what used to
  be a standalone "API key" — it's now a user row, so its access is scoped
  by a role instead of being unrestricted.

## Roles

A role is `{ name, permissions: string[] }`. Permissions are
`resource:verb` strings, cataloged once in `apps/api/src/lib/permissions.ts`
and mirrored (with display labels) in `apps/web/src/lib/permissions.ts`: 9
resources (lists, subscribers, campaigns, automations, connections,
templates, bounces, users, roles), 21 permissions total. `roles.type` is
always `'user'` today but is a real column so a second `type = 'list'`
(listmonk-style per-list roles) can be added later without migrating
anything already created.

The **Super Admin** role (`id = 1`, seeded by migration
`1755820800017_roles_and_api_users.sql`) bypasses every permission check by
id — its `permissions` array is never read, and it can't be edited or
deleted. The very first account (`POST /auth/setup`) is always Super Admin,
as is every pre-existing user carried forward by the migration.

## Enforcement

`apps/api/src/auth/plugin.ts`'s `requireAuth` resolves the caller (JWT or
API token) to a full `{ id, type, role_id, permissions }`, rejecting
disabled users. `app.requirePermission("resource:verb")` is a per-route
preHandler added alongside `requireAuth` on every mutating and read route
across `lists.ts`, `subscribers.ts`, `campaigns.ts`, `connections.ts`,
`templates.ts`, `bounces.ts`, and `automations.ts`'s admin scope.

Deleting or demoting the instance's last enabled Super Admin is rejected
(`409`) to prevent locking the instance out.

## UI

**Settings → Users** and **Settings → Roles** (`apps/web/src/pages/
Settings.tsx`, tabbed), with `UserForm.tsx`/`RoleForm.tsx` for create/edit.
Full shape: [../api-reference.md](../api-reference.md#users--roles).

**Status: built & verified** (manually, against a real Postgres instance —
migration applied cleanly against pre-existing `users`/`api_keys` data, a
pre-migration API key kept authenticating unchanged post-migration, and
permission enforcement was verified end-to-end for both a scoped `user` and
a scoped `api` account).
