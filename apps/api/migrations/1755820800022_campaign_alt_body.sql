-- Optional hand-written text/plain alternative part. Null means the text part
-- is derived from the rendered HTML at send time (see lib/htmlToText.ts), which
-- is what almost every campaign wants; this column exists for the ones where
-- the automatic conversion reads badly. Sending HTML with no text part at all
-- is a standing SpamAssassin penalty (MIME_HTML_ONLY), so there is no "off".
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS alt_body TEXT;
