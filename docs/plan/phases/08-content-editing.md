# Phase 8 — Campaign body editing modes

**Goal:** match listmonk's 5 body-editing formats -- richtext, raw HTML, markdown, plain
text, visual (drag-and-drop) -- instead of a single plain HTML textarea.

## Research (listmonk's actual implementation)

- Data model: `campaigns.content_type` enum + `body` (always final HTML, converted from
  markdown at compile/send time) + `body_source` (original editor source -- markdown text,
  visual builder JSON, or a mirror of `body`).
- Richtext: TinyMCE (self-hosted, GPL).
- Visual: a vendored **usewaypoint/email-builder-js** (React + MUI) embedded via
  iframe + UMD bridge, since listmonk's admin is Vue.
- Markdown → HTML: Go's `yuin/goldmark`, converted once per campaign at compile time
  (before merge-field substitution, so `{{ .Subscriber.Name }}` survives).

## Decisions

- **Matched listmonk's data model exactly** (`content_type`, `body`, `body_source`).
- **Richtext:** same choice as listmonk -- TinyMCE, self-hosted (`licenseKey: "gpl"`),
  bundled directly via Vite (no Vue/React mismatch to work around here).
- **Visual:** GrapesJS + `grapesjs-preset-newsletter` instead of email-builder-js --
  framework-agnostic (plain div mount, no React/MUI dependency), MIT-licensed,
  purpose-built for email. Avoids pulling MUI+emotion+zustand into an otherwise
  framework-light project.
- **Markdown conversion happens server-side, once per dispatch batch**, not per-recipient
  (`lib/markdown.ts`, `marked`) -- mirrors listmonk's timing. The `body` column holds _raw
  markdown source_ for markdown campaigns, not pre-converted HTML, so the client-side
  preview and the server-side send-time conversion start from the same source.
- **Plain text isn't a genuine `text/plain` MIME part** -- `ConnectionSender` only carries
  `html`; plain content is escaped and wrapped in `<pre>`. A true multipart part is a
  reasonable later improvement, scoped out to avoid restructuring the sender interface.
- **Heavy editors are lazy-loaded** (`React.lazy`/`Suspense` per editor in
  `ContentTypeEditor.tsx`) so a session using one mode doesn't download the other four.
  Confirmed via build output: main chunk ~79KB gzip; TinyMCE/GrapesJS split into their own
  ~1.2–1.5MB chunks loaded on demand.

## What was built

Migration `1755820800008`: `campaigns.content_type` + `body_source`. Backend accepts both
on create/update (Zod 5-value enum); markdown-to-HTML wired into dispatch; plain-text
escaping in `mailer.ts`. Frontend: `components/content-editor/` --
`ContentTypeEditor.tsx` (switcher + lazy-loading), `RichTextEditor.tsx` (TinyMCE),
`HtmlEditor.tsx`/`MarkdownEditor.tsx` (CodeMirror, markdown pairs with a live `marked`
preview), `PlainTextEditor.tsx` (eager), `VisualEditor.tsx` (GrapesJS, imperative mount).
Wired into `CampaignNew.tsx`/`CampaignDetail.tsx`.

**Status: built and verified in a browser.** All 5 modes driven in a real session: TinyMCE
full toolbar, both CodeMirror modes with syntax highlighting, markdown preview renders
live with merge fields surviving conversion, plain text preserves literal `<`/`>`/`&`,
GrapesJS renders its block library and `getHtml()`/`getCss()` produce valid output. Zero
console errors. A markdown campaign round-tripped correctly through the real API (raw
markdown stored, not pre-converted HTML).

Not yet exercised: an actual send of a **visual** campaign to a real inbox; any content
type through the _real dispatch job_ specifically (only richtext has been, via the Phase 2
E2E test, which predates this phase).

**Depends on:** Phase 2 (dispatch); Phase 3 (`mailer.ts` sits alongside connection-sending).

---

## 8.1 Send test email (2026-08-22)

An email field + button on both campaign pages, matching listmonk's `POST
/api/campaigns/:id/test`. `POST /campaigns/:id/test` uses the campaign's _saved_
connection chain but whatever body/subject/content_type overrides are passed in, so a test
validates in-progress unsaved edits. Not part of the dispatch pipeline (no `campaign_emails`
row, doesn't count toward `to_send`/`sent`), but still goes through the connection's real
rate limit. Recipient need not be an existing subscriber -- a synthetic stand-in is used
for merge fields if not. New-campaign page silently creates the draft first (tracked via
`createdId` so repeat tests/the eventual submit update the same row).

**Status: verified end-to-end** against real Postgres + Mailpit: overrides don't leak into
the saved campaign row; received email reflects overrides with merge fields substituted;
markdown content correctly converts to real HTML rather than literal markdown syntax.

## 8.2 Cross-format content-type switching (2026-08-23)

**Bug:** switching content type unconditionally reset `{ body: "", body_source: null }` --
even richtext ↔ HTML, which share the same underlying HTML and need no conversion, wiped
the campaign every time.

**Fixed:** `lib/contentConversion.ts`'s `convertContent(from, to, value)` routes through
HTML as the common intermediate. richtext ↔ html is a direct passthrough; markdown → HTML
via `marked`; HTML → markdown via a new `turndown` dependency. Plain/visual are still lossy
targets but no longer wipe to blank -- plain strips HTML to visible text, visual hands the
current HTML to GrapesJS as `initialHtml`. `ContentTypeEditor.tsx` now owns the switch and
shows a `confirm()` dialog before a lossy conversion.

**Status: verified in a real browser** -- bold text survived a richtext → markdown →
richtext round trip; the confirm dialog correctly blocks on cancel and allows on accept.

## 8.3 List-Unsubscribe header + styled template default (2026-08-23)

Prompted by inspecting a real newsletter's headers/HTML: no `List-Unsubscribe` header, and
no styled default template.

- New `connections.list_unsubscribe_header` (boolean, default `true`) -- **per-connection,
  not global or per-campaign**: connections already model distinct sending
  domains/identities (Phase 3), and the header is about which sending identity is making
  the claim. URL form only (`List-Unsubscribe: <url>` +
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click`) -- no `mailto:` form, since that
  needs mailbox-processing infrastructure this project doesn't have. Wired into campaign
  dispatch, test sends, and workflow `send_email`.
- Styled default template needed **no schema change** -- `templates.body` already
  supports arbitrary CSS around `{{ Body }}`. Replaced the bare `<div>{{ Body }}</div>`
  default with a real starting point (headings, orange links, `<hr>`, blockquote), and
  swapped the template editor's plain `<textarea>` for the same `HtmlEditor` (CodeMirror)
  campaigns use.

**Status: verified against real Postgres + Mailpit.** Two connections (header on/off) each
sent a test campaign; Mailpit confirmed the "on" connection had a correctly-populated
header and the "off" one had neither; Mailpit's UI independently surfaced an "Unsubscribe"
link, proving it was recognized as such by a real client.

## 8.4 Preview button (2026-08-23)

A "Preview" button on campaign add/edit and the template editor. `POST /campaigns/preview`
takes `{ subject?, body, body_source?, content_type?, template_id? }` directly (no
campaign id or connection needed) and renders via the same `renderCampaignEmail` path a
real send uses, against a synthetic subscriber -- works for a never-saved draft, unlike
`/campaigns/:id/test`. `POST /templates/preview` substitutes sample content for
`{{ Body }}`. Frontend: `PreviewModal` renders the HTML in an `<iframe srcDoc>`,
deliberately not `dangerouslySetInnerHTML` -- **this also fixed a latent bug**: the old
read-only "Body preview" card used `dangerouslySetInnerHTML` on raw campaign body, which
would have leaked a template's `<style>` block into the whole admin app once styled
templates existed (8.3).

**Status: verified in a real browser** -- preview correctly renders a selected template's
styled wrapper with merge fields resolved; the iframe's style isolation confirmed (admin
page's own styling unaffected).
