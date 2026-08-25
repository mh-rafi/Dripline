# Deployment & packaging

**Goal:** one build artifact that deploys the same way everywhere, so the
Dokploy install we run and the `docker compose up -d` a stranger runs are the
same thing, not two code paths that drift.

Companion to [phases/07-hardening.md](phases/07-hardening.md), whose exit
criterion this finishes: _a stranger can `docker compose up`, follow the
README, and send a campaign end to end with no prior context._

## The shape

Dokploy is Traefik plus a Compose runner. Treating it as "the" deployment
target would have meant a second, unexercised path for everyone else, so the
packaging assumes nothing about the host proxy and Dokploy consumes the same
artifact as everything else.

Four supported targets, one image:

| Target                        | Entry point                                         |
| ----------------------------- | --------------------------------------------------- |
| Plain VPS                     | `docker-compose.yml` (+ `docker-compose.caddy.yml`) |
| Dokploy / Coolify / CapRover  | `docker-compose.dokploy.yml`                        |
| Existing Postgres, k8s, Nomad | `ghcr.io/mh-rafi/dripline` directly                 |
| No Docker                     | `deploy/dripline.service` + build from source       |

## Decisions

**One container, not two.** The admin UI is served by the API process via
`@fastify/static`, with a not-found handler falling back to `index.html` for
client-side routes. The previous split (an nginx container proxying `/api` to
an `api` container) was never actually separable: `apps/web/src/lib/api.ts`
calls `/api/v1` on its own origin, and `APP_URL` has to be the origin that
serves _both_ the tracking endpoints (`/api/v1/track/...`) and the unsubscribe
page (a client-side route). Collapsing them removes the nginx layer, the
`api`-service-name coupling, and the main way an install can be misconfigured.

Static assets are cached by path: everything under `assets/` is fingerprinted
by Vite and served `immutable`, `index.html` is `no-cache` so an upgrade never
serves a stale shell pointing at deleted bundles.

**Migrations run at container start.** `node-pg-migrate` moved from
devDependencies to dependencies, and `deploy/entrypoint.sh` runs `up` before
`exec`ing the app, retrying while Postgres is still coming up. This removes the
`docker compose exec api npm run migrate` step (which had no clean home in a
PaaS deploy) and dissolves the "stop the API before migrating" caveat the
pg-boss 12 upgrade introduced -- migrations now always complete before pg-boss
connects. `node-pg-migrate` takes a Postgres advisory lock, so concurrent
starts are safe. `RUN_MIGRATIONS=false` opts out.

**Prebuilt multi-arch images.** The admin UI build pulls TinyMCE, GrapesJS and
React Flow and wants ~2 GB of RAM, which is a coin flip on a small VPS. The
release workflow builds `linux/amd64` and `linux/arm64` on native runners (no
QEMU), pushes by digest, and merges them into one manifest list tagged
`{major}`, `{major}.{minor}`, `{version}` and `latest`. Compose pulls by
default; `docker-compose.build.yml` is the from-source override.

Publishing happens on `v*.*.*` tags only, never on an ordinary push. This is a
public repository, so hosted runners (including the arm64 ones) and public
package storage are free; the budget that can actually be exhausted is the
10 GB per-repository Actions cache, which is why the two build workflows share
one cache scope per architecture.

Because the per-architecture manifests are pushed by digest, they show up as
_untagged_ versions of the GHCR package and the tagged manifest list points at
them. Never run an "delete untagged versions" cleanup against this package.

**Fail closed on dev secrets.** `JWT_SECRET` and `TRACKING_SECRET` had
fallbacks that are published in this repository -- an instance running on them
accepts forged admin sessions and forged unsubscribe signatures. With
`NODE_ENV=production` the app now refuses to start unless both are set to
something else. `APP_URL` is required in production too, since its fallback
(`http://localhost:3000`) silently bakes dead links into sent mail.

**Proxy-aware by default.** `TRUST_PROXY` (Fastify `trustProxy`), a `/health`
healthcheck in the image, `HOST`/`PORT`, and a `BODY_LIMIT_MB` that defaults to
8 MB -- CSV imports post one JSON array of subscribers and outgrew Fastify's
1 MiB default at a few thousand rows. `docker-compose.yml` publishes to
`127.0.0.1` so an install is never accidentally naked on the internet.

## Status

Built:

- `Dockerfile` at the repo root (replaces `apps/api/Dockerfile`,
  `apps/web/Dockerfile` and `apps/web/nginx.conf`), `deploy/entrypoint.sh`,
  `.dockerignore`.
- `docker-compose.yml`, `.build.yml`, `.caddy.yml`, `.dokploy.yml`,
  `.dev.yml`, and a root `.env.example`.
- `deploy/Caddyfile`, `deploy/nginx.conf.example`, `deploy/dripline.service`.
- `.github/workflows/release.yml` (GHCR, multi-arch, tags only) and
  `image.yml`, a no-push build that runs only when something inside the image
  changes and shares its cache scope with the release build. Both workflows
  cancel superseded runs.
- Static serving, `trustProxy`, `bodyLimit`, `HOST`, and the production secret
  checks in `apps/api/src/{app,config}.ts`.
- [../self-hosting.md](../self-hosting.md) rewritten around the four targets.

Verified locally: image builds, `docker compose up -d` brings up a working
install that migrates on start, serves the admin UI and the API on one port,
and passes its healthcheck.

Not done:

- The GHCR image does not exist until the first `v*.*.*` tag is pushed. After
  that first release, check **Packages -> dripline -> Package settings** and
  set the visibility to public: containers published through Actions are not
  automatically public just because the repository is, and a private package
  both blocks anonymous `docker pull` for self-hosters and counts its ~450 MB
  against the account's 500 MB package-storage quota.
- The image name assumes the repository is `mh-rafi/dripline`. Change
  `DRIPLINE_IMAGE` (and the references in the docs) if it lands elsewhere.
- The release workflow has never run; the first tag is also its first test.
- Workers are not horizontally partitioned, so an install is one app replica.
  Scaling out needs claim-based work distribution first.
- No install script, no Helm chart, no image signing/SBOM.
