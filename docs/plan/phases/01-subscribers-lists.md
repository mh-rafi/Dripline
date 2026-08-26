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
