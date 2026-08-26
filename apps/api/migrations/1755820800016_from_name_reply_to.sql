-- Optional sender identity overrides.
--
-- from_name lets a campaign override only the display name while still sending
-- from the connection's authorized address, which is the common case (same
-- mailbox, different sender persona per campaign).
--
-- reply_to exists on both: a connection sets the default for everything it
-- sends, a campaign overrides it for one send. Kept separate from from_email
-- because the reply mailbox is frequently not the sending identity -- sends go
-- out from a no-reply or a provider-verified address while replies should reach
-- a human.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS from_name TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS reply_to TEXT;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS reply_to TEXT;
