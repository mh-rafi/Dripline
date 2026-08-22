# Contributing to Dripline

Thanks for considering a contribution.

## Project layout

- `apps/api` -- Fastify + TypeScript backend: HTTP API, the campaign dispatch
  engine, and the automation (workflow) engine. Background jobs run through
  `pg-boss` (Postgres-backed).
- `apps/web` -- React + Vite admin UI.
- `docs/prd` / `docs/plan` -- the product requirements doc and phased
  development plan this project was built against. Worth reading before a
  large change, so new work fits the existing architecture decisions
  (particularly `docs/prd/PRD.md` §8 on the dispatch model).

## Setup

```bash
npm install
docker compose up -d postgres
cp apps/api/.env.example apps/api/.env
npm run migrate
npm run dev            # API + workers
cd apps/web && npm run dev   # admin UI, separate terminal
```

## Before opening a PR

```bash
npm run format
npm run lint
npm run build
npm test
```

CI runs the same checks against a real Postgres instance.

## Conventions

- No ORM (deliberately -- see PRD §5). Data access goes through Kysely
  (typed query builder) or raw SQL via `kysely`'s `sql` tag for anything
  Kysely's builder can't express cleanly.
- Migrations are plain `.sql` files under `apps/api/migrations`, run with
  `node-pg-migrate`. Name new files `<timestamp>_<description>.sql`.
- Campaign/automation sends must go through the row-per-recipient dispatch
  model (`campaign_emails`, `workflow_enrollments`) -- status only ever
  advances _after_ a provider confirms accept/reject, never optimistically.
  This is the core fix for the delivery-tracking bug documented in the PRD;
  don't reintroduce a checkpoint-before-delivery pattern.
- Keep the stack lean: think twice before adding a new backing service
  (Redis, etc.) -- Postgres-backed alternatives (`pg-boss` for jobs) are
  preferred so self-hosting stays to two containers.

## Reporting bugs / requesting features

Open a GitHub issue with reproduction steps (for bugs) or the use case (for
features). For security issues, please avoid filing a public issue -- see
`SECURITY.md` (if present) or contact the maintainers directly.
