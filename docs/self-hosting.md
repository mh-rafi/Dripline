# Self-hosting Dripline

Dripline runs as two services: the API/worker process (Node.js) and Postgres.
There is no Redis or other broker -- background jobs (campaign sending,
automation steps) run through Postgres via `pg-boss`.

## Quick start (Docker Compose)

```bash
git clone https://github.com/<your-org>/dripline.git
cd dripline
cp apps/api/.env.example apps/api/.env   # edit JWT_SECRET, TRACKING_SECRET, APP_URL
docker compose up -d
docker compose exec api npm run migrate
```

Open `http://localhost:3000` (API) and, once the web UI is deployed, its port
(see `apps/web`). The first request to `/api/v1/auth/setup` creates the admin
account -- the web UI's login screen has a "first-time setup" link for this.

## Environment variables

Set these in `apps/api/.env` (see `apps/api/.env.example`):

| Variable          | Required          | Purpose                                                                                                                                                                                                                                                                              |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`    | yes               | Postgres connection string                                                                                                                                                                                                                                                           |
| `PORT`            | no (default 3000) | API port                                                                                                                                                                                                                                                                             |
| `JWT_SECRET`      | yes in production | Signs admin session tokens -- must be a long random value                                                                                                                                                                                                                            |
| `TRACKING_SECRET` | yes in production | Signs open/click/unsubscribe tracking links                                                                                                                                                                                                                                          |
| `APP_URL`         | yes               | Public base URL, used to build tracking/unsubscribe links embedded in emails (must be the origin serving the web app, not the API -- the unsubscribe page is a web app route; in dev this is the Vite dev server's origin, `http://localhost:5173`, which proxies `/api` to the API) |

The insecure defaults baked into `config.ts` are fine for local development
only -- always set real secrets before exposing an instance to the internet.

## Without Docker

Requirements: Node.js 22+ (24 LTS recommended -- what the Docker images use), Postgres 14+.

```bash
npm install
npm run migrate
npm run dev          # runs the API + workers in one process
```

The web UI (`apps/web`) is a separate Vite app:

```bash
cd apps/web
npm run dev
```

In production, build both and run the API's compiled output behind your
reverse proxy of choice, serving `apps/web/dist` as static files (or via the
same proxy) in front of it.

## Upgrading an existing install

Always **stop the API before running `npm run migrate`**, then start it again.
That has always been good practice; as of the pg-boss 12 upgrade it is
required, because one migration recreates pg-boss's own schema and dropping it
under a live pg-boss connection errors that process.

Nothing durable lives in the job queue -- the scan jobs are rebuilt from your
own tables on the next tick (a running campaign re-queues its next dispatch
batch, a contact mid-automation re-queues from `next_run_at`), so no campaign
or automation loses its place across the upgrade.

## Sending providers

Dripline ships with SMTP-only sending in v1 (via Nodemailer), configured from
the admin UI under **Providers**. You can add multiple providers; sends are
distributed across enabled providers by weight, and automatically fail over
to the next provider if one errors. A provider auto-disables after
`max_errors` consecutive failures and must be manually re-enabled.

## Migrating from listmonk

See [`scripts/import-from-listmonk.mjs`](../scripts/import-from-listmonk.mjs) --
imports subscribers, lists, and list memberships directly from a listmonk
Postgres database. Campaigns and templates are not imported (see the script's
header comment for why). Run it with:

```bash
LISTMONK_DATABASE_URL=postgres://... DRIPLINE_DATABASE_URL=postgres://... \
  node scripts/import-from-listmonk.mjs
```

## Backups

Everything lives in Postgres -- back up the database the way you normally
would (`pg_dump`, managed snapshots, etc). There is no other persistent state
on the API host.
