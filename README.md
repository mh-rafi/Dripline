# Dripline

Open-source, self-hosted email campaigns, drip automation, and multi-provider sending.

- [Product Requirements Document](docs/prd/PRD.md)
- [Development Plan](docs/plan/DEVELOPMENT_PLAN.md)
- [Self-hosting guide](docs/self-hosting.md)
- [API reference](docs/api-reference.md)
- [Contributing](CONTRIBUTING.md)

## Status

All planned phases (0–7) have an initial implementation: subscriber/list
management, broadcast campaigns with a crash-safe per-recipient dispatch
engine, multi-provider SMTP sending with failover, drip/event-based
automations, bounce handling, and an admin UI. Not yet battle-tested at
scale or security-audited -- see [Development Plan](docs/plan/DEVELOPMENT_PLAN.md)
for what's next.

## Stack

Node.js, TypeScript, Fastify, PostgreSQL, pg-boss, React. No Prisma — raw SQL
via Kysely and plain migration files, kept deliberately lean (see PRD §5).

## Getting started

### With Docker Compose (recommended)

```bash
git clone <this repo>
cd dripline
docker compose up -d
docker compose exec api npm run migrate
```

- API: `http://localhost:3000` (health check at `/health`)
- Admin UI: `http://localhost:8080`

Set real `JWT_SECRET` / `TRACKING_SECRET` / `APP_URL` env vars before
exposing this outside your machine -- see [self-hosting.md](docs/self-hosting.md).

### Without Docker

```bash
cp apps/api/.env.example apps/api/.env
docker compose up -d postgres   # or point DATABASE_URL at your own Postgres
npm install
npm run migrate
npm run dev            # API + background workers
```

```bash
cd apps/web && npm run dev   # admin UI, separate terminal, http://localhost:5173
```

On first run, open the admin UI and use "First-time setup" on the login
screen to create the initial admin account.
