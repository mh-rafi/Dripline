# Dripline

Self-hosted email marketing platform (listmonk-inspired), monorepo:
`apps/api` (Fastify + PostgreSQL + Kysely, no ORM) and `apps/web` (React +
Vite, Tailwind v4 + shadcn/ui, light/dark/system theming).

## Source of truth

- [docs/plan/DEVELOPMENT_PLAN.md](docs/plan/DEVELOPMENT_PLAN.md) — index +
  status table linking to one file per phase under `docs/plan/phases/`.
  Start here, then open the specific phase file you need — each is kept
  current with what's actually been built and verified, not just planned.
- [docs/api-reference.md](docs/api-reference.md) — every endpoint's shape.
- [docs/plan/UI_UX_Plan.md](docs/plan/UI_UX_Plan.md) and
  [docs/plan/subscriber_bulk_actions.md](docs/plan/subscriber_bulk_actions.md) —
  the two most recent large plans (Tailwind/shadcn redesign, subscriber
  bulk actions + pagination), both implemented and reviewed; also linked
  from Phase 6's file.

## Conventions

- Relative imports use explicit `.js` extensions (`from "../lib/api.js"`),
  even though `.ts` files are what actually exist — match this everywhere.
- Zod validates all API input; Kysely for all queries (no raw SQL unless a
  query genuinely doesn't fit the builder — see `sql` tagged-template usage
  in `services/subscribers.ts`/`bulkActions.ts` for the pattern. Never
  hand-build placeholder strings like `$1` yourself — pass values through
  `sql`'s own interpolation so they're parameterized correctly).
- No comments unless explaining a non-obvious _why_ (a bug fix reason, a
  deliberate divergence from an obvious approach).
- Root Prettier/ESLint cover both apps: `npm run build && npm run lint &&
npm run format` before considering anything done.
