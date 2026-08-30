# Deliverability — message shape

Phase 7 addendum. **Built and verified.**

Three things a spam filter reads before it reads the copy: whether the message
has a plain-text part, whether its `Message-ID` looks like it came from the
sending domain, and how long its links are. Dripline got all three wrong, and
a mail-tester.com run against a real campaign is what surfaced it.

This is about the shape of the message Dripline builds. Authentication (SPF,
DKIM, DMARC alignment) belongs to whoever owns the sending domain and is
covered in [../self-hosting.md](../self-hosting.md), not here.

## 1. Every message carries a text/plain part

`SendMailInput` used to take only `html`, so every campaign and automation email
went out as a single `text/html` part. That is a standing SpamAssassin penalty
(`MIME_HTML_ONLY`) on every message an install ever sends, independent of
content.

- `lib/htmlToText.ts` derives the text part from the rendered HTML. It is
  regex-based, matching what `lib/template.ts` already does to the same input --
  the HTML here is our own rendered template output, not arbitrary web markup,
  and a full HTML parser is a disproportionate dependency for one MIME part.
- The text is derived **after** click-tracking rewrites and **before** the
  preheader div and open pixel are injected, so it carries the same
  destinations a recipient would click and none of the markup whose only job
  is to be invisible.
- `campaigns.alt_body` holds a hand-written override for the campaigns where
  the automatic conversion reads badly. Null (the default, and almost every
  campaign) means derive it. There is no "send HTML only" setting -- that
  option only ever costs deliverability.
- A `content_type: "plain"` campaign now sends a genuine `text/plain` message
  with no HTML part at all. It used to wrap the text in `<pre>` and send that
  as HTML.

Both senders implement it: nodemailer builds `multipart/alternative` from
`html` + `text`, and SES takes `Body.Text` alongside `Body.Html`.

## 2. Message-ID is ours

`sendThroughConnection` now generates `<uuid@sending-domain>` and passes it
down. Two reasons: the domain is always the From identity's rather than
whatever nodemailer inferred, and `campaign_emails.message_id` holds a value we
chose instead of one the transport echoed back -- which is what
`bounceScanner` matches DSNs against (see
[mailbox_bounce_scanning.md](mailbox_bounce_scanning.md)).

SMTP only. SES replaces a supplied Message-ID with its own unconditionally, so
`SesSender` ignores the field.

## 3. Short tracking URLs

SpamAssassin penalizes links much past 120 characters. The old shape ran to
about 260:

```
https://email.example.com/api/v1/track/click/{36-char uuid}/{36-char uuid}?url={the whole URL-encoded destination}&sig={24 hex}
```

Two uuids are 73 characters before anything else, and the destination was
carried in the query string in full. The new shape is about 55:

```
https://email.example.com/l/{campaign}/{subscriber}/{link}/{16 hex}
```

| link        | before | after |
| ----------- | -----: | ----: |
| click       |   ~260 |   ~55 |
| open pixel  |   ~130 |   ~52 |
| unsubscribe |   ~141 |   ~52 |

What changed, in `lib/trackingUrls.ts` and `lib/shortId.ts`:

- **Base62 ids instead of uuids.** A recipient can read their own subscriber
  id off their own link, which leaks roughly how large the install's list is.
  Forging one is still infeasible: the HMAC covers the whole tuple. This was a
  deliberate trade for the ~40 characters that packing the uuids would have
  cost instead.
- **A link id instead of the destination.** `links` already interned every URL;
  the click route resolves the id back to a URL rather than reading it out of
  the query string.
- **One-letter paths** (`/l/`, `/o/`, `/u/`) instead of `/api/v1/track/click/`.
  These are top-level routes, so the Vite dev proxy needs them too -- as
  anchored regexes, since a plain `/l` prefix would also swallow `/login` and
  `/lists`.
- **16 hex characters of signature** instead of 24. 64 bits of HMAC-SHA256,
  only ever attackable online against a live endpoint.
- **A kind prefix on the unsubscribe ref** (`c12` / `a3`). Campaign and
  automation unsubscribes share one page and one endpoint; the uuid form had to
  settle which it was by looking the uuid up in both tables, and this doesn't.

### Compatibility

The uuid-based `/api/v1/track/*` and `/unsubscribe/*` routes still exist and
have to keep existing -- mail carrying them can sit in an inbox indefinitely.
The React unsubscribe page is routed at both `/u/:ref/:sub/:sig` and the old
`/unsubscribe/:campaignUuid/:subscriberUuid`, and calls whichever set of
endpoints matches the link it was reached through.

### Performance

The short URLs made the hot paths cheaper, not more expensive:

- **Click**: was two SELECTs to resolve uuids to ids plus an upsert into
  `links`. Now a primary-key SELECT for the destination plus the insert.
- **Open pixel**: was two SELECTs plus the insert. Now just the insert.
- **Render**: `precomputeLinkIds` resolves a campaign's link set once per
  dispatch batch instead of re-interning every URL for every recipient. Only an
  href containing a merge field (whose value differs per recipient) still
  resolves per-send.

Recording is best-effort and wrapped: the ids come straight off the URL, so a
campaign or subscriber deleted between the send and the click would otherwise
fail the insert's foreign key, and a reader owed a redirect should never get a
500 because an analytics write didn't land.

## Status

Built and verified:

- MIME structure confirmed against a fake SMTP server -- `multipart/alternative`
  with both parts for an HTML campaign, a single `text/plain` for a plain one,
  and a `Message-ID` carrying the From address's domain.
- All four URLs a campaign embeds measured at 44-46 characters on a
  `localhost:5173` origin; ~50 on a real one.
- Short click / open / unsubscribe routes exercised over HTTP: valid signature
  records and redirects, bad signature redirects without recording, unknown
  link id 404s, unsubscribe endpoints 403 on a bad signature.

Not done:

- No `List-Unsubscribe` mailto: form (unchanged; see `connections.ts`).
- Nothing here checks the _content_ of a campaign. The invisible-text
  SpamAssassin rule that started this (`FONT_INVIS_MSGID`, triggered by a
  `color:#fff` button whose `background:` shorthand the filter didn't parse)
  is a property of what a sender writes, not of what Dripline builds. A
  pre-send content linter in the campaign editor would be the way to catch
  that class of problem, and is not started.
