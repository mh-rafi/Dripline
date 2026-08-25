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
- [docs/plan/automations_v2.md](docs/plan/automations_v2.md) — the node-graph
  automation builder that replaces Phases 4/5. Phase 1 built & verified;
  Phases 2–4 (remaining actions, conditional branching, reporting) planned.
  Read it before touching `apps/*/src/automations/`.
- [docs/self-hosting.md](docs/self-hosting.md) — the install guide users follow;
  [docs/plan/deployment.md](docs/plan/deployment.md) — why it's packaged that
  way, and what's left. Read both before touching `Dockerfile`,
  `docker-compose*.yml`, `deploy/`, or anything reading `APP_URL`.
- [docs/plan/UI_UX_Plan.md](docs/plan/UI_UX_Plan.md) and
  [docs/plan/subscriber_bulk_actions.md](docs/plan/subscriber_bulk_actions.md) —
  two earlier large plans (Tailwind/shadcn redesign, subscriber bulk actions
  and pagination), both implemented and reviewed; also linked from Phase 6's
  file.

## Deploying

- One process serves the API, the workers and the admin UI, so an install is a
  single origin on one port. `APP_URL` is that origin — tracking links and the
  unsubscribe page are built from it. Don't split them apart again.
- Migrations run at container start via `deploy/entrypoint.sh`, never as a
  manual step. `docker-compose.yml` is the install stack (needs a filled-in
  `.env`); `docker-compose.dev.yml` is Postgres-only, for working locally.
- Pushes only build the image (`image.yml`); it publishes to GHCR on `v*.*.*`
  tags (`release.yml`).

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
- Automations are registry-driven: a new trigger or action is one entry in
  `apps/api/src/automations/{triggers,actions}.ts` plus its UI counterpart in
  `apps/web/src/automations/{triggers,actions}.tsx` — never a `switch` in the
  engine, the canvas or the sidebar. Graph edges are node-id pointers
  (`next`), not array order, so branching can be added later.
- The root `overrides` pin for `@types/react`/`@types/react-dom` is load-bearing:
  Radix and React Flow declare them as `*` peers, so without it npm hoists a
  second (older) copy and every `ReactNode` stops matching itself. Don't drop it
  while any dependency still peers on `@types/react: "*"`.
- AGPL-3.0-or-later: every new dependency must be license-compatible, and
  anything copyleft goes in `NOTICE`. `GET /api/v1/meta` plus `SOURCE_URL` are
  the section 13 source offer the admin UI links to — don't remove them.
- Root Prettier/ESLint cover both apps: `npm run build && npm run lint &&
npm run format` before considering anything done.

## Verifying

You do not have to in browser after implementation of a feature.
Just tell user what to do in a short message to verify the feature you just implemented.
You'll verify if the code build without error. If possible you can test server side API and code.
But you do not have to write unit test code.
