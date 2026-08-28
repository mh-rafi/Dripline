-- Self-service password management: a change-password form on the account
-- page and an emailed reset link for people locked out of one.

-- Bumped whenever a password changes (account page or reset). Any JWT issued
-- before this instant is refused by the auth plugin, so a reset actually
-- evicts whoever was holding a stolen session -- otherwise the 30-day tokens
-- would outlive the credential they were minted from. NULL means "never
-- changed", which is every account predating this migration.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

-- Only the SHA-256 of the token is stored: the plaintext exists solely in the
-- emailed link, so a leaked database can't be used to mint a session.
CREATE TABLE password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens (user_id, created_at DESC);
CREATE INDEX idx_password_reset_tokens_expires ON password_reset_tokens (expires_at);
