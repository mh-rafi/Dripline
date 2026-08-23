# Phase 6 — Admin UI (React)

**Goal:** usable web UI covering everything built in Phases 1–5.

Tasks:

- Auth/login.
- Subscribers/lists management screens.
- Campaign builder + template editor + send/pause/cancel controls, live progress.
- Connections configuration screen -- built as part of Phase 3, listed here for
  completeness.
- Workflow builder + enrollment/monitoring view. A visual step editor replacing the current
  raw-JSON steps textarea is still open.
- Analytics: opens/clicks/campaign performance.

**Exit criteria:** an admin can do everything the API supports -- create a list, build a
template, send a campaign, configure connections, build and monitor a drip workflow --
without touching the API directly.

**Depends on:** Phases 1–5 (UI trails the API for each feature area).

**Status:** driven in a real browser for auth/dashboard/campaigns/connections/subscribers
(including the redesign and bulk actions below). Workflows and lists pages still haven't
been -- verification there has only gone through the API.

---

## Update: Tailwind + shadcn/ui redesign, dark/light/system theming (2026-08-24)

**Goal:** replace the hand-rolled, dark-only `index.css` (bare `.card`/`.toolbar`/`.badge`
classes and per-page inline styles) with Tailwind CSS v4 + shadcn/ui, adding real
light/dark/system theming for the first time. Planned in `../UI_UX_Plan.md`, modeled on a
separately-cloned shadcn/Tailwind design system repo (not part of this monorepo) -- see
that plan for the full component inventory, token values, and page-by-page notes.

**Built:** every page migrated onto the new component set
(`apps/web/src/components/ui/{base,data-entry,data-display,feedback,layout,navigation}/`);
`Layout.tsx` rebuilt around the ported `Sidebar`; a `ThemeProvider` (`lib/theme.tsx`) for
light/dark/system with `localStorage` persistence and a live `matchMedia` listener, plus a
FOUC-prevention inline script in `index.html`; a three-way theme toggle in the sidebar
footer. `PreviewModal` rebuilt on shadcn's `Dialog` while deliberately keeping its
`<iframe srcDoc>` rendering (see Phase 8.4 -- a template's own `<style>` block would
otherwise leak into the admin app's CSS).

**Status: reviewed, two real bugs found and fixed.** A live-browser review (not just
reading the diff) found: (1) the sidebar's active-page highlighting was wired to a
hardcoded `isActive={false}` instead of the current route -- fixed with `useLocation()`;
(2) dark mode's `--color-destructive` token had a typo (`hsl(84 84% 70%)`, yellow-green)
instead of the spec's `hsl(0 84% 70%)` (red), making every delete/destructive button render
the wrong color -- fixed. Everything else in the ported theme matched the plan's token
values exactly. Confirmed live: light/dark/system all render correctly, no leftover
references to deleted CSS classes, TinyMCE/GrapesJS/CodeMirror internals untouched per the
plan's explicit non-goal.

## Update: Subscriber bulk actions + server-side pagination (2026-08-24)

**Goal:** checkbox row selection + bulk actions (Export, Manage Lists, Delete, Blocklist)
on the Subscribers page, matching listmonk, plus a "select all N matching" mode for acting
on more rows than fit on one page without transferring huge ID lists -- and the
server-side pagination this depends on (previously no page-size/offset UI, and the backend
never returned a total count). Planned in `../subscriber_bulk_actions.md`, including the
resolved design question on why "remove from list" and "mark unsubscribed" are the same
operation here.

**Built:** `GET /subscribers` now returns `{ subscribers, total }` (was a bare array); four
new endpoints -- `POST /subscribers/bulk/{blocklist,delete,lists}` and
`POST /subscribers/export` -- sharing one `BulkSelector` shape (explicit `ids[]`, capped at
1000/request with client-side chunking above that, or a `{ query, all: true }` selector
that re-runs the same filter server-side as a single SQL statement, so "select all 8,000+"
never transfers an ID list). `Dashboard.tsx` now uses the real `total` instead of the old
capped `"200+"` guess. Frontend: full selection state machine in `Subscribers.tsx`
(persists across pages, clears on search change, tri-state header checkbox), a "Manage
lists" dialog, `TablePagination`, `CheckboxCell`/`CheckboxHeaderCell`.

**Status: reviewed, two critical and two moderate bugs found and fixed -- none of this
worked before the review.** Checked live against a running API + Postgres seeded with 800+
real subscribers:

- **All four bulk endpoints threw `there is no parameter $1` on every call.** The shared
  `selectorWhereClause()` helper built a raw `$1`/`$2` SQL string plus a separate `params`
  array, but every caller spliced only the string in via `sql.raw()` and silently dropped
  the params. Fixed by returning a Kysely `RawBuilder` (built with the `sql` tagged
  template, which composes and parameterizes correctly when nested) instead of a
  hand-numbered placeholder string.
- **`GET /subscribers?list_id=` always returned zero results.** The refactor for the new
  response shape dropped the `list_id` condition entirely, silently falling back to an
  `ilike '%undefined%'` match. Fixed with a shared `applySubscriberFilter()` helper used by
  both the paged query and the count query.
- Bulk blocklist incorrectly triggered the page-clamping logic written for bulk delete --
  blocklisting doesn't remove rows from this list, so `total` never shrinks.
- `bulkLists`'s "add" action reported `affected` from a `RETURNING 1` column that isn't
  actually named `affected` (always `undefined`) -- corrected to the returned row count.

Re-verified all four endpoints, `list_id` filtering, and pagination live end-to-end after
the fixes (explicit-ID mode, select-all-matching mode, CSV export/re-import, page-size
changes).
