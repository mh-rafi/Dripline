# Mailbox-scan bounce detection (IMAP)

**Status:** built. Not yet verified against a real IMAP mailbox with real
DSN-format bounce messages (§8 step 3) or clicked through in the browser
(§8 step 4) -- code review + `npm run build/lint/format` only so far. Two
corrections made during implementation:

1. §3.2/§6 originally said `use_sending_credentials` could skip host/port
   entirely; it can't (see the corrected note in §3.2) -- only
   username/password are ever reused.
2. §2.3/§3.2 originally used `bounce_config.username` directly as the
   outgoing envelope-from (Return-Path). That's wrong in general: an IMAP
   login isn't always a real email address (shared/cPanel Dovecot setups
   and older on-prem Exchange commonly authenticate with a bare local-part
   or SAM account name, not the full address) -- using it as `MAIL FROM`
   would be invalid on any provider where that's the case. Added a distinct
   `bounce_config.email` field, used only for the envelope-from override;
   `username`/`password` remain IMAP-login-only. Required whenever
   `use_sending_credentials` is false, alongside username/password.

**Depends on:** Phase 3 (connections) and the already-built webhook bounce
path (`POST /api/v1/bounces`, `services/bounces.ts::recordBounce`) — this
plan adds a second _ingestion_ path into that same `recordBounce()`, it does
not change bounce storage, thresholding, or auto-blocklisting at all.

## 0. Why this exists

`docs/plan/phases/07-hardening.md` has carried this note since Phase 7:

> I tried listmonk's bounce handler using POP polling, but the mailbox
> crashes after a few minutes. My mailbox has thousands of emails, I think
> that's why listmonk crashes. We need to implement it in a way that won't
> crash.

The reporter's actual setup, which this plan designs around directly rather
than abstractly: Titan Mail, one mailbox used both as the campaign's SMTP
sending identity _and_ as where bounces land (Titan has no separate bounce
mailbox concept — a bounce is just a normal email Titan drops in the same
inbox). That inbox also receives everything else the business gets (Titan
forwards it to a support-portal system, which is what actually reads it —
the mailbox itself sits with thousands of messages left permanently unread).
Any scanner that works by listing/fetching "the whole mailbox" or "everything
unread" scales with that unrelated backlog, not with the bounce volume it
actually cares about, which is the shape of the crash.

## 1. Config level: per-connection, not global

A single global bounce-scan setting implicitly assumes one mailbox for the
whole install. That assumption breaks as soon as more than one sending
domain is in use — which this codebase already expects (see
`docs/prd/PRD.md` §6.3 and `services/connections.ts`'s connection-chain
model): each `connections` row is one sending identity with its own
host/credentials, and bounces for mail sent through a given connection land
in _that_ connection's own mailbox, not some shared one. This also matches
the existing precedent of `list_unsubscribe_header` and the rate-limit
fields, both per-connection rather than global, for the same reason.

So: bounce-mailbox config and its enable/disable toggle live on
`connections`, alongside the existing sending config. A connection with it
off is simply never scanned; nothing else changes for it.

## 2. Correlation strategy: Message-ID first, address-regex fallback

Two ways to tie an inbound bounce message back to a subscriber (and
ideally a campaign), from most to least precise:

1. **Outgoing Message-ID match (primary).** When Dripline sends a campaign
   email, capture the `Message-ID` the sender actually used and store it
   against that `campaign_emails` row (see §3). A real bounce (a DSN per RFC
   3464, which is what any competent MTA — including whatever bounced back
   to Titan — generates) almost always echoes the original message either
   as a `message/rfc822` sub-part or via an `Original-Message-ID`-style DSN
   field. Extract that Message-ID from the inbound bounce and look up the
   exact `campaign_emails` row it belongs to — exact subscriber _and_
   campaign attribution, no envelope trickery required, and it works
   through a completely vanilla mailbox (no plus-addressing, no custom
   Return-Path routing, nothing Titan or any other provider needs to
   specially support).
2. **Recipient-address fallback.** Not every bounce is a clean DSN (real
   mail is messy) — if no Message-ID can be extracted or matched, fall back
   to pulling the failed recipient's address out of the DSN's
   `Final-Recipient`/`Original-Recipient` field, or failing that a regex
   over the body, and match that address directly against `subscribers.
email`. This loses campaign attribution (`recordBounce` gets
   `campaignId: null`, which the schema already allows) but still lets the
   subscriber get flagged/blocklisted, which is the part that actually
   matters operationally.

**Explicit non-goal:** _dynamic, per-message_ VERP addressing (encoding the
specific subscriber/campaign into the envelope-from for every single send,
so each bounce is self-addressed with its own identity baked in) is a
legitimate technique and would make attribution airtight, but it requires
the receiving mailbox to route arbitrary `bounce+<id>@domain` addresses back
to an inbox we scan — not something every provider can be assumed to
support. Message-ID matching (§2.1) gets most of the same attribution
benefit with zero mailbox-side requirements, so per-message VERP isn't part
of this plan. A much simpler, genuinely useful relative of it _is_ in scope
— see §2.3.

**Also explicitly out of scope:** workflow-triggered emails (`services/
workflows.ts`'s `send_email` step) have no per-send log row anywhere
(unlike campaigns' `campaign_emails`), so there's nothing to attach a
Message-ID to for them. A bounce from a workflow send can only ever hit the
address-fallback path (subscriber-level, no workflow attribution). Building
a workflow-send log just for this is real new infrastructure and isn't
justified by this request alone — flag separately if it's actually wanted.

### 2.3 Routing bounces to a dedicated mailbox: static Return-Path override

Some providers (Titan among them) simply bounce back to whatever mailbox
sent the message — no configuration needed, that mailbox _is_ the bounce
mailbox, which is the case §3.2/§5 already handle via
`use_sending_credentials`. Other setups want bounces to land in a
genuinely separate mailbox (a different domain, a different provider
entirely, or just a dedicated `bounces@` address instead of the noisy
shared inbox a real business address usually is). That requires actually
telling receiving mail servers to send DSNs somewhere else, which is a
**Return-Path (SMTP envelope `MAIL FROM`) override, not a custom message
header** — worth stating plainly since it's an easy mix-up: an arbitrary
header like `X-Custom: value` (the kind of thing listmonk's own "custom
headers" field adds) travels with the message but has no bearing on where
a bounce goes; only the invisible envelope sender does.

Concretely: nodemailer's `sendMail()` accepts an `envelope: { from, to }`
option that sets the actual `MAIL FROM` SMTP command independently of the
visible `From:` header. When a connection's `bounce_config` points at a
separate mailbox (`use_sending_credentials: false`), `SmtpSender.send()`
should set `envelope.from` to that mailbox's address on every send through
this connection. **Corrected during implementation:** this address is a
distinct `bounce_config.email` field, not `bounce_config.username` -- an
IMAP login isn't always a real email address (see §3.2's corrected note),
so the two can't be conflated.

**This is not an independent toggle** — it's implied by, and only makes
sense together with, having configured a separate bounce mailbox at all.
If a distinct `bounce_config` mailbox is set but the envelope-from is left
alone, bounces keep going to the sending address and the configured mailbox
just sits empty forever, silently doing nothing. Tie the two together in
code (one boolean drives both "which mailbox do I scan" and "what envelope
sender do I stamp on outgoing mail") rather than exposing them as two
settings that could disagree. SES connections are unaffected by this
entirely — SES's own bounce/complaint reporting already goes through the
already-built webhook/SNS path, not this mailbox-scan feature at all.

**Real limitation, not just a footnote:** not every SMTP provider honors an
arbitrary envelope-from. Some authenticated relays require `MAIL FROM` to
match the authenticated account and will reject the send outright, or
silently rewrite the envelope back to the account's own address, in which
case the configured bounce mailbox still receives nothing — and there's no
reliable way to detect this ahead of time from a "test connection" check
(reachability/auth succeeding says nothing about whether a live send's
envelope-from actually survives to the far end). Say this explicitly in the
UI copy next to the setting, and suggest the only real verification is
sending a test message to a deliberately invalid address and confirming the
resulting bounce actually lands in the configured mailbox.

## 3. Schema changes

### 3.1 `campaign_emails.message_id`

```sql
ALTER TABLE campaign_emails ADD COLUMN IF NOT EXISTS message_id TEXT;
CREATE INDEX IF NOT EXISTS idx_campaign_emails_message_id ON campaign_emails(message_id)
  WHERE message_id IS NOT NULL;
```

Populate it at send time. `ConnectionSender.send()` (`services/
connections.ts`) currently returns `Promise<void>`; change it to
`Promise<{ messageId: string | null }>`:

- `SmtpSender`: nodemailer's `sendMail()` resolves with `info.messageId` —
  return it as-is (nodemailer generates one automatically if the caller
  doesn't set a `Message-Id` header).
- `SesSender`: `SendEmailCommand`'s response includes a `MessageId` field
  (a bare ID, not RFC 2822 angle-bracket form) — return it; note the format
  difference in a comment since it changes what a DSN's echoed Message-ID
  will look like for SES sends specifically.

Thread this through `SendResult` (`{ ok, connectionId, error, messageId }`)
in both `sendThroughConnection` and `sendWithChain`, and store it in
`jobs/campaignDispatch.ts`'s existing `campaign_emails` update (the one that
already sets `status`/`connection_id`/`sent_at` after `sendWithChain`
resolves) — one extra field on an update that's already happening, not a
new write path.

### 3.2 Per-connection bounce-mailbox config

```sql
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bounce_config JSONB;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bounce_last_uid INTEGER;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS bounce_last_uidvalidity BIGINT;
```

`bounce_config` (nullable = scanning off; mirrors how the existing `config`
column already holds provider-shaped JSON):

```ts
interface BounceMailboxConfig {
  enabled: boolean;
  // IMAP only -- see §7 for why POP isn't offered.
  host: string;
  port: number;
  tls: boolean;
  username: string;
  password: string;
  // CORRECTED during implementation: a distinct field from `username` --
  // an IMAP login isn't always a real email address (shared/cPanel Dovecot
  // setups, older on-prem Exchange). Only meaningful/required when
  // use_sending_credentials is false; drives the envelope-from override
  // (§2.3), never used for IMAP auth.
  email: string;
  // CORRECTED during implementation: when true and this connection's own
  // type is "smtp", only username/password are ignored in favor of the
  // connection's own sending login -- host/port are ALWAYS required here
  // regardless. A provider's SMTP submission host and its IMAP host are
  // almost never the same hostname even for the same mailbox (e.g.
  // smtp.yourmailserver.com vs imap.yourmailserver.com), so this can only
  // ever mean reusing the login, never the server address. Always false/unavailable
  // for "ses" connections, which have no mailbox login of their own to
  // reuse.
  use_sending_credentials: boolean;
  folder: string; // default "INBOX"
  // Hard safety bound, independent of the UID cursor below -- this is the
  // direct answer to "scan only emails 2 days old": every scan's IMAP
  // SEARCH is bounded by SINCE(now - max_age_days), so even a lost/reset
  // cursor or a first-ever run against a mailbox with years of history
  // can't turn into an unbounded scan. Default 7.
  max_age_days: number;
  // Upper bound on messages fetched in one scan tick. Default 200 -- a
  // backlog larger than this is worked off over several ticks (see §5),
  // not all in one go.
  max_messages_per_scan: number;
}
```

`bounce_last_uid`/`bounce_last_uidvalidity` are scanner-owned state, not
user-editable config — same pattern as `window_start`/`window_count`
already on this table for rate limiting. `UIDVALIDITY` is IMAP's own
mechanism for telling a client "the UID numbering you remember is no longer
valid" (e.g. the mailbox was recreated); the scanner must detect a mismatch
against the stored value and fall back to a fresh `SINCE`-only search
(§5) rather than trusting a stale `bounce_last_uid`.

`password` is masked in API responses exactly like `config.password`
already is (`docs/api-reference.md`'s existing note) — same treatment, same
place in the route handler.

## 4. New job: scheduled IMAP scan

Follows the exact shape of `jobs/campaignDispatch.ts`'s scan/dispatch split
(`registerCampaignScanWorker` + `scheduleCampaignScan`) and reuses `jobs/
boss.ts`'s `QUEUES` pattern:

```ts
// boss.ts
BOUNCE_SCAN: "bounce.scan",
BOUNCE_SCAN_CONNECTION: "bounce.scan-connection",
```

- `scheduleBounceScan(boss)`: `boss.schedule(QUEUES.BOUNCE_SCAN, "*/5 * * * *")`
  — every 5 minutes. Not per-connection configurable; one fixed cadence for
  all connections keeps this simple and is frequent enough for bounce
  handling's actual latency requirements (nothing here is time-critical to
  the minute).
- `registerBounceScanWorker`: on each tick, `SELECT id FROM connections
WHERE bounce_config->>'enabled' = 'true' AND enabled = true`, and enqueue
  one `BOUNCE_SCAN_CONNECTION` job per connection id, `singletonKey:
`bounce-scan-${connectionId}`` — so a slow scan of one mailbox can never
  overlap with the next tick's job for the _same_ connection (mirrors
  campaign dispatch's per-campaign singleton key exactly), while different
  connections still scan concurrently.
- `registerBounceScanConnectionWorker`: does the actual IMAP work, §5.

## 5. The scan algorithm (one connection, one job run)

Library: [`imapflow`](https://www.npmjs.com/package/imapflow) (modern,
promise-based, first-class `SEARCH`/UID support) for the IMAP client, and
[`mailparser`](https://www.npmjs.com/package/mailparser) (nodemailer's
sibling project) to parse fetched raw messages into headers/parts. Add both
as new dependencies (`apps/api/package.json`).

1. Resolve the effective login: host/port/tls always from `bounce_config`
   itself; username/password from `bounce_config` unless
   `use_sending_credentials`, in which case from this connection's sending
   `config` instead.
2. Connect, `SELECT` the configured folder.
3. Check the mailbox's current `UIDVALIDITY` against `bounce_last_uidvalidity`:
   - **Mismatch (or no stored cursor — first run for this connection):**
     search by date only — `SEARCH SINCE <now - max_age_days>` — and if more
     than `max_messages_per_scan` UIDs match, take only the
     `max_messages_per_scan` **most recent** (a first-ever run against a
     mailbox with a large backlog works off the tail across several ticks,
     it does not try to process years of history in one shot). Store the
     fresh `UIDVALIDITY`.
   - **Match:** `UID SEARCH UID <bounce_last_uid + 1>:* SINCE <now -
max_age_days>` — only genuinely new mail, server-side filtered, no
     listing/fetching of anything already processed. This is the fix for
     the actual crash: the mailbox's thousands of unrelated old/unread
     messages are never touched at all, every scan after the first is
     bounded by "how much _new_ mail arrived since 5 minutes ago," which
     for a bounce-only signal is normally a handful of messages.
4. Cap the candidate UID list to `max_messages_per_scan` (oldest-first, so a
   burst doesn't starve older unprocessed mail across ticks).
5. Fetch each candidate in small chunks (e.g. 20 at a time) using
   `BODY.PEEK[]` specifically — `PEEK` means the fetch does **not** set the
   `\Seen` flag. This mailbox is also used for other things (Titan →
   support-portal forwarding in the reporter's case); the scanner must not
   change read/unread state or move/delete anything. No "mark as processed"
   IMAP-side bookkeeping at all — the persisted UID cursor (§3.2) is the
   only processed/unprocessed record, kept entirely on our side.
6. Parse each fetched message with `mailparser`. Classify:
   - Not a DSN-shaped message (no `multipart/report`, no `Content-Type:
message/delivery-status` part, doesn't look like a bounce) → skip, not
     an error. This is what keeps the "thousands of forwarded support
     emails sitting in the same inbox" cheap to ignore — most of them won't
     even be in the UID range at all (§5.3 step already excludes anything
     older than the cursor/date bound), and whatever's left that isn't a
     bounce is discarded after a cheap parse, never written anywhere.
   - DSN-shaped → extract `Action`/`Status` (5.x.x → `hard`, 4.x.x →
     `soft`) and the original Message-ID (§2.1) or, failing that, the
     failed recipient address (§2.2).
7. For each classified bounce, resolve subscriber/campaign per §2 and call
   the existing `recordBounce()` — no changes needed there, it already
   accepts `campaignId: null`.
8. Advance and persist `bounce_last_uid` (highest UID actually processed
   this run, even if the run stopped early due to `max_messages_per_scan`)
   **after each chunk**, not only at the end — so a crash or restart
   mid-scan resumes from where it left off instead of reprocessing a chunk
   already handled.
9. Close the IMAP connection. Any connection error/auth failure: log it and
   feed into the same `error_count`/auto-disable path
   `recordConnectionResult` already uses for sending failures, or a
   parallel `bounce_error_count` — implementer's call, but don't let a
   broken IMAP login retry-storm every 5 minutes forever without surfacing
   in the admin UI the way sending failures already do.

## 6. Frontend: Connections page

A "Bounce mailbox" section on the connection edit form (`apps/web/src/pages/
Connections.tsx`), same visual pattern as the existing "Send List-Unsubscribe
header" `Switch` block:

- Enable toggle.
- Host/port/TLS fields are always shown and always required when enabled --
  **corrected during implementation**: the IMAP host is never safely
  derivable from the SMTP sending config (different hostname almost every
  time), so there's no config where these can be hidden.
- For `type: "smtp"` connections only: a "Use this connection's own sending
  login" checkbox (default on) — when checked, hides only the
  username/password fields (reused from the sending config). When
  unchecked (or always, for `type: "ses"` connections, which have no
  sending mailbox login to reuse), show username/password fields too.
- Folder (default `INBOX`), max age in days (default 7), max messages per
  scan (default 200) — plain number/text inputs, no need for anything
  fancier.
- A "Test connection" button mirroring the existing SMTP test-connection UX
  (imapflow's `connect()` + a no-op `NOOP`/select is enough to verify
  reachability+auth without touching any mail).
- When the "use own sending credentials" box is _unchecked_ (a genuinely
  separate mailbox), show a persistent note per §2.3's real limitation:
  bounces will only actually arrive here if this connection's outgoing SMTP
  provider honors a custom envelope-from -- not guaranteed for every
  provider, and not something "Test connection" can verify. Recommend
  sending a test to an invalid address and confirming the bounce lands in
  this mailbox.

`docs/api-reference.md`'s Connections section gets a paragraph documenting
`bounce_config`'s shape and masking, matching how `list_unsubscribe_header`
is already documented there.

## 7. Non-goals

- **No POP3 support.** POP has no server-side `SEARCH` — a POP client can
  only list _all_ messages by sequence number/UIDL and fetch headers to
  figure out what's new, which is exactly the "scale with total mailbox
  size, not with new-bounce volume" shape that caused the original crash.
  IMAP's `SEARCH SINCE`/`UID SEARCH` do that filtering server-side. If a
  connection's provider genuinely only offers POP, bounce scanning simply
  isn't available for it in this plan — that's a real limitation worth
  stating plainly rather than half-supporting POP and reintroducing the
  same crash shape for anyone who picks it.
- **No VERP/plus-addressing.** See §2's explicit non-goal note.
- **No workflow-send bounce attribution.** See §2's explicit non-goal note.
- **No mailbox mutation beyond reading.** No flagging, moving, or deleting
  processed messages — see §5 step 5. The persisted UID cursor is the only
  state this feature owns.
- **No per-connection scan schedule.** One fixed 5-minute cadence for every
  enabled connection (§4) — not user-configurable per connection.
- **Existing webhook bounce path is untouched.** This is purely a second,
  independent ingestion path into the same `recordBounce()` — AWS SES/
  Resend webhook handlers mentioned in the Phase 7 doc are still a separate,
  later addition, not part of this plan.

## 8. Sequencing

1. **Message-ID capture (§3.1), in isolation first.** Schema migration +
   `ConnectionSender`/`SendResult` change + `campaignDispatch.ts` update.
   Verify against a real send (Docker Postgres + a real or local-test SMTP
   target) that `campaign_emails.message_id` is actually populated before
   building anything that depends on reading it back.
2. **Connection schema + masked API surface (§3.2)** — migration, route
   changes, masking, `docs/api-reference.md` update. Verify via direct API
   calls that `bounce_config.password` round-trips masked, matching the
   existing `config.password` behavior.
3. **The scan job (§4/§5), tested against a real IMAP mailbox** — seed it
   with a handful of real or hand-crafted DSN-format bounce messages plus a
   large body of unrelated mail (to actually exercise the "doesn't scale
   with total mailbox size" property this plan exists to deliver, not just
   "works on an empty test inbox"). Confirm: only new-since-cursor messages
   get fetched on the second run of a two-run test, `\Seen` is never set,
   `max_messages_per_scan`/`max_age_days` are actually respected, a
   `UIDVALIDITY` change is handled without crashing.
4. **Frontend (§6).** Click through: enable/disable, "use sending
   credentials" toggle behavior for both smtp and ses connection types,
   test-connection button, masked password persists correctly across edits.
5. **Full click-through**, dark/light/system theme, `npm run build && npm
run lint && npm run format` clean.

## 9. Acceptance criteria

- [ ] `campaign_emails.message_id` populated on every real send (SMTP and
      SES), threaded through `SendResult` rather than fetched separately.
- [ ] A connection's bounce config is off by default; enabling it is
      per-connection, has zero effect on any other connection.
- [ ] Second and later scan ticks against the same mailbox only fetch UIDs
      newer than the persisted cursor — verified by seeding a mailbox with
      a large pre-existing backlog and confirming the second run's IMAP
      traffic doesn't touch it.
- [ ] `max_age_days` and `max_messages_per_scan` are both actually enforced
      (test with each set to a small value against a mailbox exceeding it).
- [ ] No message is ever marked `\Seen`, moved, or deleted by the scanner.
- [ ] A message-ID match produces a bounce with the correct `campaign_id`;
      an unmatched-but-DSN-shaped message falls back to address matching
      with `campaign_id: null`; a non-DSN message is silently skipped.
- [ ] A `UIDVALIDITY` change is detected and handled (fresh `SINCE` search,
      no crash, no exception surfaced to the job runner as a failure).
- [ ] `bounce_config.password` is masked in every API response that returns
      a connection, matching the existing `config.password` treatment.
- [ ] With a separate bounce mailbox configured (`use_sending_credentials:
false`) on an `smtp` connection, outgoing sends through it carry an
      `envelope.from` matching `bounce_config.email` (not `username`); with
      it `true` (or
      bounce scanning off entirely), outgoing sends are byte-for-byte
      unaffected by this feature (no envelope override applied at all).
- [ ] `npm run build`, `npm run lint`, `npm run format` all clean.
- [ ] `docs/api-reference.md` and `docs/plan/phases/07-hardening.md` updated
      to reflect this landing (the hardening doc's bounce bullet currently
      says mailbox-scan detection is "still open" — update it once this is
      built, not before).
