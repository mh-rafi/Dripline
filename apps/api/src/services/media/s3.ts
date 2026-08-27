import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { S3Settings } from "../settings.js";
import type { MediaStore } from "./store.js";

function endpoint(s3: S3Settings): string {
  const url = s3.url.trim().replace(/\/+$/, "");
  if (url) return /^https?:\/\//.test(url) ? url : `https://${url}`;
  return `https://s3.${s3.region}.amazonaws.com`;
}

/** AWS has deprecated path-style addressing for new buckets, while MinIO and
 * most self-hosted S3 gateways only speak it -- so the default follows the
 * endpoint, and an explicit setting always wins. */
function usePathStyle(s3: S3Settings): boolean {
  if (s3.force_path_style != null) return s3.force_path_style;
  try {
    return !new URL(endpoint(s3)).hostname.endsWith("amazonaws.com");
  } catch {
    return true;
  }
}

function publicUrl(s3: S3Settings, key: string): string {
  if (s3.public_url.trim()) return `${s3.public_url.trim().replace(/\/+$/, "")}/${key}`;
  const base = endpoint(s3);
  if (usePathStyle(s3)) return `${base}/${s3.bucket}/${key}`;
  const u = new URL(base);
  return `${u.protocol}//${s3.bucket}.${u.host}/${key}`;
}

/** S3 answers HeadBucket with a bare status code and no message, so an
 * unreachable endpoint, a typo'd bucket and a bad key all surface as
 * "UnknownError" -- useless in the settings UI. Turn the status back into
 * something the admin can act on. */
function describeS3Error(err: unknown, bucket: string): string {
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  if (status === 404) return `bucket "${bucket}" does not exist`;
  if (status === 403) return "access denied -- check the access key, secret and bucket permissions";
  if (status === 301) return "wrong region for this bucket";
  const message = err instanceof Error ? err.message : "";
  if (message && message !== "UnknownError") return message;
  return status ? `S3 request failed with HTTP ${status}` : "could not reach the S3 endpoint";
}

export function createS3Store(s3: S3Settings): MediaStore {
  const client = new S3Client({
    // A bucket-only config (MinIO, some R2 setups) still has to send a region
    // for SigV4 to produce a signature at all; "auto" is what R2 documents.
    region: s3.region || "auto",
    endpoint: endpoint(s3),
    forcePathStyle: usePathStyle(s3),
    // No keys means fall through to the SDK's default provider chain, so an
    // instance running on EC2/ECS/EKS can use its IAM role instead.
    ...(s3.access_key_id && s3.secret_access_key
      ? {
          credentials: {
            accessKeyId: s3.access_key_id,
            secretAccessKey: s3.secret_access_key,
          },
        }
      : {}),
  });

  return {
    provider: "s3",

    async put(key, contentType, body) {
      await client.send(
        new PutObjectCommand({
          Bucket: s3.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ...(s3.bucket_type === "public" ? { ACL: "public-read" as const } : {}),
        }),
      );
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: key }));
    },

    async url(key) {
      // A public_url is trusted even on a private bucket: it means the
      // objects are fronted by a CDN or proxy that serves them publicly.
      if (s3.bucket_type === "public" || s3.public_url.trim()) return publicUrl(s3, key);
      return getSignedUrl(client, new GetObjectCommand({ Bucket: s3.bucket, Key: key }), {
        expiresIn: s3.expiry_seconds,
      });
    },

    async test() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: s3.bucket }));
      } catch (err) {
        throw new Error(describeS3Error(err, s3.bucket), { cause: err });
      }
    },
  };
}
