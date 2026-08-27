import { z } from "zod";
import type { DB } from "../db/kysely.js";

/** Sentinel the API sends in place of a stored secret, and accepts back
 * verbatim to mean "keep what's saved" -- same contract as the masked
 * connection credentials in routes/connections.ts. */
export const MASKED_SECRET = "••••••••";

export const S3SettingsSchema = z.object({
  /** S3 API endpoint. Blank means AWS: derived from the region. Any
   * S3-compatible provider (MinIO, R2, Spaces, Wasabi, Backblaze B2) goes
   * here instead. */
  url: z.string().default(""),
  /** Base URL objects are publicly served from (a CDN or custom domain).
   * Blank falls back to the endpoint/bucket URL. */
  public_url: z.string().default(""),
  region: z.string().default(""),
  access_key_id: z.string().default(""),
  secret_access_key: z.string().default(""),
  bucket: z.string().default(""),
  bucket_path: z.string().default(""),
  bucket_type: z.enum(["public", "private"]).default("public"),
  /** Lifetime of the pre-signed GET URLs generated for private buckets.
   * S3 caps pre-signed URLs at 7 days. */
  expiry_seconds: z.number().int().positive().max(604800).default(86400),
  /** Path-style addressing (endpoint/bucket/key) instead of virtual-hosted
   * (bucket.endpoint/key). Left unset it is inferred per provider: AWS gets
   * virtual-hosted, everything else path-style, which is what MinIO and most
   * self-hosted gateways need. */
  force_path_style: z.boolean().nullish().default(null),
});

export const MediaSettingsSchema = z.object({
  provider: z.enum(["s3"]).default("s3"),
  /** Lowercase, no leading dot. A single "*" allows everything. */
  extensions: z
    .array(z.string())
    .default(["jpg", "jpeg", "png", "gif", "svg", "webp", "avif", "pdf"]),
  max_size_mb: z.number().positive().max(1024).default(10),
  s3: S3SettingsSchema.prefault({}),
});

export type S3Settings = z.infer<typeof S3SettingsSchema>;
export type MediaSettings = z.infer<typeof MediaSettingsSchema>;

const GROUPS = { media: MediaSettingsSchema } as const;
export type SettingsGroup = keyof typeof GROUPS;

export type Settings = { [G in SettingsGroup]: z.infer<(typeof GROUPS)[G]> };

async function readGroup<G extends SettingsGroup>(db: DB, group: G): Promise<Settings[G]> {
  const row = await db
    .selectFrom("settings")
    .select("value")
    .where("key", "=", group)
    .executeTakeFirst();
  // Parsing an absent row against the schema is how defaults are produced:
  // a fresh install has no rows and still gets a complete settings object.
  return GROUPS[group].parse(row?.value ?? {}) as Settings[G];
}

export function getMediaSettings(db: DB): Promise<MediaSettings> {
  return readGroup(db, "media");
}

export async function getSettings(db: DB): Promise<Settings> {
  return { media: await getMediaSettings(db) };
}

/** Replaces every masked secret in `next` with the value already stored, so a
 * client that round-trips the redacted settings doesn't wipe the real keys. */
function unmaskSecrets(next: MediaSettings, existing: MediaSettings): MediaSettings {
  return {
    ...next,
    s3: {
      ...next.s3,
      secret_access_key:
        next.s3.secret_access_key === MASKED_SECRET
          ? existing.s3.secret_access_key
          : next.s3.secret_access_key,
    },
  };
}

export function redactSettings(settings: Settings): Settings {
  return {
    media: {
      ...settings.media,
      s3: {
        ...settings.media.s3,
        secret_access_key: settings.media.s3.secret_access_key ? MASKED_SECRET : "",
      },
    },
  };
}

/** Parses client-supplied media settings and restores any masked secret from
 * what's already saved, without persisting anything -- used by the S3 test
 * endpoint so credentials can be verified before they're committed. */
export async function resolveMediaSettings(db: DB, input: unknown): Promise<MediaSettings> {
  return unmaskSecrets(MediaSettingsSchema.parse(input), await getMediaSettings(db));
}

export async function saveMediaSettings(db: DB, input: unknown): Promise<MediaSettings> {
  const value = await resolveMediaSettings(db, input);
  await db
    .insertInto("settings")
    .values({ key: "media", value })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value }))
    .execute();
  return value;
}
