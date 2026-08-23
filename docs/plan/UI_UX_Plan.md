# UI/UX Overhaul Plan — Tailwind + shadcn/ui, dark/light/system

**Status:** planning only — not started. Written for a separate implementing
agent to execute; the author of this plan will review the result afterward
against the acceptance criteria in §11.

**Source design system:** `/Users/rafi/Documents/Peak Pulse/tailwind_DS/shadcn-tailwind-design-system`
(referred to below as **the DS repo**) — a cloned, standalone shadcn/ui +
Tailwind v4 component library, not part of this monorepo. Read its
`README.md`, `LAYOUT_SYSTEM.md`, `COMPONENT_DEVELOPMENT_SOP.md`, and
`COMPONENT_LIBRARY_REFERENCE.md` before starting; they're the DS's own house
rules and are referenced throughout this plan rather than re-quoted in full.

## 0. What this plan covers

Migrate `apps/web` (the React admin UI) from hand-rolled CSS
(`apps/web/src/index.css`, a single dark-only stylesheet, plus inline
`style={{}}` objects scattered through every page) to Tailwind CSS v4 +
shadcn/ui components modeled on the DS repo, with working light/dark/system
theming. **Backend (`apps/api`) is untouched.** No API contracts, Zod
schemas, or business logic change — this is a presentation-layer migration
only. Every page's data-fetching, validation, and side-effecting behavior
(the confirm dialogs, the iframe-isolated preview modal, the CSV
column-mapping flow, etc.) must come out working exactly as it does today.

---

## 1. Source design system — what to port, what to skip

The DS repo is a general-purpose component library with a Chinese-language
component catalog, a Storybook setup, and 5 unrelated demo apps. Not
everything in it is relevant.

**Port (adapt into Dripline):**

- The Tailwind v4 theme (`src/index.css`'s `@theme` block + `.dark` overrides)
  — copy the color tokens verbatim (§4 below has the exact values already
  extracted). This is the single most valuable thing in the DS repo: a
  complete, coherent light+dark palette using OKLCH-free HSL tokens that Just
  Work with Tailwind v4's `@theme` directive.
- `src/lib/utils.ts`'s `cn()` helper (clsx + tailwind-merge) — copy as-is.
- Component source files under `src/components/ui/{base,data-entry,
data-display,feedback,layout,navigation}/` — copy **only the ones this
  plan's component inventory (§7) actually calls for**, not the whole
  directory. Each copied component keeps its DS file structure
  (`React.forwardRef` + `cva` variants) but gets adapted per §5's import
  conventions.
- `LAYOUT_SYSTEM.md`'s spacing rules (4px-multiple padding/gap scale,
  `PageContainer` → `PageHeaderWrapper` → `BlockLayout` page structure) —
  follow this as the layout convention for every migrated page.
- `components.json` shape (adjust `aliases` for this repo's actual paths).

**Skip:**

- Storybook (`.storybook/`, `src/stories/`) — not needed for an internal
  admin app with one live implementation to check against; skip entirely
  unless the user asks for it later.
- The 5 `src/demos/*` example apps — reference material only, already
  consulted while writing this plan. Don't copy them or their mock data.
- `@province-city-china/level`, `city-select.tsx`, `cascader.tsx`,
  `cascader-dropdown.tsx`, `tags-input.tsx`, `file-upload.tsx` — no Dripline
  page needs region pickers, cascading selects, or tag-input widgets right
  now. Skip unless a page-specific need shows up during migration (flag it
  here rather than silently adding scope).
- `date-picker.tsx` / `calendar.tsx` / `react-day-picker` — no page currently
  has a date input (campaigns' `send_at` scheduling field exists on the
  backend but has no UI yet — out of scope for this migration; note it as a
  natural follow-up once this migration lands, since the DS's DatePicker
  would be the obvious component to reach for then).
- `recharts` — Dashboard currently shows plain stat numbers, no charts. Skip
  for this migration; available later if the Dashboard grows analytics.
- `@stagewise/*` devDependencies — a DS-repo-specific dev tool, irrelevant
  here.

---

## 2. Goals

1. Every existing page/feature keeps working identically — same routes, same
   API calls, same validation, same confirm/cancel flows. This is a reskin,
   not a rewrite of behavior.
2. Light, dark, and system theme modes, switchable from the UI, persisted
   across reloads, with no flash-of-wrong-theme on load.
3. Tailwind v4 + shadcn/ui (Radix primitives) replace the hand-rolled
   `index.css` classes (`.card`, `.toolbar`, `.badge`, bare `button`/`input`/
   `select`/`table` selectors, ad hoc inline styles) app-wide.
4. Latest stable versions of every new package at implementation time (see
   §3 — don't hardcode versions in this plan that will be stale by the time
   someone implements it).
5. Consistent layout system (sidebar nav + page container + page header +
   content blocks) across all pages, per the DS's `LAYOUT_SYSTEM.md`.

## 3. Non-goals (explicitly out of scope)

- No backend changes of any kind.
- No new features. (If a page's current UI is missing something the DS
  makes easy — e.g. a real date picker for `send_at` — note it as a
  follow-up suggestion in the PR description, don't build it now.)
- No React major-version bump. Stay on React 18. Reasoning: TinyMCE
  (`@tinymce/tinymce-react`), GrapesJS, and `@uiw/react-codemirror` are
  load-bearing for the content editors built in earlier phases (see
  `DEVELOPMENT_PLAN.md` Phase 8) and are the highest-risk-to-upgrade
  dependencies in this app; don't bundle a React 19 bump into a UI reskin.
  If the implementing agent finds a shadcn/Radix package genuinely requires
  React 19, stop and flag it rather than silently upgrading.
- No Storybook, no port of the DS repo's demo apps.
- Don't touch the content-editor _libraries themselves_
  (`RichTextEditor.tsx`'s TinyMCE config, `VisualEditor.tsx`'s GrapesJS
  mount, `HtmlEditor.tsx`/`MarkdownEditor.tsx`'s CodeMirror setup) beyond
  restyling their _surrounding_ chrome (the mode-switch button row, labels,
  containers). TinyMCE and GrapesJS render into their own DOM/iframe with
  their own theming systems — reskinning their internals is a much bigger,
  separate project with poor ROI for an internal tool. CodeMirror's `theme="dark"`
  prop should probably become theme-aware (see §9's per-page notes) since
  that one's cheap, but don't attempt to reskin TinyMCE/GrapesJS to match
  the new palette.

---

## 4. Design tokens — copy verbatim from the DS repo

Copy `shadcn-tailwind-design-system/src/index.css`'s `@theme` block and
`.dark` override block into `apps/web/src/index.css` (replacing the current
file's hand-rolled `:root` variables), keeping the exact HSL values. Do not
invert Dripline's current dark-only palette to match it approximately — use
the DS's actual light and dark palettes as-is. Reproduced here so the
implementing agent doesn't have to hunt through the DS repo for the exact
values:

```css
@import "tailwindcss";
@import "tw-animate-css";

@theme {
  --color-background: hsl(0 0% 100%);
  --color-foreground: hsl(0 0% 4%);
  --color-card: hsl(0 0% 100%);
  --color-card-foreground: hsl(0 0% 4%);
  --color-popover: hsl(0 0% 100%);
  --color-popover-foreground: hsl(0 0% 4%);
  --color-primary: hsl(213 100% 50%);
  --color-primary-foreground: hsl(0 0% 98%);
  --color-secondary: hsl(0 0% 96%);
  --color-secondary-foreground: hsl(0 0% 9%);
  --color-muted: hsl(0 0% 96%);
  --color-muted-foreground: hsl(0 0% 45%);
  --color-accent: hsl(0 0% 96%);
  --color-accent-foreground: hsl(0 0% 9%);
  --color-destructive: hsl(0 84% 45%);
  --color-destructive-foreground: hsl(0 0% 100%);
  --color-success: hsl(142 76% 36%);
  --color-success-foreground: hsl(0 0% 100%);
  --color-warning: hsl(45 93% 47%);
  --color-warning-foreground: hsl(0 0% 100%);
  --color-border: hsl(0 0% 90%);
  --color-input: hsl(0 0% 90%);
  --color-ring: hsl(0 0% 63%);
  --color-sidebar: hsl(0 0% 96.3%);
  --color-sidebar-foreground: hsl(0 0% 4%);
  --color-sidebar-primary: hsl(0 0% 9%);
  --color-sidebar-primary-foreground: hsl(0 0% 98%);
  --color-sidebar-accent: hsl(0 0% 93.7%);
  --color-sidebar-accent-foreground: hsl(0 0% 9%);
  --color-sidebar-selected: hsl(0 0% 91%);
  --color-sidebar-selected-foreground: hsl(0 0% 9%);
  --color-sidebar-ring: hsl(0 0% 63%);
  --color-container: hsl(0 0% 98.8%);
  --color-container-foreground: hsl(0 0% 4%);
  --color-container-border: hsl(0 0% 90%);
  --color-block-layout: hsl(0 0% 100%);
  --color-block-layout-foreground: hsl(0 0% 4%);
  --color-block-layout-border: hsl(0 0% 90%);

  --font-sans:
    ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
  --font-mono:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New",
    monospace;

  --font-weight-*: initial;
  --font-weight-normal: 400;
  --font-weight-medium: 500;

  --radius: 0.625rem;
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

  --shadow-2xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);
  --shadow-xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);
  --shadow-sm: 0 1px 3px 0px hsl(0 0% 0% / 0.1), 0 1px 2px -1px hsl(0 0% 0% / 0.1);
  --shadow: 0 1px 3px 0px hsl(0 0% 0% / 0.1), 0 1px 2px -1px hsl(0 0% 0% / 0.1);
  --shadow-md: 0 1px 3px 0px hsl(0 0% 0% / 0.1), 0 2px 4px -1px hsl(0 0% 0% / 0.1);
  --shadow-lg: 0 1px 3px 0px hsl(0 0% 0% / 0.1), 0 4px 6px -1px hsl(0 0% 0% / 0.1);
  --shadow-xl: 0 1px 3px 0px hsl(0 0% 0% / 0.1), 0 8px 10px -1px hsl(0 0% 0% / 0.1);
  --shadow-2xl: 0 1px 3px 0px hsl(0 0% 0% / 0.25);

  --spacing: 0.25rem;
}

@layer base {
  .dark {
    --color-background: hsl(0 0% 4%);
    --color-foreground: hsl(0 0% 98%);
    --color-card: hsl(0 0% 9%);
    --color-card-foreground: hsl(0 0% 98%);
    --color-popover: hsl(0 0% 15%);
    --color-popover-foreground: hsl(0 0% 98%);
    --color-primary: hsl(0 0% 90%);
    --color-primary-foreground: hsl(0 0% 9%);
    --color-secondary: hsl(0 0% 15%);
    --color-secondary-foreground: hsl(0 0% 98%);
    --color-muted: hsl(0 0% 15%);
    --color-muted-foreground: hsl(0 0% 63%);
    --color-accent: hsl(0 0% 25%);
    --color-accent-foreground: hsl(0 0% 98%);
    --color-destructive: hsl(0 84% 70%);
    --color-destructive-foreground: hsl(0 0% 98%);
    --color-success: hsl(142 71% 45%);
    --color-success-foreground: hsl(0 0% 98%);
    --color-warning: hsl(45 93% 58%);
    --color-warning-foreground: hsl(0 0% 98%);
    --color-border: hsl(0 0% 16%);
    --color-input: hsl(0 0% 20%);
    --color-ring: hsl(0 0% 45%);
    --color-sidebar: hsl(220 14% 3.5%);
    --color-sidebar-foreground: hsl(0 0% 98%);
    --color-sidebar-primary: hsl(213 79% 50%);
    --color-sidebar-primary-foreground: hsl(0 0% 98%);
    --color-sidebar-accent: hsl(220 14% 8.6%);
    --color-sidebar-accent-foreground: hsl(0 0% 98%);
    --color-sidebar-selected: hsl(220 6% 12.5%);
    --color-sidebar-selected-foreground: hsl(0 0% 98%);
    --color-sidebar-ring: hsl(0 0% 32%);
    --color-container: hsl(220 6% 6.5%);
    --color-container-foreground: hsl(0 0% 98%);
    --color-container-border: hsl(0 0% 16%);
    --color-block-layout: hsl(0 0% 9%);
    --color-block-layout-foreground: hsl(0 0% 98%);
    --color-block-layout-border: hsl(0 0% 16%);
  }

  body {
    background-color: var(--color-background);
    color: var(--color-foreground);
  }

  * {
    border-color: var(--color-border);
  }
}
```

Drop the DS's `chart-*` tokens (no charts in scope, per §3) and the
`scrollbar.css` import (Dripline doesn't have that file; either skip
custom-scrollbar styling entirely, or write an equivalent thin-scrollbar
utility if a component genuinely needs it — don't import a file that
doesn't exist).

**Dripline currently has no light palette at all** — `index.css` today
hardcodes one dark theme with no `.dark`/`.light` class switching. This
migration is what introduces light mode to the app for the first time, not
just a mechanical port.

---

## 5. Package plan

All installed into `apps/web` (not the repo root, not `apps/api`). Use
whatever the actual latest stable version is at implementation time — run
`npm view <package> version` for each before installing rather than trusting
version numbers written in this document, since this plan may be
implemented well after it's written.

**Runtime dependencies to add:**

- `tailwindcss` (v4) + `@tailwindcss/vite` — Tailwind's Vite plugin, no
  PostCSS config file needed (matches the DS repo's setup exactly; simpler
  than the classic PostCSS pipeline).
- `tw-animate-css` — used by the DS's slide/fade utilities (`animate-in`,
  `slide-in-from-*`, etc.) that shadcn's Dialog/Popover/Select/Dropdown
  rely on for enter/exit transitions.
- `class-variance-authority`, `clsx`, `tailwind-merge` — the `cva`/`cn()`
  variant-styling stack every DS component is built on.
- `lucide-react` — icon set used throughout the DS components (nav icons,
  button icons, close/chevron icons in Dialog/Select/etc.).
- Radix UI primitives — add only the ones the component inventory (§7)
  needs: `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`,
  `@radix-ui/react-select`, `@radix-ui/react-checkbox`,
  `@radix-ui/react-radio-group`, `@radix-ui/react-switch`,
  `@radix-ui/react-tabs`, `@radix-ui/react-tooltip`,
  `@radix-ui/react-popover`, `@radix-ui/react-label`,
  `@radix-ui/react-avatar`, `@radix-ui/react-slot`.
- `react-hot-toast` — for a real toast/notification system, replacing the
  ad hoc "inline colored `<span>`/`<p className="error-text">` next to a
  button" pattern used everywhere today for save/delete/test-send
  results. Recommended (matches the DS's own `toast.tsx` wrapper) but see
  §9's per-page notes — this does add a small behavior change (a transient
  toast instead of a persistent inline message), confirm it's acceptable
  per-case rather than blanket-replacing every inline error too (validation
  errors staying inline next to the field they relate to is usually better
  UX than a toast that disappears).

**Dev dependencies to add:**

- `@types/node` if not already present at the workspace level (needed for
  `vite.config.ts`'s `path.resolve` if using the `@/` alias).
- `prettier-plugin-tailwindcss` — add to the **repo-root** `package.json`
  devDependencies (Dripline has one shared root Prettier config,
  `/.prettierrc`) so Tailwind class lists get auto-sorted consistently,
  matching the DS repo's own tooling. Register it in the root `.prettierrc`'s
  `plugins` array.

**Do not add:** Storybook and its addons, `@stagewise/*`,
`@province-city-china/level`, `recharts`, `react-day-picker`,
`@hookform/resolvers`/`react-hook-form` (Dripline's forms are plain
`useState` + manual submit handlers throughout, not React Hook Form — don't
introduce a second forms paradigm; keep using the DS's plain `Input`/
`Select`/etc. components with the existing controlled-component pattern),
`date-fns`, `cmdk` (no command palette in scope), `zod` for the frontend
(the frontend has never used Zod — validation happens server-side and via
native `required`/`type=` attributes; don't add a new validation library
as a side effect of a styling migration).

---

## 6. Setup steps (tooling)

1. `cd apps/web && npm install <packages from §5>`.
2. `vite.config.ts`: add the `@tailwindcss/vite` plugin, and add a `@/*` →
   `apps/web/src/*` resolve alias (needed because shadcn's generated
   components import via `@/components/...` and `@/lib/utils` by
   convention — see §7 for how this interacts with Dripline's existing
   `.js`-suffixed relative-import convention).
3. `apps/web/tsconfig.json`: add matching `"paths": { "@/*": ["./src/*"] }`
   and `"baseUrl": "."` so TypeScript resolves the alias the same way Vite
   does.
4. Create `apps/web/components.json` (shadcn CLI config) modeled on the DS
   repo's, adjusted for this repo:
   ```json
   {
     "$schema": "https://ui.shadcn.com/schema.json",
     "style": "default",
     "rsc": false,
     "tsx": true,
     "tailwind": {
       "css": "src/index.css",
       "baseColor": "slate",
       "cssVariables": true,
       "prefix": ""
     },
     "aliases": {
       "components": "@/components",
       "utils": "@/lib/utils"
     }
   }
   ```
   Whether to actually drive `npx shadcn@latest add <component>` through
   this config, vs. hand-copying+adapting DS repo source files directly, is
   an implementation-time call — hand-copying from the DS repo is likely
   faster and more predictable here since the DS components are already
   customized (custom variants, Chinese comments to translate, the
   IconButton/tooltip-required pattern, etc.) rather than stock shadcn
   output. Either path must produce the same component API described in §7.
5. Replace `apps/web/src/index.css` per §4.
6. Delete the old hand-rolled rules from `index.css` (`.app-shell`,
   `.sidebar`, `.main`, `.page-header`, `.card`, `button`/`.btn`, `input`/
   `select`/`textarea`, `.badge*`, `.toolbar`, `.progress-bar*`, etc.) —
   incrementally, only once every page that referenced a given class has
   been migrated off it (see §10's phased rollout; don't delete a class
   still in use by an unmigrated page, or that page breaks).
7. Set up the FOUC-safe theme bootstrap (§8) in `index.html` before Vite's
   module script.

---

## 7. Component inventory — what to build, mapped from current usage

Build these under `apps/web/src/components/ui/{category}/`, mirroring the
DS's category folders (`base/`, `data-entry/`, `data-display/`, `feedback/`,
`layout/`, `navigation/`), plus export everything from
`apps/web/src/components/ui/index.ts` (matching the DS's own barrel-export
pattern, referenced as `from '../../components/ui'` in its demos).

| Category     | Component                                                                                                                         | Source in DS repo                                                  | Why Dripline needs it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| base         | Button, ButtonWithLoading                                                                                                         | `base/button.tsx`                                                  | Replaces every bare `<button>`/`.secondary`/`.danger` in the app. `ButtonWithLoading` replaces the `{busy ? "Saving…" : "Save"}` text-swap pattern used everywhere (Subscribers, Connections, Templates, Campaigns, Workflows saves/deletes).                                                                                                                                                                                                                                                                                                                                                              |
| base         | Badge                                                                                                                             | `base/badge.tsx`                                                   | Replaces `components/Badge.tsx` (campaign/subscriber/list-membership status pills). Keep Dripline's existing status→color mapping logic, just restyle.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| base         | Avatar, AvatarWithInfo                                                                                                            | `base/avatar.tsx`                                                  | Sidebar footer (current user email + logout), replacing the plain `<div className="muted">{user?.email}</div>`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| base         | Typography                                                                                                                        | `base/typography.tsx`                                              | Page/section headings app-wide (`<h2>`, `<h3>` currently styled ad hoc per-page).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| base         | Dropdown                                                                                                                          | `base/dropdown.tsx`                                                | Theme toggle (§8), sidebar user menu (logout), any other "..." action menus if useful during migration (e.g. table row actions).                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| data-entry   | Input, Textarea                                                                                                                   | `data-entry/input.tsx`, `textarea.tsx`                             | Every form field in the app.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| data-entry   | Select (+ MultiSelectTrigger/MultiSelectItem pattern from Demo1)                                                                  | `data-entry/select.tsx`                                            | Replaces every native `<select>`. Subscribers.tsx's and SubscriberImport.tsx's native `<select multiple>` list-picker needs the DS's multi-select pattern (seen in `Demo1-DataAnalyticsDashboard.tsx`'s `MultiSelectTrigger`/`MultiSelectItem` usage) — check that pattern's actual implementation in `select.tsx` before use, and preserve the exact selected-`listIds` semantics (array of numbers) Subscribers.tsx/SubscriberImport.tsx currently maintain.                                                                                                                                             |
| data-entry   | Checkbox, CheckboxLabel                                                                                                           | `data-entry/checkbox.tsx`                                          | "Preconfirm subscriptions" checkbox (Subscribers.tsx), "Skip TLS verification" / "Use ambient IAM role" (Connections.tsx), tags-list checkboxes if any.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| data-entry   | RadioGroup                                                                                                                        | `data-entry/radio-group.tsx`                                       | SubscriberImport.tsx's Mode (Subscribe/Blocklist) and Status (Unconfirmed/Confirmed) radio pairs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| data-entry   | Switch                                                                                                                            | `data-entry/switch.tsx`                                            | Replaces the hand-rolled `.switch` CSS toggle added in an earlier session (SubscriberImport.tsx's overwrite toggles, Connections.tsx's List-Unsubscribe toggle).                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| data-entry   | Form primitives (FormItem/FormLabel/FormControl/FormRow/FormSection)                                                              | `data-entry/form.tsx`                                              | Structural only — Dripline keeps its own `useState` + manual submit handlers (see §5), just use these for consistent field spacing/label layout instead of the current bare `<label>`+`<input>` pairs. Do **not** pull in the DS's React-Hook-Form-bound form validation pieces if any exist in that file — check first, use only the layout primitives.                                                                                                                                                                                                                                                   |
| data-display | Table + TableWrapper, TableHeader/Body/Row/Head/Cell, StatusCell, ActionCell/ActionButtonsCell, IdCell, NameCell, TableEmptyState | `data-display/table.tsx`                                           | Every list page (Subscribers, Lists, Templates, Campaigns, Workflows, Connections, Dashboard's recent-campaigns table). `StatusCell` should wrap the migrated Badge component. `TableEmptyState` replaces the current `<td colSpan=... className="muted">No X yet.</td>` rows.                                                                                                                                                                                                                                                                                                                             |
| data-display | Tags                                                                                                                              | `data-display/tags.tsx`                                            | SubscriberDetail.tsx's tag pills (currently `<span className="badge draft">`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| feedback     | Alert                                                                                                                             | `feedback/alert.tsx`                                               | Inline page-level errors/warnings (e.g. CampaignDetail's `error` state, SubscriberImport's validation errors) where a persistent, in-context message is more appropriate than a toast (see §5's toast caveat).                                                                                                                                                                                                                                                                                                                                                                                             |
| feedback     | Dialog                                                                                                                            | `feedback/dialog.tsx`                                              | Replaces the custom `components/PreviewModal.tsx`. **Critical:** the current PreviewModal deliberately renders the returned HTML in `<iframe srcDoc={html}>`, not `dangerouslySetInnerHTML`, specifically because a campaign template's own `<style>` block would otherwise leak into the whole admin app's CSS (see `DEVELOPMENT_PLAN.md` §8.4 — this was a real bug that got fixed). When rebuilding PreviewModal on top of shadcn's `Dialog`, keep the iframe — put the `<iframe srcDoc={html}>` inside `DialogContent` instead of the custom modal shell, don't regress back to inline HTML injection. |
| feedback     | Popconfirm                                                                                                                        | `feedback/popconfirm.tsx`                                          | Replaces the bare `confirm(...)` calls used for blocklist/unblocklist/delete actions (SubscriberDetail.tsx, Subscribers.tsx, Connections.tsx, Templates.tsx, Campaigns.tsx, WorkflowDetail.tsx). This is a UX upgrade, not just a reskin — check with the user before replacing native `confirm()` if the implementing agent judges it changes behavior meaningfully (e.g. keyboard/accessibility differences); otherwise prefer it for consistency with the rest of the new UI.                                                                                                                           |
| feedback     | Tooltip                                                                                                                           | `feedback/tooltip.tsx`                                             | Required by the DS's icon-only Button variant (`IconButtonProps` throws if no `tooltip` given) — needed wherever the migration introduces icon-only buttons (e.g. table row action icons, sidebar collapse toggle).                                                                                                                                                                                                                                                                                                                                                                                        |
| feedback     | Skeleton                                                                                                                          | `feedback/skeleton.tsx`                                            | Replaces the current `<p className="muted">Loading…</p>` used while data is being fetched (SubscriberDetail, CampaignDetail, WorkflowDetail, ContentTypeEditor's `Suspense` fallback, etc.).                                                                                                                                                                                                                                                                                                                                                                                                               |
| feedback     | Toast (react-hot-toast wrapper)                                                                                                   | `feedback/toast.tsx`                                               | See §5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| layout       | PageContainer, PageHeader family (`PageHeaderWrapper` etc.), BlockLayout                                                          | `layout/page-container.tsx`, `page-header.tsx`, `block-layout.tsx` | The standard page shell for every migrated page — see §9.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| layout       | Logo                                                                                                                              | `layout/logo.tsx`                                                  | Sidebar header, replacing the plain `<h1>Dripline</h1>`. Dripline has no logo image asset — use `variant="placeholder"` (check what that renders, likely an icon/wordmark fallback) rather than wiring up `lightSrc`/`darkSrc` image paths that don't exist.                                                                                                                                                                                                                                                                                                                                               |
| navigation   | Sidebar family (Header/Content/Menu/MenuItem/MenuButton)                                                                          | `navigation/sidebar.tsx`                                           | Replaces `components/Layout.tsx`'s `<aside className="sidebar">` entirely. Preserve the current nav link list (Dashboard/Subscribers/Lists/Templates/Campaigns/Workflows/Connections/Settings) and active-route highlighting (currently via React Router's `NavLink` — the Sidebar's `isActive` prop on `SidebarMenuButton` should be driven by `useLocation()`/`NavLink`'s render-prop, not reimplemented).                                                                                                                                                                                               |
| navigation   | Tabs                                                                                                                              | `navigation/tabs.tsx`                                              | Not currently used anywhere, but SubscriberDetail.tsx's Lists/Tags sections and CampaignDetail's status/analytics sections could reasonably adopt Tabs if the implementing agent finds it improves the page — optional, not required for parity.                                                                                                                                                                                                                                                                                                                                                           |
| navigation   | Pagination                                                                                                                        | `navigation/pagination.tsx`                                        | Not currently implemented anywhere (Subscribers list has no pagination UI despite the API supporting `limit`/`offset`) — **out of scope**, don't add pagination as a side effect of this migration; only bring this component in if a specific page already needs it.                                                                                                                                                                                                                                                                                                                                      |

**Skip from the DS's nav/feedback set:** `Command` (no command palette),
`Steps` (no multi-step wizard flow exists), `CascaderDropdown` (depends on
the skipped Cascader), `TopNav` (Dripline is sidebar-only, no top nav bar in
the current IA — don't introduce a second navigation surface).

---

## 8. Dark / light / system mode

**Mechanism:** class-based, matching both the DS repo's `.dark` CSS
selector convention and shadcn's standard approach — `<html class="dark">`
for dark, no class (or `class="light"`, matching what `logo.tsx` checks
for) for light. Tailwind's `dark:` variant already works against this by
default in v4 when using a `.dark` class selector.

**Theme provider:** write a small `ThemeProvider` (`apps/web/src/lib/
theme.tsx` or similar) — the DS repo does _not_ ship one (its `logo.tsx`
only _reads_ `.dark`/`.light` classes, it doesn't set them), so this is new
code, not a port. Needs:

- Three modes: `"light" | "dark" | "system"`.
- Persisted to `localStorage` (key e.g. `dripline_theme`, consistent with
  the existing `dripline_token` key naming in `lib/api.ts`).
- `"system"` mode subscribes to
  `window.matchMedia("(prefers-color-scheme: dark)")` and updates live if
  the OS theme changes while the app is open (not just on load).
- Exposes the resolved theme (`"light" | "dark"`) and a setter via context
  (`useTheme()` hook), for the toggle component (§7's Dropdown) to consume.
- Applies the class to `document.documentElement`, not `<body>`.

**FOUC prevention:** add a small inline `<script>` in `index.html`, before
the Vite module script tag, that reads `localStorage` (falling back to
`matchMedia`) and sets the class on `<html>` synchronously before first
paint — the standard shadcn/next-themes pattern. Without this, the page
will flash the wrong theme on every load since React doesn't run until
after the initial HTML parses. Something like:

```html
<script>
  (function () {
    var stored = localStorage.getItem("dripline_theme");
    var dark =
      stored === "dark" ||
      (stored !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  })();
</script>
```

(Adjust the storage key to match whatever `ThemeProvider` actually uses —
keep them in sync, this is the one place outside React that has to agree
with it.)

**Toggle UI:** a `Dropdown`-based control (Light / Dark / System, with
lucide `Sun`/`Moon`/`Monitor` icons per option, matching common shadcn
theme-toggle examples) placed in the sidebar footer near the user
email/logout button. Not a simple two-state light/dark switch — must
expose all three modes distinctly, since "system" is a real third state
(it can currently _resolve_ to either light or dark depending on the OS,
and the UI should show which mode is active vs. which theme it resolved
to).

---

## 9. Layout & page structure

Every page adopts: `PageContainer` (outer shell) → `PageHeaderWrapper`
(title + actions/toolbar) → one or more `BlockLayout`s (content sections,
replacing today's bare `<div className="card">`). Follow
`LAYOUT_SYSTEM.md`'s spacing table (§1) for padding/gap choices rather than
inventing new spacing ad hoc.

`components/Layout.tsx` (the app shell) is rebuilt around the DS's
`Sidebar` family:

- `SidebarHeader`: `Logo` + app name.
- `SidebarContent` → `SidebarMenu` → `SidebarMenuItem`/`SidebarMenuButton`
  per nav link, `isActive` driven by the current route.
- `SidebarFooter` (or an equivalent block at the bottom): current user's
  email (`AvatarWithInfo` or plain text — check what info is available;
  currently just an email string, no avatar image, so `Avatar` will need a
  fallback/initial-letter rendering), the theme toggle (§8), and logout.
- Collapsible sidebar (the DS's `collapsed`/`onCollapsedChange` prop, plus
  `useResponsiveSidebar` from `lib/utils.ts` if that hook is ported) is a
  nice-to-have, not required for parity — Dripline's current sidebar is
  always-expanded, fixed-width. Include collapse support if it's cheap
  given the ported Sidebar component, but don't treat it as a hard
  requirement if it adds meaningful complexity.

### Per-page notes (things to get right, not just "restyle it")

- **`Login.tsx`**: keep the `mode` toggle (login vs. first-time setup)
  and the exact `useAuth()` calls. `PageContainer variant="centered"` fits
  this page's current `.auth-box` narrow-card treatment well.
- **`Dashboard.tsx`**: stat cards → `BlockLayout` grid; recent-campaigns
  table → the new `Table`/`StatusCell` stack; keep the `subscriberCountLabel`
  "200+" cap logic and the `limit=200` fetch as-is.
- **`Subscribers.tsx`**: the Add-subscriber form's Lists field is a native
  `<select multiple>` (added in an earlier session specifically to avoid a
  long checkbox list) — migrate to the DS's multi-select pattern, not back
  to checkboxes. Preserve the Status dropdown, Preconfirm checkbox
  (disabled when no lists selected — keep that disabled-state logic), and
  Attributes JSON textarea exactly.
- **`SubscriberDetail.tsx`**: the Attributes-editing flow (edit-mode toggle,
  JSON validation, Save/Cancel) was a specific bug fix in an earlier
  session — preserve the JSON.parse validation and error message on
  restyle. The list-membership badges (`listMembershipBadge()` helper)
  encode real business logic (single vs. double opt-in status meaning) —
  keep that function's output semantics, just feed it into the new Badge
  component. Blocklist/unblocklist/delete confirms → Popconfirm (§7),
  keeping their exact current warning copy.
- **`SubscriberImport.tsx`**: this is the most complex page in the app —
  CSV parsing, column-mapping table with per-column role dropdowns
  (Ignore/Email/Name/Attributes JSON/Attribute), drag-and-drop file zone,
  batched import with progress. Do **not** touch `lib/csv.ts`'s parser or
  any of the mapping/build-subscriber logic in this file — this page is
  pure restyle. The column-mapping `<table>` with a `<select>` per row is a
  good fit for the new `Table` + `Select` components; the Mode/Status
  radio pairs → `RadioGroup`; the two overwrite toggles → `Switch`; the
  file drop zone (currently a styled `<div>` with `onDrop`/`onDragOver`)
  can keep its current DOM event handling, just restyle the box (the DS
  doesn't have a dedicated dropzone component — `FileUpload` in the skip
  list per §1 handles single-file-picker UI, not necessarily drag-and-drop
  CSV parsing; check if it fits before reusing it, otherwise keep the
  hand-rolled drop zone and just apply Tailwind classes to it).
- **`Templates.tsx`**: the `HtmlEditor` (CodeMirror) stays; only its
  container/labels/buttons get restyled. The default-template seed string
  (`DEFAULT_BODY`, a full styled HTML email with its own `<style>` block)
  is intentionally separate from the app's own Tailwind styling — don't
  touch it. Preview button → keep calling `/templates/preview`, render in
  the migrated Dialog-based PreviewModal (§7).
- **`Campaigns.tsx`, `CampaignNew.tsx`, `CampaignDetail.tsx`**: these three
  share the `ContentTypeEditor` component (§3's TinyMCE/GrapesJS/CodeMirror
  note applies) and the Preview flow (§7's Dialog note applies — this is
  the primary consumer of PreviewModal, in both the new-campaign page and
  both edit-mode/read-only branches of CampaignDetail). CampaignDetail has
  two structurally separate `return` blocks (edit mode vs. read-only,
  `if (editing) { return (...) }` then a second `return (...)`) — both
  need the Preview button and both need their own `<PreviewModal>` render
  (this was a real bug caught during the Preview feature's implementation:
  forgetting the modal in one branch). Keep the connection-chain
  reordering UI (`moveConnection` up/down), the rate-limit `DurationInput`
  component (§7 doesn't list it — decide whether to keep it as a small
  custom component using the new `Input`+`Select` primitives internally,
  or find a DS equivalent; likely keep it custom, restyled), and the
  send-test-email flow's draft-creation-on-first-test behavior in
  `CampaignNew.tsx` (`createdId`/`persist()`).
- **`Connections.tsx`**: SMTP vs. SES conditional form fields, the
  password/secret-key "leave blank to keep current" placeholder pattern,
  and the List-Unsubscribe `Switch` (added in an earlier session) all need
  to survive restyling untouched. `configSummary()`/`rateLimitSummary()`
  display helpers stay.
- **`Workflows.tsx` / `WorkflowDetail.tsx`**: standard list+detail pattern,
  should be straightforward with the new Table/BlockLayout/Badge stack. No
  special notes beyond the general ones.
- **`Settings.tsx`**: API key list + create/reveal-once/revoke flow. The
  "copy this key now, it won't be shown again" one-time reveal card is
  important UX to preserve exactly (an `Alert` with `variant` styled for
  emphasis fits well here).
- **Shared components** (`Badge.tsx`, `ProgressBar.tsx`, `DurationInput.tsx`):
  rebuild on top of the new primitives rather than deleting — other pages
  depend on their current prop APIs (e.g. `Badge`'s `status`/`label`/
  `title` props from the SubscriberDetail work), so keep the same
  component _interface_, just change what's inside.

---

## 10. Rollout sequencing

Migrate incrementally, not as one big-bang rewrite — the app must stay
buildable and functional after every phase, so this can be reviewed and
course-corrected in chunks rather than as one enormous diff.

1. **Phase A — tooling & theme.** §6's setup steps, `ThemeProvider` +
   toggle, `index.html` FOUC script. Verify: app still builds and runs with
   the _old_ CSS still in place (Tailwind coexists with the old
   `index.css` rules during this phase — don't delete old rules yet), and
   the theme toggle actually flips `<html class="dark">` on/off with no
   visible effect yet (since no component uses the new tokens yet).
2. **Phase B — shared shell + base components.** Rebuild `Layout.tsx`
   (Sidebar), and the base component set (Button, Badge, Typography,
   Dropdown, Avatar) plus layout primitives (PageContainer, PageHeader,
   BlockLayout). Migrate **one simple page** end-to-end (recommend
   `Dashboard.tsx` or `Settings.tsx`) as a working proof-of-concept before
   continuing — confirm light/dark/system all render correctly on that one
   page before scaling the pattern to the rest of the app.
3. **Phase C — remaining simple pages.** `Login.tsx`, `Lists.tsx`,
   `Workflows.tsx`, `Campaigns.tsx` (list view), `WorkflowDetail.tsx`. Bring
   in Table/StatusCell/TableEmptyState, Form primitives, Input/Select/
   Checkbox/RadioGroup/Switch as needed.
4. **Phase D — complex CRUD pages.** `Subscribers.tsx`, `SubscriberDetail.tsx`,
   `SubscriberImport.tsx`, `Connections.tsx`, `Templates.tsx`. Bring in
   Dialog (for the rebuilt PreviewModal), Popconfirm, the multi-select
   pattern, Tags.
5. **Phase E — campaign editing.** `CampaignNew.tsx`, `CampaignDetail.tsx`,
   restyle `ContentTypeEditor.tsx`'s chrome (mode-switch buttons, labels)
   and make CodeMirror's `theme` prop follow the app theme if
   straightforward. This phase depends on Phase D's Dialog-based
   PreviewModal being done first.
6. **Phase F — cleanup.** Delete every now-unused rule from `index.css`'s
   old hand-rolled section (confirm with a repo-wide grep that no
   `className="card"` etc. remain first). Full `npm run build` + `npm run
lint` + `npm run format` pass across the whole repo. Manual
   click-through of every page in both light and dark mode (and a system-mode
   check with the OS preference flipped) using the browser tools, the same
   verification rigor established throughout this project's development
   history (real dev server, real clicks, not just "it compiles").

At the end of each phase, run the project's standard verification: `npm run
build`, `npm run lint`, `npm run format`, then a real browser check of the
migrated pages (this repo's established pattern throughout its whole
history — see `DEVELOPMENT_PLAN.md` for the precedent, e.g. Phase 8's
"Status: built and verified in a browser" entries). Don't move to the next
phase with a broken build.

---

## 11. Acceptance criteria (for the later review pass)

When reviewing the implementation against this plan, check:

- [ ] `npm run build`, `npm run lint`, `npm run format` all clean at the repo
      root (covers both `apps/api` — untouched, should still pass — and
      `apps/web`).
- [ ] No remaining references to the deleted `index.css` classes
      (`.card`, `.toolbar`, `.badge*`, `.app-shell`, `.sidebar`, `.main`,
      etc.) — `grep -rn 'className="card"'` (etc.) across `apps/web/src`
      should be empty.
- [ ] Every page in the nav renders in light, dark, and system mode with no
      unstyled/broken-looking elements (check by actually toggling the
      theme in a live browser, not just reading the code).
- [ ] No flash of incorrect theme on a hard page reload, in either
      explicit light or explicit dark mode (test both, not just system).
- [ ] Theme preference persists across a reload and across a fresh tab.
- [ ] The Preview feature (Campaign new/edit, Templates) still renders via
      an iframe (`srcDoc`), not `dangerouslySetInnerHTML` — check the
      rebuilt `PreviewModal`'s source directly, this is the single easiest
      regression to introduce silently.
- [ ] CampaignDetail's Preview button works in **both** the edit-mode and
      read-only render branches (two separate `return`s in that file — easy
      to migrate one and forget the other, as happened once already during
      that feature's original implementation).
- [ ] SubscriberImport's full flow (upload CSV → column mapping →
      import) still works end-to-end against a real API + Postgres, not
      just visually — this page has the most non-trivial client logic in
      the app.
- [ ] All destructive-action confirms (blocklist, unblocklist, delete
      subscriber/connection/template/campaign/API-key) still gate on an
      explicit user confirmation before calling the API, whether that's
      still native `confirm()` or upgraded to Popconfirm.
- [ ] Multi-select list pickers (Subscribers, SubscriberImport) still
      produce the same `number[]` of list IDs the backend expects — check
      the actual POST payload, not just that the UI looks right.
- [ ] No new backend changes crept in (`git diff --stat` should show zero
      touched files under `apps/api/`).
- [ ] No React major-version bump happened without being explicitly
      flagged and discussed first.
