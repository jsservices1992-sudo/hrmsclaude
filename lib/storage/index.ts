import "server-only";
import * as disk from "./disk";
import * as blob from "./blob";
import * as s3 from "./s3";

/**
 * Where documents are stored.
 *
 * Any S3-compatible bucket when one is configured, Vercel Blob when
 * that is, and the local filesystem otherwise. All three implement the
 * same narrow interface, so nothing that saves or reads a document
 * knows or cares which is in use.
 *
 * S3 is checked first deliberately. Choosing it is the more explicit
 * act — a bucket, a key pair and an endpoint someone entered on
 * purpose — whereas a Blob token can arrive merely by connecting a
 * store in a dashboard. Whichever was configured on purpose should
 * win.
 *
 * Production must not fall back to disk. A serverless filesystem is
 * ephemeral, so the fallback would appear to work — uploads succeed,
 * the document opens, the checklist goes green — right up to the next
 * deploy, when every file is gone and the database still says they are
 * on record. Refusing is the only honest behaviour.
 *
 * The check runs on first use rather than on import: the build imports
 * this module to collect page data, with NODE_ENV already "production"
 * and no store configured, so refusing at module scope would fail every
 * build. A deployment that is genuinely missing the token still fails,
 * on the first document it touches, loudly.
 */

type Driver = {
  save: (key: string, bytes: Uint8Array) => Promise<void>;
  read: (key: string) => Promise<Uint8Array | null>;
  remove: (key: string) => Promise<boolean>;
  exists: (key: string) => Promise<boolean>;
  sizeOf: (key: string) => Promise<number | null>;
};

function driver(): Driver {
  if (s3.configured()) return s3;
  if (process.env.BLOB_READ_WRITE_TOKEN) return blob;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "No durable document store is configured. Document storage would fall back to a local filesystem that does not survive a deploy, so uploaded documents would be silently lost.",
    );
  }
  return disk;
}

/**
 * Why an upload cannot proceed, or null when it can.
 *
 * `driver()` throws when production has no store configured, which is
 * the right thing to do but the wrong thing to show: thrown out of a
 * server action it becomes an opaque 500 with a digest, and the person
 * uploading a PAN card is told only that a server error occurred. The
 * actions ask this first and say what is actually wrong, to somebody
 * who can fix it.
 */
export function storageUnavailable(): string | null {
  if (storageConfigured()) return null;
  if (process.env.NODE_ENV !== "production") return null;
  return "Document storage is not configured for this deployment, so nothing can be uploaded yet. Point it at an S3-compatible bucket (S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY) or connect a Vercel Blob store, then redeploy.";
}

export function storageConfigured(): boolean {
  return s3.configured() || Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** Which store is in use, so a settings screen can say so plainly. */
export function storageDriverName(): "s3" | "vercel-blob" | "local-disk" {
  if (s3.configured()) return "s3";
  return process.env.BLOB_READ_WRITE_TOKEN ? "vercel-blob" : "local-disk";
}

export function save(key: string, bytes: Uint8Array): Promise<void> {
  return driver().save(key, bytes);
}

/**
 * Explains a store failure in words someone can act on. The store's own
 * error names the cause — a wrong bucket, a rejected key, an endpoint
 * that does not answer — and carries no credential, so it is safe to
 * show to the administrator who has to fix it.
 */
export function describeStorageError(error: unknown): string {
  const e = error as {
    name?: string;
    Code?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
    $response?: { statusCode?: number; headers?: Record<string, string>; body?: unknown };
  };
  const code = e?.Code ?? e?.name ?? "Error";
  const status = e?.$metadata?.httpStatusCode ?? e?.$response?.statusCode;
  const message = (e?.message ?? String(error)).split("\n")[0].replace(/\.+$/, "");

  /* A reply that is not XML came from something other than a storage
     API — a website, a proxy, a dashboard. Who answered, and the first
     words of what it said, usually name the mistake outright. */
  const headers = e?.$response?.headers ?? {};
  const server = headers["server"] ?? headers["Server"];
  const body = typeof e?.$response?.body === "string" ? e.$response.body : "";
  const excerpt = body
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

  const t = s3.configured() ? s3.target() : null;
  const hint =
    status === 540
      ? "540 is Supabase's answer for a paused project — free projects pause after about a week without use. Open the project in the Supabase dashboard and choose Restore; uploads work again once it is running."
      : code === "NoSuchBucket"
      ? "The bucket named in S3_BUCKET does not exist."
      : code === "InvalidAccessKeyId" || code === "SignatureDoesNotMatch" || status === 403
        ? "The storage keys (S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY) were refused, or do not allow writing to this bucket."
        : /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|getaddrinfo/i.test(message)
          ? "The storage endpoint (S3_ENDPOINT) could not be reached."
          : /XML parse|Deserialization/i.test(message)
            ? "The address in S3_ENDPOINT answered, but it is not an S3 storage API."
            : "";

  return [
    `The file could not be stored: ${code}${status ? ` (${status})` : ""} — ${message}.`,
    hint,
    t ? `Uploading to ${t.endpoint}, bucket "${t.bucket}".` : "",
    ...(t?.problems ?? []),
    server ? `Answered by: ${server}.` : "",
    excerpt ? `It said: "${excerpt}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Saves, and turns a store failure into a message instead of a crash.
 * An upload that throws takes the whole page down with an error screen
 * and no reason; this returns the reason, and logs it for the server.
 */
export async function trySave(key: string, bytes: Uint8Array): Promise<string | null> {
  try {
    await save(key, bytes);
    return null;
  } catch (error) {
    console.error(`[storage] save failed for ${key}:`, error);
    return describeStorageError(error);
  }
}

export function read(key: string): Promise<Uint8Array | null> {
  return driver().read(key);
}

export function remove(key: string): Promise<boolean> {
  return driver().remove(key);
}

export function exists(key: string): Promise<boolean> {
  return driver().exists(key);
}

export function sizeOf(key: string): Promise<number | null> {
  return driver().sizeOf(key);
}

/** Pure, and the same either way. */
export { headHex } from "./disk";
