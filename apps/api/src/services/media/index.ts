import { randomBytes } from "node:crypto";
import path from "node:path";
import type { Selectable } from "kysely";
import type { DB } from "../../db/kysely.js";
import type { MediaTable } from "../../db/types.js";
import { BadRequestError } from "../../lib/errors.js";
import { getMediaSettings, type MediaSettings } from "../settings.js";
import { createS3Store } from "./s3.js";
import { assertConfigured, MediaConfigError, type MediaStore } from "./store.js";

export { MediaConfigError } from "./store.js";

export interface MediaItem {
  id: number;
  uuid: string;
  provider: string;
  filename: string;
  content_type: string;
  size: number;
  meta: Record<string, unknown>;
  created_at: string;
  url: string;
}

// Building an S3Client per upload would rebuild the whole credential/signing
// chain each time; the settings hash keys the cache so a settings change
// takes effect on the next request without an explicit invalidation call.
let cached: { key: string; store: MediaStore } | null = null;

export function getStore(settings: MediaSettings): MediaStore {
  assertConfigured(settings);
  const key = JSON.stringify(settings.s3);
  if (cached?.key !== key) cached = { key, store: createS3Store(settings.s3) };
  return cached.store;
}

export async function getStoreFor(db: DB): Promise<{ store: MediaStore; settings: MediaSettings }> {
  const settings = await getMediaSettings(db);
  return { store: getStore(settings), settings };
}

/** The object key inside the bucket. `filename` is stored without the bucket
 * path so the prefix can be changed later without orphaning existing rows. */
function objectKey(settings: MediaSettings, filename: string): string {
  const prefix = settings.s3.bucket_path.replace(/^\/+|\/+$/g, "");
  return prefix ? `${prefix}/${filename}` : filename;
}

/** Strips directory components and anything that isn't safe in a URL path or
 * an object key, then collapses the result. */
export function sanitizeFilename(name: string): string {
  const base = path
    .basename(name)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+/, "");
  const cleaned = base.slice(0, 180);
  return cleaned || "file";
}

function appendSuffix(filename: string, suffix: string): string {
  const ext = path.extname(filename);
  return `${filename.slice(0, filename.length - ext.length)}_${suffix}${ext}`;
}

export function fileExtension(filename: string): string {
  return path.extname(filename).replace(/^\./, "").toLowerCase();
}

export function assertAllowedExtension(settings: MediaSettings, filename: string): void {
  const allowed = settings.extensions.map((e) => e.trim().toLowerCase().replace(/^\./, ""));
  if (allowed.includes("*")) return;
  const ext = fileExtension(filename);
  if (!ext || !allowed.includes(ext)) {
    throw new BadRequestError(`file type ".${ext}" is not allowed`);
  }
}

/** Reserves a filename that doesn't collide with an existing row, adding a
 * random suffix when it does -- two files named logo.png both keep their name
 * in the UI while addressing distinct objects. */
async function uniqueFilename(db: DB, filename: string): Promise<string> {
  let candidate = filename;
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await db
      .selectFrom("media")
      .select("id")
      .where("filename", "=", candidate)
      .executeTakeFirst();
    if (!existing) return candidate;
    candidate = appendSuffix(filename, randomBytes(4).toString("hex"));
  }
  throw new BadRequestError("could not generate a unique filename");
}

async function toItem(
  store: MediaStore,
  settings: MediaSettings,
  row: Selectable<MediaTable>,
): Promise<MediaItem> {
  return {
    id: row.id,
    uuid: row.uuid,
    provider: row.provider,
    filename: row.filename,
    content_type: row.content_type,
    size: Number(row.size),
    meta: row.meta,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    url: await store.url(objectKey(settings, row.filename)),
  };
}

export async function uploadMedia(
  db: DB,
  file: { filename: string; contentType: string; body: Buffer },
): Promise<MediaItem> {
  const settings = await getMediaSettings(db);
  const store = getStore(settings);

  assertAllowedExtension(settings, file.filename);
  const maxBytes = settings.max_size_mb * 1024 * 1024;
  if (file.body.length > maxBytes) {
    throw new BadRequestError(`file is larger than the ${settings.max_size_mb} MB upload limit`);
  }

  const filename = await uniqueFilename(db, sanitizeFilename(file.filename));
  await store.put(objectKey(settings, filename), file.contentType, file.body);

  try {
    const row = await db
      .insertInto("media")
      .values({
        provider: store.provider,
        filename,
        content_type: file.contentType,
        size: String(file.body.length),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return await toItem(store, settings, row);
  } catch (err) {
    // The object is already in the bucket at this point; leaving it there
    // would be an orphan nothing can ever reference or delete.
    await store.delete(objectKey(settings, filename)).catch(() => {});
    throw err;
  }
}

export async function listMedia(
  db: DB,
  opts: { query?: string; type?: "image"; page: number; perPage: number },
): Promise<{ results: MediaItem[]; total: number; page: number; per_page: number }> {
  const { store, settings } = await getStoreFor(db);

  let base = db.selectFrom("media");
  if (opts.query) base = base.where("filename", "ilike", `%${opts.query}%`);
  // Filtered in SQL rather than in the caller so the `total` below stays
  // consistent with the rows -- the editor's image picker paginates on it.
  if (opts.type === "image") base = base.where("content_type", "like", "image/%");

  const { total } = await base
    .select((eb) => eb.fn.countAll<string>().as("total"))
    .executeTakeFirstOrThrow();

  const rows = await base
    .selectAll()
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(opts.perPage)
    .offset((opts.page - 1) * opts.perPage)
    .execute();

  return {
    results: await Promise.all(rows.map((row) => toItem(store, settings, row))),
    total: Number(total),
    page: opts.page,
    per_page: opts.perPage,
  };
}

export async function deleteMedia(db: DB, id: number): Promise<boolean> {
  const row = await db
    .deleteFrom("media")
    .where("id", "=", id)
    .returning(["filename"])
    .executeTakeFirst();
  if (!row) return false;

  // A store that's since been reconfigured (or unconfigured) shouldn't block
  // removing the row -- the library listing is what the user sees.
  try {
    const { store, settings } = await getStoreFor(db);
    await store.delete(objectKey(settings, row.filename));
  } catch (err) {
    if (!(err instanceof MediaConfigError)) throw err;
  }
  return true;
}
