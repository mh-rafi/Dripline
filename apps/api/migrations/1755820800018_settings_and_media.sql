-- Instance settings (key/value groups, one row per group -- 'media' is the
-- first) and the media library backing the file uploader.

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_settings_updated_at BEFORE UPDATE ON settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE media (
    id SERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    -- Which store the object actually lives in. Only 's3' exists today; a
    -- filesystem provider is planned, and rows have to stay attributable to
    -- the store that holds them once both can be configured.
    provider TEXT NOT NULL DEFAULT 's3',
    -- The object key inside the bucket, minus the configured bucket path
    -- prefix -- so changing that prefix doesn't orphan every existing row.
    filename TEXT NOT NULL UNIQUE,
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size BIGINT NOT NULL DEFAULT 0,
    meta JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_media_created_at ON media (created_at DESC);
