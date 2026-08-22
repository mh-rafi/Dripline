-- Campaign body editing modes, matching listmonk's model: richtext, html,
-- markdown, plain, visual. `body` always holds the final HTML actually sent
-- (already true for richtext/html/visual; markdown is converted to HTML at
-- dispatch time, once per batch, not per recipient). `body_source` holds the
-- original editor source needed to resume editing (markdown text, the visual
-- builder's JSON design, or a mirror of `body` for richtext/html/plain where
-- there's no separate source representation).

ALTER TABLE campaigns ADD COLUMN content_type TEXT NOT NULL DEFAULT 'richtext'
    CHECK (content_type IN ('richtext', 'html', 'plain', 'markdown', 'visual'));
ALTER TABLE campaigns ADD COLUMN body_source TEXT;
