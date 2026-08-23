# Phase 0 — Project scaffolding

**Goal:** an empty but runnable skeleton to build against.

Tasks:

- Repo init, monorepo layout (`apps/api`, `apps/web`).
- TypeScript + Fastify hello-world API, health check endpoint.
- Postgres connection + migration tool (node-pg-migrate) and first migration.
- Docker Compose: app + Postgres only (no Redis).
- Lint/format/test tooling (ESLint, Prettier).
- CI: lint + test on PR.

**Exit criteria:** `docker compose up` boots API + Postgres; `/health` returns 200; CI green
on an empty test.

**Depends on:** nothing.

**Status: built and verified end-to-end.**
