-- Tags move out of `attribs` into their own column.
--
-- They lived at `attribs.tags` purely as a convenience, and that coupling was
-- a footgun: `attribs` is the free-form object every integration writes, so
-- any whole-object write silently untagged the contact. A real column also
-- makes tags filterable, which they never were while buried in JSONB.
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- Backfill, then drop the key. Only string elements survive: `attribs` was
-- free-form, so a hand-edited `tags` could hold anything, and a non-string
-- was never a usable tag in the first place.
UPDATE subscribers
SET
    tags = COALESCE(
        (
            SELECT array_agg(element #>> '{}')
            FROM jsonb_array_elements(attribs -> 'tags') AS element
            WHERE jsonb_typeof(element) = 'string'
        ),
        '{}'
    ),
    attribs = attribs - 'tags'
WHERE jsonb_typeof(attribs -> 'tags') = 'array';

-- A contact whose `attribs.tags` was not an array still has to lose the key,
-- or it would keep round-tripping through exports as a phantom attribute.
UPDATE subscribers
SET attribs = attribs - 'tags'
WHERE attribs ? 'tags';

CREATE INDEX IF NOT EXISTS idx_subscribers_tags ON subscribers USING GIN (tags);

-- `jsonb_path_ops` rather than the default operator class: it indexes only
-- the containment operator (`@>`), which is exactly what the attribute
-- filter exposes, and does it in a smaller index. Key-existence queries
-- (`?`) are not supported by this class -- add a second index if the filter
-- ever grows them.
CREATE INDEX IF NOT EXISTS idx_subscribers_attribs ON subscribers USING GIN (attribs jsonb_path_ops);
