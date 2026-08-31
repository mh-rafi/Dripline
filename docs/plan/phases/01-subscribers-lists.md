# Phase 1 — Core data model + subscriber/list management

**Goal:** the listmonk-parity foundation everything else sits on.

Tasks:

- Migrations: `subscribers`, `lists`, `subscriber_lists`, `templates`.
- CRUD API for subscribers and lists (create/list/update/delete, bulk import).
- Subscriber attributes (JSONB), tags.
- Single/double opt-in flow for lists.
- Public API auth (API keys) -- superseded, see
  [../roles_and_permissions.md](../roles_and_permissions.md).
- Basic template model (store + render, no builder UI yet).

**Exit criteria:** create a list, import subscribers via API and via CSV, subscribe/confirm
double opt-in, fetch a rendered template with subscriber data merged in.

**Depends on:** Phase 0.

**Status: core CRUD built and solid.** Still open from the original exit criteria: the
double opt-in **confirmation flow** (see below) -- an admin can mark someone `confirmed`
manually, but a subscriber has no way to do it themselves via email link yet. This is real,
not cosmetic -- worth prioritizing before recommending double opt-in lists for real use.

---

## Update: double opt-in status UI clarity (2026-08-22)

**Problem:** adding a subscriber to a list always defaulted `subscriber_lists.status` to
`unconfirmed`, shown as an uncolored badge regardless of the list's opt-in type. On a
**single** opt-in list this is meaningless noise -- `unconfirmed` doesn't gate sending there
(see `services/campaigns.ts` eligibility logic) -- but it read as "needs action."

**Fixed:**

- `addToList` (`services/subscribers.ts`) defaults status by the list's actual opt-in type
  when not specified: `confirmed` for single opt-in, `unconfirmed` for double opt-in.
  Applied everywhere, including the workflow `add_list` step, which previously hardcoded
  `"confirmed"` unconditionally -- a real correctness bug: it silently bypassed double
  opt-in consent for anyone added via automation.
- `GET /subscribers/:id` now includes each list's `optin` type alongside membership status.
- `SubscriberDetail.tsx` shows single opt-in as "subscribed" (no confusing distinction, it's
  a no-op there) and double opt-in as "confirmed" / "awaiting confirmation" with an
  explanatory tooltip. Badge colors added (previously unstyled).

## Update: CSV subscriber import with column mapping (2026-08-22)

**Problem:** `POST /subscribers/import` took pre-parsed JSON only -- no admin UI path to
bulk-import a CSV, which Phase 1's exit criteria explicitly calls for.

**Built:**

- `SubscriberImport.tsx` (`/subscribers/import`), modeled on listmonk's import screen:
  Subscribe/Blocklist mode, list-membership status, CSV delimiter, "overwrite user info" /
  "overwrite subscription status" toggles, multi-select list picker.
- CSV parsing is entirely client-side (`lib/csv.ts` -- a small hand-rolled RFC-4180-ish
  parser; no new dependency).
- **Column mapping, which listmonk itself lacks:** each detected CSV column gets a "maps
  to" dropdown (Ignore / Email / Name / Attributes JSON / Attribute) with a best-effort
  auto-guess from the header name. Arbitrary columns (e.g. "Company", "Phone") map
  individually into `attribs` under an editable key.
- Backend: `POST /subscribers/import` extended with `mode`, `status`,
  `overwrite_user_info`, `overwrite_subscription_status`. New `addToListForImport`
  (`services/subscribers.ts`) takes an explicit status and either overwrites or leaves
  alone an existing membership's status per the toggle.
- UI batches rows to the API (300/request) for large files.

**Status: verified live** (real Postgres, running dev API + browser): auto-mapping of
mismatched CSV headers, the two overwrite toggles' behavior across repeated imports,
blocklist-mode import.

## Update: unblocklist didn't restore list memberships (fixed 2026-08-23)

**Bug:** blocklisting force-unsubscribes a subscriber from every list
(`blocklistSubscriber` sets every `subscriber_lists.status = 'unsubscribed'`).
Unblocklisting only reversed `subscribers.status` back to `enabled` -- list memberships
stayed unsubscribed forever. Originally written as an intentional safety choice, but that
conflated two different things: a membership unsubscribed _by blocklisting itself_ vs. one
the subscriber had already unsubscribed from before ever being blocklisted. Only the
latter is a real prior opt-out worth protecting; the former should just come back.

**Fixed:** migration `1755820800010` adds `subscriber_lists.pre_blocklist_status`.
`blocklistSubscriber` stashes each membership's status there before overwriting it with
`unsubscribed` -- only for memberships that weren't already unsubscribed, so a genuine
prior opt-out never gets stashed (and can't be mistakenly restored). `unblocklistSubscriber`
restores from `pre_blocklist_status` wherever set, then clears it. Any explicit status
change in the meantime (`addToList`, `addToListForImport`, `removeFromList`) also clears
`pre_blocklist_status` on the rows it touches, so a deliberate action taken while
blocklisted can't later be clobbered by an unrelated unblock.

**Status: verified against a real API + Postgres.** A membership unsubscribed only by
blocklisting round-trips back exactly on unblock; a genuinely-already-unsubscribed one
stays unsubscribed; a second blocklist/unblock cycle behaves correctly with no leftover
stashed state.

## Update: subscriber write semantics, tags as a column, filterable attributes (2026-08-31)

**Problem:** integrating the API from another project surfaced a cluster of related
issues, all rooted in `attribs` being both the extension point _and_ the place tags
lived.

- `POST /subscribers`, `PATCH /subscribers/:id` and the automation webhook replaced a
  contact's whole `attribs` object, so any partial write dropped keys an earlier write
  had set -- and untagged the contact, since tags were `attribs.tags`. Merging was only
  reachable through `POST /subscribers/import`, which also meant an integration doing
  routine attribute updates needed `subscribers:import`.
- `addToList` clobbered an existing membership's status unconditionally, so a recurring
  upsert (a nightly sync, an automation re-applying a list) silently resurrected people
  who had unsubscribed.
- There was no exact-email lookup: `q` is `ilike '%…%'` over email _and_ name, so an
  address search could return someone else's contact.
- `attribs` and tags weren't queryable at all, and had no index -- segmenting on a custom
  field meant exporting everything and filtering client-side.
- `POST /subscribers` always answered `201`, even when it updated; import took an
  unbounded array, aborted the whole batch on one bad row, and reported only
  `{ imported }`.

**Fixed:**

- `attribs_mode` (`merge | replace`) on `POST /subscribers` and `PATCH /subscribers/:id`,
  defaulting to `merge`; the webhook always merges. One helper (`attribsAssignment`)
  backs all three plus import, so the merge SQL lives in one place. The admin profile
  editor sends `replace` explicitly, since that textarea holds the whole object.
- `addToList` takes `opts.resubscribe` and otherwise guards its conflict update with
  `WHERE status != 'unsubscribed'`, and only fires `list_applied` when a row actually
  landed. `PUT /subscribers/:id/lists/:listId` passes `resubscribe: true` -- an explicit
  per-contact admin action is the one path allowed to lift an opt-out.
- Migration `1755820800024` moves tags to a `subscribers.tags text[]` column, backfilling
  from `attribs.tags` and dropping the key. Chosen over a `tags`/`subscriber_tags` pair:
  it's a small unordered set, needs no join in the list query, and is GIN-indexable.
  Rename/merge stays doable later as array ops without another schema change.
  `{{ Subscriber.Tags }}` is the template variable; `{{ Subscriber.Attribs.tags }}` is gone.
- Same migration adds GIN indexes on `tags` and on `attribs` (`jsonb_path_ops`), backing
  new `attribs` (containment) and `tags` (overlap) filters plus an exact `email` filter.
  All three are wired into both filter implementations -- the Kysely one for the listing
  and the raw-SQL `selectorWhereClause` for bulk actions -- so they can't drift.
- `POST /subscribers` answers `201` on create, `200` on update (`createSubscriber` now
  returns `{ subscriber, created }`). Import caps at 1000 rows, catches per row, and
  returns `{ created, updated, failed: [{ email, error }] }`; rows land independently, so
  an import is explicitly not atomic. CSV export gained a `tags` column and the import
  page a Tags column role, so an export still re-imports cleanly.

**Status: verified against real Postgres.** Service-level checks ran inside rolled-back
transactions: merge preserves earlier keys and tags while explicit `replace` clears only
attributes; a plain add leaves an unsubscribed membership alone while `resubscribe: true`
lifts it; the backfill moves tags, drops non-string elements and strips the key; tag
writes are idempotent and parameterized (a tag containing SQL is stored verbatim);
containment and overlap filters return the right rows and their params bind; CSV carries
tags. Both GIN indexes are used (confirmed via `EXPLAIN` with `enable_seqscan=off` -- the
dev table is too small for the planner to pick them otherwise). Not exercised end-to-end
over HTTP: the Zod query-string parsing and status codes.
