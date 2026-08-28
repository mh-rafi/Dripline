-- Optional inbox preview text ("preheader"): the snippet mail clients show
-- next to the subject line in the inbox list, distinct from anything in the
-- opened email. Rendered as a hidden div injected into the HTML body (see
-- injectPreheader in services/mailer.ts) rather than a mail-header field --
-- it has to be part of the body for clients to pick it up as the snippet.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS preheader TEXT;
