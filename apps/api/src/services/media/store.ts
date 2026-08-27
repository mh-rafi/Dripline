import type { MediaSettings } from "../settings.js";

/** What every media provider has to implement. Only S3 exists today; a
 * filesystem provider is planned (see docs/plan/phases/09-media.md), which is
 * why nothing outside this directory constructs a provider directly. */
export interface MediaStore {
  readonly provider: string;
  put(key: string, contentType: string, body: Buffer): Promise<void>;
  delete(key: string): Promise<void>;
  /** May be pre-signed and therefore short-lived, so URLs are resolved on
   * every read rather than persisted alongside the row. */
  url(key: string): Promise<string>;
  /** Cheap reachability/credentials check for the settings UI. */
  test(): Promise<void>;
}

export class MediaConfigError extends Error {}

export function assertConfigured(settings: MediaSettings): void {
  if (settings.provider !== "s3") {
    throw new MediaConfigError(`unsupported media provider: ${settings.provider}`);
  }
  const { s3 } = settings;
  if (!s3.bucket) throw new MediaConfigError("no S3 bucket configured -- set one in Settings");
  if (!s3.region && !s3.url) {
    throw new MediaConfigError("S3 needs either a region or an endpoint URL");
  }
}
