-- Roles & permissions, and a user "type" split (user / api), replacing the
-- old instance-wide api_keys table with API-type user rows so tokens are
-- scoped by a role instead of granting unrestricted access.
--
-- `roles.type` is 'user' only for now, but keeps the door open for listmonk-
-- style per-list roles later (a second `type = 'list'` reusing this same
-- table) without needing to touch or migrate anything created here.
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'user',
    name TEXT NOT NULL,
    permissions TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (type, name)
);

-- The primordial Super Admin: bypasses every permission check by id (see
-- lib/permissions.ts SUPER_ADMIN_ROLE_ID), so its `permissions` array is
-- never actually read -- left empty rather than listing everything.
INSERT INTO roles (id, type, name, permissions)
    VALUES (1, 'user', 'Super Admin', '{}')
    ON CONFLICT (id) DO NOTHING;
SELECT setval('roles_id_seq', GREATEST((SELECT MAX(id) FROM roles), 1), true);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'user' CHECK (type IN ('user', 'api')),
    ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES roles(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
    ADD COLUMN IF NOT EXISTS api_key_prefix TEXT,
    ADD COLUMN IF NOT EXISTS api_key_hash TEXT,
    ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

-- Every pre-existing row (today's single admin account) becomes a Super
-- Admin so nothing loses access when this migration runs.
UPDATE users SET role_id = 1 WHERE role_id IS NULL;
ALTER TABLE users ALTER COLUMN role_id SET NOT NULL;

-- API users have no email; a user-type account still needs one, but as a
-- nullable column with a partial unique index instead of the old blanket
-- NOT NULL UNIQUE.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_api_key_prefix_unique ON users (api_key_prefix) WHERE api_key_prefix IS NOT NULL;

-- Carry forward existing API keys as Super Admin API users, reusing the same
-- prefix/hash (see lib/apiKeys.ts -- plain SHA-256 hex, unchanged) so
-- existing integrations keep authenticating with their current token,
-- unaware anything changed.
INSERT INTO users (name, type, role_id, status, api_key_prefix, api_key_hash, last_used_at, created_at, updated_at)
SELECT name, 'api', 1, 'enabled', key_prefix, key_hash, last_used_at, created_at, created_at
FROM api_keys;

DROP TABLE IF EXISTS api_keys;
