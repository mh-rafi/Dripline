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

### Running an install (Docker)

```bash
cp .env.example .env      # set APP_URL and the secrets it tells you to generate
docker compose up -d
```

One container serves the admin UI, the API and the background workers;
Postgres is the only other moving part. Migrations run on start. Then put a
reverse proxy in front of it for TLS -- or use the bundled Caddy, or deploy the
same stack through Dokploy/Coolify. All four paths, plus a no-Docker systemd
install, are in the [self-hosting guide](docs/self-hosting.md).

### Developing

```bash
cp apps/api/.env.example apps/api/.env
docker compose -f docker-compose.dev.yml up -d   # or point DATABASE_URL at your own Postgres
npm install
npm run migrate
npm run dev            # API + background workers
```

```bash
cd apps/web && npm run dev   # admin UI, separate terminal, http://localhost:5173
```

On first run, open the admin UI and use "First-time setup" on the login
screen to create the initial admin account.

## License

[AGPL-3.0-or-later](LICENSE). You can run Dripline for anything -- personal
projects, your own company's mail, a client's -- and modify it freely. If you
run a **modified** version as a network service, section 13 obliges you to make
that modified source available to its users; point `SOURCE_URL` at it and the
admin UI will link there for you.

Copyright (C) 2026 Mahmudul Hasan. "Dripline" is not licensed under the AGPL --
see [NOTICE](NOTICE). Contributions are accepted under the terms in
[CONTRIBUTING.md](CONTRIBUTING.md).
