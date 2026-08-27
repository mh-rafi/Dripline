# Media uploads & instance settings

Status: **built & verified** (S3 provider). Filesystem provider: planned, not started.

A media library so campaign and template content can reference images hosted by
the install itself, plus the first real instance-settings surface — the two
arrived together because the uploader has nothing to write to until an admin can
configure a bucket from the UI.

Modelled on listmonk's media subsystem (`internal/media/` + `cmd/media.go`),
with the same S3 configuration fields, but S3 first rather than filesystem
first: the intended deployment is a container behind a proxy, where a local
upload directory is a volume to manage and a backup to remember, and object
storage is neither.

## What was built

### Storage

`apps/api/src/services/media/` — `store.ts` defines the `MediaStore` interface
(`put` / `delete` / `url` / `test`), `s3.ts` implements it over
`@aws-sdk/client-s3`, and `index.ts` holds everything provider-independent
(validation, filename sanitising, DB rows). Adding the filesystem provider is a
second file implementing the same interface plus a branch in `getStore` — no
route or UI change.

The S3 client is cached, keyed by a hash of the S3 settings, so a settings
change takes effect on the next request without an explicit invalidation call
(rebuilding the credential/signing chain per upload is the thing being avoided).

Works against AWS S3 and any S3-compatible store — verified end to end against
MinIO. `force_path_style` defaults to _inferred_: virtual-hosted for
`*.amazonaws.com` endpoints (AWS has deprecated path-style for new buckets),
path-style everywhere else (MinIO and most self-hosted gateways only speak it).
An explicit setting always wins.

Public buckets get a direct URL; private buckets get a pre-signed GET URL,
generated fresh on every read — which is why `MediaItem.url` is computed per
request and never persisted. A configured `public_url` (CDN or custom domain)
wins even on a private bucket: it means something in front is already serving
the objects publicly.

### Data

Migration `1755820800018_settings_and_media.sql`:

- `settings` — `key` / `value` JSONB, one row per group. `media` is the only
  group today; the shape is there so later groups don't need another table.
- `media` — `filename` is the object key **minus** the configured bucket path
  prefix, so changing that prefix later doesn't orphan every existing row.

Upload cleans up after itself: if the DB insert fails after the object is
already in the bucket, the object is deleted rather than left as an orphan
nothing can reference. Delete is the reverse and deliberately lenient — a store
that's since been reconfigured doesn't block removing the row, since the library
listing is what the user actually sees.

Filenames are sanitised to `[a-zA-Z0-9._-]` and de-duplicated with a random
suffix (`logo.png` → `logo_8bbf1ccb.png`), so two files can share a display name
while addressing distinct objects.

### API

`/api/v1/media` (get/manage) and `/api/v1/settings` (get/manage) — see
[../api-reference.md](../api-reference.md) for the shapes. Four new permissions
(`media:get|manage`, `settings:get|manage`) in both mirrored catalogs.

Uploads are `multipart/form-data` via `@fastify/multipart`. The byte cap is
enforced twice: `max_size_mb` from settings as the per-request stream limit, and
`config.bodyLimitBytes` as the outer ceiling that stops a runaway upload being
buffered before the route can reject it.

An unconfigured store returns `400` with a message naming what's missing rather
than a 500, so the media page can point the admin at Settings.

### UI

- **Media** (`/media`, sidebar) — grid with thumbnails for images and an icon
  for everything else, multi-file upload, copy-URL, delete, search, pagination.
- **Settings → Media** (`MediaSettingsForm.tsx`) — provider, permitted
  extensions (tag input, `*` allows everything), max upload size, and the S3
  fields, matching listmonk's settings screen field for field. **Test
  connection** runs HeadBucket against the form's current values, so credentials
  can be checked before they're saved.

The stored secret comes back masked (`••••••••`) and sending the mask back
unchanged keeps it — the same contract as the masked connection credentials, so
the admin UI never holds the real key.

## Verified

Against MinIO on a throwaway bucket: save/read-back with the secret masked and
preserved; test-connection success and each failure mode (missing bucket,
wrong secret, unreachable endpoint, all with mapped messages rather than S3's
bare `UnknownError`); upload with a messy filename (`My Logo (v2).svg` →
`My-Logo-v2-.svg`); duplicate-name suffixing; rejected extension; over-limit
file; list, search, pagination; delete removing the object from the bucket as
well as the row; public-bucket direct URLs and private-bucket pre-signed URLs
both fetching `200`; and the unconfigured-store and unauthenticated paths.

## Not done

- **Filesystem provider.** The interface and the `provider` column are in place
  for it; the settings UI lists S3 only.
- **Thumbnails.** listmonk generates and stores a `thumb_` variant per image.
  The grid renders the original scaled down instead, which costs bandwidth on a
  library of large images. Adding them means an image-processing dependency
  (listmonk uses `disintegration/imaging`; `sharp` is the Node equivalent) —
  deliberately deferred rather than pulled in for a first pass.
- **Picking media from the content editors.** The library exists and exposes
  URLs, but the rich-text/HTML editors still take an image URL by hand. A picker
  dialog reusing the media grid is the obvious next step.
- **Image dimensions.** `media.meta` is in place for `{ width, height }` and is
  currently always `{}` — it needs the same image-decoding dependency as
  thumbnails.
