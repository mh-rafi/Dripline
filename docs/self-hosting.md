# Self-hosting Dripline

An install is **one app container plus Postgres**. The app process serves the
admin UI, the API, the tracking endpoints and the unsubscribe page, and runs
the background workers (campaign dispatch, automations, bounce scanning)
in-process. There is no Redis or other broker -- jobs go through Postgres via
`pg-boss`.

Because all of it is one origin on one port, every deployment below is the same
thing wearing different clothes: run the image, give it a database and a public
URL, put TLS in front of it.

Pick one:

| You have                           | Use                                           |
| ---------------------------------- | --------------------------------------------- |
| A plain VPS                        | [Docker Compose](#docker-compose)             |
| Dokploy, Coolify, CapRover         | [A Traefik-based PaaS](#a-traefik-based-paas) |
| An existing Postgres / k8s / Nomad | [Just the image](#just-the-image)             |
| A no-Docker policy                 | [Node.js + systemd](#nodejs--systemd)         |

## Before you start

- A domain (or subdomain) with an A record pointing at the host. Recipients
  load tracking pixels and unsubscribe pages from it, so it has to be publicly
  reachable and should be stable -- changing it later invalidates the links in
  mail you already sent.
- Three secrets. Generate each separately:

  ```bash
  openssl rand -hex 32
  ```

  `JWT_SECRET` signs admin sessions, `TRACKING_SECRET` signs open/click/
  unsubscribe links, and `POSTGRES_PASSWORD` is the database password. **The
  app refuses to start with `NODE_ENV=production` if the first two are unset or
  left at the development defaults** -- those defaults are published in this
  repository, so an instance running on them can be trivially signed into by
  anyone.

- SMTP credentials for whatever actually sends your mail. Dripline does not
  send directly; you add one or more SMTP providers in the admin UI after the
  first login.

## Docker Compose

The default stack: the published image plus Postgres, with the app bound to
`127.0.0.1` so it is not on the internet until you put a proxy in front of it.

```bash
git clone https://github.com/mh-rafi/dripline.git
cd dripline
cp .env.example .env      # fill in APP_URL, JWT_SECRET, TRACKING_SECRET, POSTGRES_PASSWORD
docker compose up -d
```

That is the whole install. Migrations run automatically inside the container
before the app starts, so there is no second command. A fresh install is then
seeded with a default email template (including the unsubscribe footer every
campaign needs); seeding skips any table that already has rows, so it never
touches an existing install's data.

Then give it TLS, either with the bundled Caddy:

```bash
# set APP_DOMAIN in .env (no scheme), and APP_URL to https://that-domain
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
```

or with a reverse proxy you already run -- see
[`deploy/nginx.conf.example`](../deploy/nginx.conf.example). Everything is one
upstream (`127.0.0.1:3000`), so the proxy config is a single `location /`
block; just keep `client_max_body_size` at or above the app's `BODY_LIMIT_MB`,
or large CSV imports fail at the proxy.

To build the image from your checkout instead of pulling a published one:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Building the admin UI needs roughly 2 GB of free RAM. On a small VPS, prefer
the published image -- or build elsewhere and push to your own registry.

## A Traefik-based PaaS

[`docker-compose.dokploy.yml`](../docker-compose.dokploy.yml) is the same stack
with no published ports, joined to the proxy's network so Traefik can route to
it by service name.

**Dokploy:**

1. Create a **Compose** service pointing at this repository.
2. Set the compose path to `./docker-compose.dokploy.yml`.
3. Fill in the **Environment** tab using [`.env.example`](../.env.example) --
   at minimum `APP_URL`, `JWT_SECRET`, `TRACKING_SECRET`, `POSTGRES_PASSWORD`.
4. In **Domains**, add your domain against service `app`, port `3000`, with
   HTTPS and certificate generation enabled.
5. Deploy. `APP_URL` must match that domain exactly, including `https://`.

Upgrades are a redeploy: the container pulls the new image and migrates on
start.

Coolify and CapRover work the same way -- one service from the image, one
Postgres, the same environment variables, the domain routed to port 3000.

## Just the image

For an existing Postgres, or for Kubernetes/Nomad/systemd-nspawn, the image is
self-contained:

```bash
docker run -d --name dripline \
  -e DATABASE_URL=postgres://user:pass@db.internal:5432/dripline \
  -e APP_URL=https://mail.example.com \
  -e JWT_SECRET=... \
  -e TRACKING_SECRET=... \
  -e NODE_ENV=production \
  -p 127.0.0.1:3000:3000 \
  ghcr.io/mh-rafi/dripline:latest
```

It migrates on start (retrying while the database is still coming up), serves
everything on port 3000, and reports readiness at `/health`. Run one replica
unless you have read the note on [multiple replicas](#multiple-replicas).

## Node.js + systemd

Requirements: Node.js 22+ (24 is what the image uses), Postgres 14+.

```bash
sudo useradd --system --home /opt/dripline dripline
sudo git clone https://github.com/mh-rafi/dripline.git /opt/dripline
cd /opt/dripline
sudo -u dripline npm ci
sudo -u dripline npm run build          # builds the API and the admin UI

sudo mkdir -p /etc/dripline
sudo cp .env.example /etc/dripline/dripline.env   # edit it; add DATABASE_URL
sudo chmod 600 /etc/dripline/dripline.env
```

`/etc/dripline/dripline.env` needs `NODE_ENV=production`, `DATABASE_URL`,
`APP_URL`, `JWT_SECRET` and `TRACKING_SECRET`.

```bash
sudo install -m 0644 deploy/dripline.service /etc/systemd/system/dripline.service
sudo systemctl daemon-reload
sudo systemctl enable --now dripline
```

The unit runs migrations before each start. The app finds the built admin UI at
`apps/web/dist` on its own; set `WEB_DIST` if you moved it. Put nginx or Caddy
in front for TLS as above.

## First login

Open your `APP_URL`. The login screen has a **first-time setup** link that
creates the initial admin account (it calls `/api/v1/auth/setup`, which only
works while no admin exists). The link disappears once that account exists, so
on an established install the screen only offers sign-in. Then add an SMTP
provider under **Connections** before sending anything.

While you are there, pick one of those connections under **Settings → System**
as the system email connection and send yourself the test message. That is what
password reset links go out on -- without it, **Forgot password?** silently does
nothing and a locked-out admin has to have their password changed for them from
**Settings → Users**.

## Configuration

| Variable          | Required            | Purpose                                                                                                     |
| ----------------- | ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`    | yes                 | Postgres connection string                                                                                  |
| `APP_URL`         | yes in production   | Public base URL of this install; tracking and unsubscribe links in outgoing mail are built from it          |
| `JWT_SECRET`      | yes in production   | Signs admin sessions. Startup fails if unset or at the dev default                                          |
| `TRACKING_SECRET` | yes in production   | Signs open/click/unsubscribe links. Startup fails if unset or at the dev default                            |
| `NODE_ENV`        | set to `production` | Enables the secret checks above; already set in the image                                                   |
| `PORT`            | no (3000)           | Listen port                                                                                                 |
| `HOST`            | no (`0.0.0.0`)      | Listen address                                                                                              |
| `TRUST_PROXY`     | no (`false`)        | `true` behind any reverse proxy, or a hop count / comma-separated CIDR list. Compose sets it to `true`      |
| `WEB_DIST`        | no (auto)           | Path to the built admin UI. Auto-detected at `apps/web/dist`; unset and absent means API-only               |
| `BODY_LIMIT_MB`   | no (8)              | Max request body. CSV imports post one JSON array, so raise it (and the proxy's limit) for very large files |
| `RUN_MIGRATIONS`  | no (`true`)         | Container only: set `false` to skip the migration run at start                                              |

Compose-only variables (`POSTGRES_PASSWORD`, `APP_DOMAIN`, `BIND_ADDRESS`,
`DRIPLINE_VERSION`, ...) are documented in [`.env.example`](../.env.example).

## Upgrading

Pin `DRIPLINE_VERSION` in `.env` to a release tag if you want upgrades to be
deliberate; otherwise `latest` moves when you pull.

```bash
docker compose pull && docker compose up -d
```

Migrations run inside the new container before the app opens a connection, so
the old "stop the API, migrate, start it again" dance is gone -- including for
the pg-boss schema rebuild that made it necessary.

Nothing durable lives in the job queue: the scan jobs are rebuilt from your own
tables on the next tick (a running campaign re-queues its next dispatch batch,
a contact mid-automation re-queues from `next_run_at`), so no campaign or
automation loses its place across an upgrade.

For the systemd install: `git pull && npm ci && npm run build && sudo
systemctl restart dripline`.

### Multiple replicas

`node-pg-migrate` takes a Postgres advisory lock, so simultaneous starts
migrate safely. The workers are not yet horizontally partitioned, though --
run one app replica and scale vertically until that changes.

## Backups

Everything lives in Postgres. There is no other persistent state on the app
host -- the container's filesystem is disposable.

```bash
docker compose exec -T postgres pg_dump -U dripline dripline | gzip > dripline-$(date +%F).sql.gz
```

Restore into an empty database, then start the app -- it will find the schema
already at the current version and continue.

## Sending providers

SMTP-only in v1 (via Nodemailer), configured in the admin UI under
**Connections**. Add several and sends are distributed across the enabled ones
by weight, failing over to the next when one errors. A provider auto-disables
after `max_errors` consecutive failures and must be re-enabled by hand.

Bounce handling is per-connection: either a webhook, or IMAP mailbox scanning
-- see [mailbox_bounce_scanning.md](plan/mailbox_bounce_scanning.md).

## Troubleshooting

**The app exits immediately with "JWT_SECRET must be set..."** -- working as
intended: set real secrets, see [Before you start](#before-you-start).

**Tracking links in mail point at localhost** -- `APP_URL` was wrong when the
campaign was sent. Fix it and resend; already-sent links can't be rewritten.

**"missing required variable" from `docker compose`** -- `.env` is absent or
incomplete. Copy `.env.example` and fill it in.

**Migrations retry in a loop at startup** -- the app can't reach Postgres.
Check `DATABASE_URL` and that the database container is healthy
(`docker compose ps`).

**`password authentication failed` after changing `POSTGRES_USER` /
`POSTGRES_PASSWORD` / `POSTGRES_DB`** -- those three are read _only_ when
Postgres initialises an empty data directory. Once the volume holds a cluster
they are ignored forever, so changing them after the first deploy leaves the
app using credentials the database has never heard of. Confirm with:

```bash
docker compose exec postgres psql -U dripline -d dripline -c "\du"
```

If that works, the volume was initialised with the defaults. Decide which you
want:

- _No data worth keeping_ -- destroy the volume and redeploy:
  `docker compose down -v && docker compose up -d`. **This deletes every
  subscriber, campaign and automation**, so only do it on a fresh install.
- _Keep the data_ -- leave the env vars at whatever initialised the volume, or
  rename the role in place:
  `ALTER ROLE dripline RENAME TO newname; ALTER ROLE newname WITH PASSWORD '...';`
  (renaming a role clears its `scram` password, so always set a new one in the
  same session).

**The UI loads but every request 401s** -- your token is from an install with a
different `JWT_SECRET`. Sign in again.

**Everything is served but client IPs are all the proxy's** -- set
`TRUST_PROXY=true`.

**Container logs growing without bound** -- Docker's `json-file` driver keeps
every line forever unless told otherwise. Both compose files cap each container
at 3 x 10 MB. If you run the image outside them, pass the same limits:

```bash
docker run --log-opt max-size=10m --log-opt max-file=3 ...
```

or set them once for every container on the host in `/etc/docker/daemon.json`:

```json
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
```

The health endpoint is not logged at all, so an idle install writes nothing.
For a busy one, `LOG_LEVEL=warn` drops the per-request lines -- every tracking
pixel and click-through is a request, so a large send is a lot of them.
