# Subscriber bulk actions + server-side pagination

**Status:** planning only — not started. Written for a separate implementing
agent to execute; the author of this plan will review the result afterward
against §10's acceptance criteria, one item at a time.

**Depends on:** the Tailwind/shadcn migration in `UI_UX_Plan.md` (already
implemented at the time of writing — `Subscribers.tsx` already uses the new
`Table`/`Checkbox`/`Dialog`/`Select`/etc. components from
`apps/web/src/components/ui/`). This plan builds on top of that component
set rather than reintroducing hand-rolled markup.

## 0. What this plan covers

Two related features for `apps/web/src/pages/Subscribers.tsx`:

1. **Row selection + bulk actions**, matching listmonk: a checkbox per row
   (and a header "select all on this page" checkbox), a bulk-action toolbar
   that only appears once at least one row is selected, and a "select all N
   matching this search" upgrade path for acting on more rows than are
   loaded on the current page. Actions: **Export**, **Manage lists**,
   **Delete selected**, **Add to blocklist**.
2. **Server-side pagination** — the subscriber list currently fetches
   without `limit`/`offset` UI at all (the backend already accepts them,
   nothing in the frontend drives them) and the backend never returns a
   total row count. Both are needed for bulk actions to make sense at scale
   (you can't offer "select all 8,239" without knowing there are 8,239, and
   you shouldn't be loading all of them into the browser to find out).

Backend (`apps/api`) changes are in scope this time, unlike the previous
UI-only plan — this feature genuinely needs new endpoints and a changed
response shape, not just restyling.

## 1. Current state (read before starting)

- `apps/api/src/routes/subscribers.ts`'s `GET /api/v1/subscribers` takes
  `q`, `list_id`, `limit` (default 50, max 200), `offset` (default 0) and
  returns a **bare array**, no total count.
- `apps/web/src/pages/Subscribers.tsx` calls that endpoint with only `q`
  (no `limit`/`offset`/page controls in the UI at all) and renders every
  returned row in one `Table`.
- `apps/web/src/pages/Dashboard.tsx` also calls `GET /subscribers?limit=200`
  today, using `subscribers.length` (capped and displayed as `"200+"`) as a
  crude stand-in for a real subscriber count. This is a real consumer of
  the endpoint you're about to change — it must be updated in the same
  change, not left calling the old shape (see §3).
- `apps/api/src/services/subscribers.ts` has single-subscriber helpers
  (`addToList`, `addToListForImport`, `removeFromList`, `blocklistSubscriber`)
  that each touch one subscriber at a time. `SubscriberImport.tsx`'s import
  flow already establishes the "batch client-side requests, show progress"
  pattern this plan reuses (`BATCH_SIZE = 300`, sequential POSTs, a
  `{ done, total }` progress state) — follow that precedent rather than
  inventing a new batching convention.
- All the relevant foreign keys (`subscriber_lists.subscriber_id`,
  `campaign_emails.subscriber_id`, `bounces.subscriber_id`,
  `workflow_enrollments.subscriber_id` → `ON DELETE CASCADE`;
  `campaign_views.subscriber_id`, `link_clicks.subscriber_id` →
  `ON DELETE SET NULL`) already cascade cleanly on subscriber deletion —
  confirmed in `apps/api/migrations/1755820800001_core.sql` and friends. **No
  new migration is needed for bulk delete** — it's the same cascade behavior
  the existing single-subscriber `DELETE /subscribers/:id` already relies
  on, just scoped to more rows at once.
- The design system (per `UI_UX_Plan.md`) ported a slimmed-down
  `apps/web/src/components/ui/data-display/table.tsx` — it has `Table`,
  `TableHeader/Body/Row/Head/Cell`, `TableEmptyState`, `StatusCell`,
  `ActionButtonsCell`, but **not** `CheckboxCell`/`CheckboxHeaderCell` or
  any pagination component (both were explicitly skipped in that plan as
  "not needed yet" — they're needed now). `TableRow` already accepts a
  `selected` boolean prop (`data-state="selected"` styling), so highlighting
  a selected row needs no new work. `apps/web/src/components/ui/data-entry/
select.tsx` already has `MultiSelectTrigger`/`MultiSelectItem` (ported but
  not yet used anywhere in the app) — use these for the Manage Lists
  dialog's list picker rather than a native `<select multiple>`.

---

## 2. UX spec

### 2.1 Selection

- Each row gets a checkbox in a new first column (`CheckboxCell`, add it —
  see §5). The header has a matching `CheckboxHeaderCell` that selects/
  deselects every row **currently loaded on this page** (not the whole
  filtered set — see below for the distinction).
- Selecting at least one row reveals a bulk-action toolbar (see §2.2).
  With zero selected, that toolbar (and everything in it) is not rendered
  at all — not just visually hidden, actually absent from the DOM, matching
  "otherwise they will be hidden" from the request.
- Selection state (`Set<number>` of subscriber IDs) persists across page
  changes within the same search/filter — paging from 1 to 2 and back
  doesn't lose what was checked on page 1. Selection **resets** whenever
  the search query (`q`) changes, since the underlying result set just
  changed meaning (this mirrors how listmonk and most admin tables behave —
  a stale selection against a different filter is confusing, not useful).
- Header checkbox is in one of three states: unchecked (none of this page's
  rows selected), checked (all of this page's rows selected), or
  indeterminate (some but not all) — Radix's `Checkbox` natively supports
  `checked="indeterminate"`, no custom logic needed beyond computing which
  of the three applies from the current page's rows vs. `selectedIds`.

### 2.2 The "N selected" bar and "select all matching"

- Once ≥1 row is selected, show a bar above the table (or replacing the
  toolbar row — implementer's call on exact placement, but it must be
  clearly associated with the table, not floating disconnected from it)
  reading e.g. **"3 selected"**, with the action buttons (§2.3) next to it,
  and a "Clear selection" control to reset back to zero.
- If the number of rows selected equals **every row currently loaded on
  this page** (i.e. the user just hit "select all on this page" via the
  header checkbox, or manually checked all of them) **and** the total
  result set (`total` from the API — see §3) is larger than one page, show
  an additional line: **"All N on this page selected. Select all {total}
  matching '{q}' →"** (omit the `matching '{q}'` clause when there's no
  active search). Clicking it sets a `selectAllMatching` flag to `true`.
- While `selectAllMatching` is true: the bar reads **"All {total}
  selected"**, with a "Clear selection" control that resets both
  `selectAllMatching` and the explicit ID set. Checking/unchecking any
  individual row while in this mode should drop back to explicit-ID mode
  (starting from either "everything" minus that one, or simplest: just
  clear `selectAllMatching` and start a fresh explicit set from the current
  page's checked state — implementer's call, but don't leave the UI in a
  state where both an explicit exclusion list and `selectAllMatching` are
  simultaneously true, that's unnecessary complexity nothing in this spec
  asks for).
- This "select all matching" flag is what lets acting on 8,239 rows avoid
  ever transferring 8,239 IDs anywhere — see §4's `query`-mode bulk
  endpoints, which re-run the same server-side filter instead of taking an
  ID list when this mode is active.

### 2.3 Actions (only rendered when something is selected)

In the order given in the request:

1. **Export** — downloads a CSV of the selected subscribers (or of every
   subscriber matching the current filter, in select-all-matching mode).
   See §4.4/§6.3.
2. **Manage lists** — opens a dialog (§2.4). Add to list(s) or remove from
   list(s), for the selected subscribers.
3. **Delete selected** — destructive, gate behind `Popconfirm`
   (`apps/web/src/components/ui/feedback/popconfirm.tsx`, already used
   elsewhere post-migration) with copy naming the count (e.g. "Delete 3
   subscribers permanently? This can't be undone." / "Delete all 8,239
   subscribers matching your search permanently? This can't be undone." in
   select-all mode — the two cases should read differently, an
   all-matching delete is a much bigger blast radius and the confirmation
   copy should make that obvious).
4. **Add to blocklist** — also gate behind `Popconfirm` (blocklisting
   unsubscribes from every list too, per the existing single-subscriber
   `blocklistSubscriber` semantics — same "this affects N subscribers"
   framing as delete).

After Delete or Blocklist completes: clear selection, clear
`selectAllMatching`, and reload the current page (see §6.4 for what to do
if the page is now past the end of a shrunken result set).

### 2.4 Manage Lists dialog

A `Dialog` (`apps/web/src/components/ui/feedback/dialog.tsx`) titled
"Manage lists" (or "Manage lists for 3 subscribers" / "Manage lists for all
8,239 matching subscribers" — include the count/mode in the title or a
subtitle, so it's unambiguous what's about to be affected before the user
picks anything). Contents:

- An action choice — **Add to list(s)** vs. **Remove from list(s)**
  (`RadioGroup`, two options). Per the existing single-subscriber semantics
  in `services/subscribers.ts` (`removeFromList` sets `subscriber_lists.
status = 'unsubscribed'`, it does not delete the row), **"Remove from
  list(s)" and "mark as unsubscribed" are the same operation in this
  codebase already** — there's no separate hard-delete-membership action
  anywhere else in the app, and this plan doesn't invent one just for bulk.
  If that reading of the original request ("add/remove from list, mark as
  unsub") is wrong and a genuinely separate hard-delete-membership bulk
  action is wanted, flag that back rather than silently building a third
  action — but the default assumption here is two actions, not three.
- A list picker (`MultiSelectTrigger`/`MultiSelectItem` from `select.tsx`,
  §1) — every list, multi-selectable, matching the "Lists" field's data
  shape used in `Subscribers.tsx`'s existing Add-subscriber form
  (`{ id, name, optin }`).
- **Only when "Add to list(s)" is selected:** a status choice — Unconfirmed
  vs. Confirmed (`RadioGroup`) — matching `SubscriberImport.tsx`'s existing
  `status` field exactly (that page already asks this same question for
  the same underlying reason: bulk list-membership creation needs an
  explicit status, it shouldn't silently guess per-list opt-in defaults the
  way the single-subscriber `addToList` does). Reuse that field's copy/
  behavior rather than reinventing the wording.
- Submit button reads something like "Apply to 3 subscribers" / "Apply to
  all 8,239 matching subscribers", disabled until at least one list is
  picked.
- On submit: call the bulk lists endpoint (§4.3), batched per §6.2 if in
  explicit-ID mode, single request if in select-all-matching mode. Show
  progress the same way the CSV importer does (§6.2). On completion, close
  the dialog, clear selection, reload the current page.

---

## 3. Backend: `GET /api/v1/subscribers` response shape change

**Breaking change to this endpoint's response** — from a bare array to:

```ts
{ subscribers: Subscriber[], total: number }
```

`total` is the count of rows matching the current `q`/`list_id` filter
(ignoring `limit`/`offset`) — needed for both real pagination controls and
the "select all N matching" feature. Compute it with a second query
(`COUNT(*)` using the same `WHERE` conditions as the main query — factor
the shared filter-building logic out of the existing handler into a small
helper, e.g. `applySubscriberFilter(builder, { q, list_id })`, so the count
query and the page query can't drift apart) rather than trying to get both
in one round trip — Kysely doesn't make a single "rows + total" query
meaningfully simpler here, and correctness/readability matters more than
saving one query on an admin list page.

**Every existing consumer of this endpoint must be updated in the same
change:**

- `apps/web/src/pages/Subscribers.tsx` — obviously, it's the page this
  whole plan is about.
- `apps/web/src/pages/Dashboard.tsx` — currently does
  `api.get<Subscriber[]>("/subscribers?limit=200")` and derives a capped
  `"200+"` display from `subscribers.length`. Replace with
  `api.get<{ subscribers: Subscriber[]; total: number }>("/subscribers?limit=1")`
  (limit 1 is enough — Dashboard only wants the exact `total`, not the
  rows) and display `total` directly. This is a genuine improvement (exact
  count instead of a "200+" guess), not just a mechanical type fixup —
  make sure it lands that way rather than preserving the old capped-guess
  behavior for no reason.

Update `docs/api-reference.md`'s Subscribers section to reflect the new
response shape, per this project's established convention of keeping that
file in sync with every route change (see any earlier phase in
`DEVELOPMENT_PLAN.md` for the pattern — every backend change in this repo's
history updated that doc in the same change, not as an afterthought).

---

## 4. Backend: bulk-action endpoints

All four new endpoints share one request shape for "which subscribers":

```ts
type BulkSelector =
  | { ids: number[] } // explicit IDs, 1-1000 per request (see §6.2 for why 1000, and client-side chunking above that)
  | { query: { q?: string; list_id?: number }; all: true }; // re-run the same filter server-side, no ID transfer needed
```

Validate with a Zod union; reject empty `ids` arrays and reject `ids`
arrays over 1000 entries (that's a client bug — the frontend should have
chunked, see §6.2 — not something the server should silently accept and
grind through). For the `query` variant, reuse the same
`applySubscriberFilter` helper from §3 so "select all matching" always
matches exactly what the user saw before clicking it, including if `q` is
empty (meaning "every subscriber" — the delete/blocklist confirm copy in
§2.3 needs to make that unmistakable to the user before they confirm it).

Implement each as a single SQL statement scoped by either an `id = ANY($1)`
array match or a `WHERE id IN (subquery)` — **not** a loop calling the
existing per-subscriber helpers (`addToList`, `blocklistSubscriber`, etc.)
once per row. That per-row-loop pattern is what `POST /subscribers/import`
already does and it's fine there (imports are typically hundreds of _new_
rows with per-row upsert-or-update branching that doesn't collapse neatly
into one statement), but a bulk action against up to potentially the
entire subscribers table needs to actually be one query, or "select all
8,239" turns into 8,239 round trips. `apps/api/src/services/subscribers.ts`'s
`unsubscribeFromCampaignLists` is the existing precedent in this codebase
for "drop to a raw `sql` tagged template when the query shape doesn't fit
Kysely's query builder cleanly" — follow that same approach here rather
than fighting the builder.

### 4.1 `POST /api/v1/subscribers/bulk/blocklist`

Body: `BulkSelector`. Same effect as the existing (already-fixed, see §8)
`blocklistSubscriber(db, subscriberId)`, just scoped to the selector
instead of one ID: set `subscribers.status = 'blocklisted'`, and for every
matching `subscriber_lists` row not already `unsubscribed`, stash its
current `status` into `pre_blocklist_status` before setting `status =
'unsubscribed'` — the same `pre_blocklist_status` mechanism the
single-subscriber path uses, so a subsequent single-subscriber
`unblocklist` call (there's no bulk unblock/unblocklist action in this
plan, per §8) still restores correctly for anyone blocklisted in bulk.
Don't reimplement this as a call to `blocklistSubscriber` in a per-row
loop — same reasoning as the rest of §4, one SQL statement for the
`subscribers` update and one for the `subscriber_lists` stash-and-overwrite,
scoped by the selector. Returns
`{ affected: number }` (rows actually updated — useful for the frontend to
show "Blocklisted 3 subscribers" even in select-all mode where the
frontend never knew the exact count up front beyond `total`... though in
practice `affected` should equal `total` for a fresh select-all-matching
call; it can differ from an explicit `ids` list if some of those IDs no
longer exist, which is fine, just report what actually happened).

### 4.2 `POST /api/v1/subscribers/bulk/delete`

Body: `BulkSelector`. `DELETE FROM subscribers WHERE ...`, relying on the
cascades noted in §1. Returns `{ affected: number }`.

### 4.3 `POST /api/v1/subscribers/bulk/lists`

Body: `BulkSelector & { list_ids: number[]; action: "add" | "remove"; status?: "unconfirmed" | "confirmed" }`.
`status` is required when `action === "add"` (validate with a Zod
`superRefine`, matching the pattern already used for the rate-limit-pair
validation in `apps/api/src/routes/campaigns.ts`), ignored/optional when
`action === "remove"` (remove always sets `status = 'unsubscribed'`, there's
no separate status choice for it — see §2.4's note on remove/unsubscribe
being the same operation here).

- `action: "add"`: for every `(subscriber, list)` pair in the selector ×
  `list_ids` cross product, upsert into `subscriber_lists` with the given
  `status`, `ON CONFLICT (subscriber_id, list_id) DO UPDATE SET status =
excluded.status`. This is the one operation in this plan that's
  genuinely awkward to express as pure Kysely builder chains because it's
  a cross join between a (possibly subquery-derived) subscriber set and an
  explicit `list_ids` array — a raw `sql` template building
  `INSERT INTO subscriber_lists (subscriber_id, list_id, status) SELECT s.id, l.list_id, ${status} FROM (<filtered subscribers>) s CROSS JOIN unnest(${list_ids}::int[]) AS l(list_id) ON CONFLICT (subscriber_id, list_id) DO UPDATE SET status = excluded.status`
  is the shape to aim for — adjust as needed once actually writing it
  against Kysely's raw-SQL escape hatches. Don't fire the
  `triggerListJoined` workflow trigger (used by the single-subscriber
  `addToList`) per row here — that trigger's whole purpose is "a person
  action added someone to a list," and firing it for potentially thousands
  of rows from one bulk admin action would flood workflow enrollments in a
  way nothing in this request asked for. Note this divergence explicitly
  in the code comment so it's not mistaken for an oversight later.
- `action: "remove"`: single `UPDATE subscriber_lists SET status =
'unsubscribed' WHERE list_id = ANY($list_ids) AND subscriber_id IN
(<selector>)`.

Returns `{ affected: number }` (subscriber_lists rows touched).

### 4.4 `POST /api/v1/subscribers/export`

Body: `BulkSelector`. Returns `Content-Type: text/csv` with
`Content-Disposition: attachment; filename="subscribers.csv"` (not JSON —
this is the one endpoint in this plan that doesn't return
`{ affected }` or go through the shared JSON response path). Columns:
`email,name,status,attribs,lists` — `attribs` as a JSON string (matching
the format `SubscriberImport.tsx`'s own CSV parser already expects for
round-tripping, so an exported file can be re-imported), `lists` as a
semicolon-separated `name:status` list (e.g.
`Newsletter:confirmed;Product Updates:unconfirmed`) so list membership
isn't silently dropped from the export. Build the CSV with a small
hand-rolled serializer (quote fields containing the delimiter/quotes/
newlines, matching the existing hand-rolled parser's own quoting
convention in `apps/web/src/lib/csv.ts` — don't add a CSV library for a
handful of columns) — this can live in `apps/api/src/lib/` since, unlike
the import-side parser, this runs server-side. For dataset sizes this
self-hosted tool realistically deals with (thousands, not millions of
rows), building the full CSV string in memory before responding is fine;
note in a comment that a true streamed response would be the fix if this
ever becomes a memory problem, but don't build streaming now — that's
solving a problem this project doesn't have yet.

---

## 5. Frontend: new/extended UI components

Add to `apps/web/src/components/ui/data-display/table.tsx` (and export
from `apps/web/src/components/ui/index.ts`):

- `CheckboxCell` and `CheckboxHeaderCell` — port these from the DS repo's
  `shadcn-tailwind-design-system/src/components/ui/data-display/table.tsx`
  (they weren't brought over in the original migration, per §1). Same
  `checked`/`indeterminate`/`onCheckedChange` prop shape as that source —
  thin wrappers around the already-ported `Checkbox` inside a `TableCell`/
  `TableHead` with `cellWidth="xs"`.
- A pagination component — port `PaginationState`/`TablePagination` from
  the same DS source file (it has page-number generation with ellipsis for
  large page counts, a page-size changer, and a "showing X–Y of Z" label,
  all driven by `{ current, pageSize, total }` — a better fit here than
  the separate simple prev/next `navigation/pagination.tsx` given this
  page can realistically have thousands of rows and dozens of pages).

New page-local pieces in `apps/web/src/pages/`:

- A `ManageListsDialog` component (either inline in `Subscribers.tsx` or
  its own file under `components/` if it gets long — implementer's call)
  implementing §2.4.
- Bulk-action bar markup in `Subscribers.tsx` per §2.2/§2.3.

`apps/web/src/lib/api.ts`'s shared `request()` helper always calls
`res.json()` — add a separate small helper (e.g. `api.downloadBlob(path,
body)`) for the export endpoint that instead does `res.blob()` and drives
a browser download (temporary `<a>` element with `URL.createObjectURL`,
matching the standard client-side-triggered-download pattern — there's no
existing precedent for this in the codebase since nothing has downloaded a
file before now, so this is genuinely new, not a port of an existing
pattern).

---

## 6. Frontend: state design in `Subscribers.tsx`

### 6.1 Pagination + selection state

```ts
const [page, setPage] = useState(1); // 1-indexed, matches TablePagination's convention
const [pageSize, setPageSize] = useState(50);
const [total, setTotal] = useState(0);
const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
const [selectAllMatching, setSelectAllMatching] = useState(false);
```

- `load()` fetches `/subscribers?q=...&limit=${pageSize}&offset=${(page-1)*pageSize}`,
  sets both `subscribers` and `total` from the new response shape.
- Changing `q` resets `page` to 1 **and** clears `selectedIds`/
  `selectAllMatching` (§2.1).
- Changing `page`/`pageSize` does not clear selection.
- `selectedCount = selectAllMatching ? total : selectedIds.size`.

### 6.2 Batching explicit-ID actions

When `selectAllMatching` is false and an action is invoked, chunk
`[...selectedIds]` into groups of (implementer's call, but stay well under
the backend's 1000-per-request cap from §4 — 300 to match
`SubscriberImport.tsx`'s existing `BATCH_SIZE` constant is a reasonable
default, for consistency with that precedent rather than picking an
arbitrary different number) and POST sequentially, tracking `{ done, total
}` progress exactly like `SubscriberImport.tsx`'s `runImport()` already
does — reuse that pattern's shape (a `progress` state, a disabled submit
button showing "Processing…", incrementing `done` after each batch
resolves) rather than designing a new one. When `selectAllMatching` is
true, send exactly one request with the `query`/`all` selector — no
batching, no progress bar needed (the backend runs it as one statement per
§4).

### 6.3 Export

Two cases:

- Explicit selection: since export is read-only (no batching/progress
  concerns the way mutating actions have — one request either succeeds or
  it doesn't), a single `api.downloadBlob("/subscribers/export", { ids:
[...selectedIds] })` call is fine even for a large explicit set, up to
  the same 1000-per-request validation cap in §4 — if `selectedIds.size`
  exceeds that, either chunk into multiple downloaded files (bad UX) or
  simply disable/hide Export once past that size and point the user at
  "select all matching" instead if they want everything (better UX — note
  this as the intended behavior rather than leaving it undefined).
- Select-all-matching: `api.downloadBlob("/subscribers/export", { query, all: true })` —
  one request, backend handles the full set server-side.

### 6.4 After a mutating bulk action

Reload the current page's data. If the action removed enough rows that
`page` is now past the last valid page for the new `total` (e.g. you were
on page 5 of 5 and deleted everything on it), clamp `page` back to the new
last page (or to 1 if the result set is now empty) before reloading —
don't leave the UI showing an empty page 5 of a now-3-page result with no
way back except manually editing the URL.

---

## 7. Sequencing

1. **Backend first, in isolation.** §3's response-shape change +
   `applySubscriberFilter` helper, then the four §4 endpoints. Verify each
   with a live Postgres + a scripted request (the pattern established
   throughout this project's history — spin up Docker Postgres, run
   migrations, hit the real API, assert real DB state changed, tear down —
   see `DEVELOPMENT_PLAN.md` for the precedent used on every prior backend
   change in this repo). Update `docs/api-reference.md` alongside.
2. **Dashboard.tsx fixup.** Small, isolated, do it right after the
   response-shape change lands so nothing in the frontend is calling the
   old shape for longer than necessary.
3. **Pagination UI in `Subscribers.tsx`**, without bulk actions yet —
   `TablePagination`, `page`/`pageSize`/`total` state, confirm paging
   actually changes the visible rows against a seeded dataset with more
   than one page's worth of subscribers.
4. **Selection UI** — checkboxes, header checkbox tri-state, the bulk bar,
   "select all matching" upgrade — still without wiring the actions to
   real endpoints yet (buttons can be present but stubbed), to verify the
   selection state machine (§2.1/§2.2) in isolation before adding network
   calls on top of it.
5. **Wire the four actions** — Export, Manage Lists dialog, Delete,
   Blocklist — one at a time, each verified against a real API + Postgres
   with a seeded subscriber set large enough to actually exercise
   pagination and select-all-matching (a handful of test subscribers isn't
   enough to prove this feature works — seed at least a few hundred rows
   across a couple of pages for real verification).
6. **Full click-through** in a real browser: search, page through results,
   select individual rows across two pages, use "select all N matching",
   run each of the four actions, confirm the confirm-dialogs' copy matches
   what's actually about to happen (explicit count vs. "all N matching"),
   confirm dark/light/system theme all still look right on every new piece
   (checkboxes, the bulk bar, the dialog, pagination controls) — this
   feature is being built directly on top of the just-migrated design
   system, so it should look native to it, not bolted on.

Run `npm run build`, `npm run lint`, `npm run format` at the end of every
phase, not just at the end of the whole plan.

---

## 8. Non-goals

- No changes to the single-subscriber detail page (`SubscriberDetail.tsx`)
  or its individual blocklist/unblocklist/delete/list-membership actions —
  this plan only adds bulk equivalents on the list page. (A real bug in
  `unblocklistSubscriber` not restoring list memberships was found and
  fixed separately from this plan, in
  `apps/api/src/services/subscribers.ts` + migration `1755820800010` — see
  `DEVELOPMENT_PLAN.md`'s Phase 1 addendum. It's called out here only so
  the bulk blocklist endpoint in §4.1 is understood to already sit on top
  of the fixed, restore-capable version, not the old broken one.)
- No "select all matching" support for actions this plan doesn't list —
  don't invent a bulk tag-add or bulk attribute-edit while in here, even
  though the selector/batching machinery would technically support it.
- No changes to `POST /subscribers/import`'s existing per-row loop — that
  endpoint has a different shape of problem (upsert-or-update branching
  per new row) than these bulk actions (uniform operation across existing
  rows), don't try to unify them.
- No hard-delete-membership bulk action distinct from "remove/unsubscribe"
  — see §2.4's note; flag back if this assumption is wrong rather than
  building a third action speculatively.
- No new database migration — confirmed in §1 that existing cascades cover
  bulk delete.
- Don't touch `Lists.tsx`, `List` type, or list CRUD — this plan only reads
  the existing lists list for the Manage Lists dialog's picker.
- No bulk "remove from blocklist" action — the request's four actions are
  Export/Manage Lists/Delete/Blocklist, not Unblocklist. If bulk unblock
  turns out to be wanted too, it's a small, separate addition on top of the
  now-fixed `unblocklistSubscriber` (§4.1's note), not part of this plan.

---

## 9. Why "remove from list" and "mark unsubscribed" are one action, not two

Resolved during planning review (was originally flagged here as an open
question) — kept as a design note since the reasoning matters for anyone
touching this code later, including the future "target all contacts in a
campaign" feature mentioned below.

`removeFromList` (`apps/api/src/services/subscribers.ts`) has never hard-
deleted a `subscriber_lists` row — "removing" someone from a list has
always meant setting `status = 'unsubscribed'` and keeping the row. This
plan's Manage Lists dialog (§2.4) just exposes that same, already-existing
semantic in bulk form, rather than inventing a third, harder-delete
operation the single-subscriber page doesn't have either.

This is the deliberately safer choice, not an accidental one: a soft
`unsubscribed` marker is what makes an opt-out durable against being
silently undone later. `POST /subscribers/import`'s
`overwrite_subscription_status` flag (default `false`, per its own
`addToListForImport` logic) means a future CSV import that re-lists an
already-unsubscribed email _won't_ resubscribe them, specifically because
the row and its status still exist to be checked against. If "remove"
instead hard-deleted the row, a later import would see no existing
membership at all and would freely re-add them — silently reintroducing
someone who'd opted out. Keeping one soft-unsubscribe operation (whatever
you call the button that triggers it) is what preserves that guarantee;
adding a separate hard-delete path alongside it would just create a way to
accidentally bypass it.

**On the future "add all contacts to a campaign" feature:** that's
orthogonal to this and unaffected either way. Targeting "all contacts"
would mean querying the `subscribers` table directly (every `enabled`,
non-blocklisted row) rather than joining through `subscriber_lists` at
all — a subscriber who unsubscribed from one specific list is still very
much a subscriber, so they'd still be included in an "all contacts" send
regardless of whether that list-level opt-out is modeled as a soft status
or (hypothetically) a hard delete. Nothing about how this plan's Manage
Lists dialog removes someone from a list should need to change to support
that later feature — they operate on different data (list membership vs.
the subscriber roster itself).

---

## 10. Acceptance criteria (for the later review pass)

- [ ] `npm run build`, `npm run lint`, `npm run format` all clean at the
      repo root.
- [ ] `GET /subscribers` returns `{ subscribers, total }`; both
      `Subscribers.tsx` and `Dashboard.tsx` consume the new shape (grep for
      any leftover code assuming a bare array).
- [ ] Pagination controls actually change which rows are shown, `total`
      reflects the real filtered count (verify against a seeded dataset
      spanning multiple pages, not just visually).
- [ ] Selecting rows shows the bulk bar; deselecting everything makes it
      disappear from the DOM (not just `display: none`).
- [ ] Selection persists across page changes and clears when the search
      query changes.
- [ ] "Select all N matching" appears only when applicable (page fully
      selected AND more rows exist beyond this page), and correctly
      switches the four actions to selector-by-query mode.
- [ ] Each of Export/Manage Lists/Delete/Blocklist works correctly in both
      explicit-ID mode and select-all-matching mode, verified against a
      real API + Postgres with a dataset large enough to actually span
      multiple pages/batches.
- [ ] Bulk delete/blocklist/list-changes are each a single SQL statement
      per request (not a per-row loop) — check the actual implementation,
      not just that it works.
- [ ] Destructive actions (Delete, Blocklist) are gated behind a
      confirmation whose copy correctly distinguishes "N selected" from
      "all N matching" scenarios.
- [ ] Exported CSV re-imports cleanly through `SubscriberImport.tsx`'s
      existing column-mapping flow (round-trip check).
- [ ] No new database migration was added.
- [ ] `docs/api-reference.md` reflects every new/changed endpoint.
