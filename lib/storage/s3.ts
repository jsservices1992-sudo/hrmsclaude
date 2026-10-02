import "server-only";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { isSafeKey } from "./rules";

/**
 * Document storage on any S3-compatible object store.
 *
 * One driver rather than one per vendor, because the differences
 * between Cloudflare R2, Backblaze B2, AWS S3 and MinIO are an endpoint
 * and a region string. That matters more than it sounds: where a
 * company's identity documents live is the kind of decision that gets
 * revisited, and it should stay a change of environment variables
 * rather than a change of code.
 *
 * `forcePathStyle` is on. R2 and MinIO address buckets as a path on the
 * endpoint; only AWS reliably does virtual-host style, and AWS accepts
 * path style too.
 *
 * Nothing here is public. Objects are written with no ACL, and reads go
 * through the same authorised route handlers as every other driver —
 * bytes come back through the application, never a signed URL handed to
 * a browser. A URL that opens a PAN card is a bearer token: whoever
 * receives it by a forwarded email or a log line can open it, and
 * nothing records that they did.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

/** Whether this driver has what it needs, without throwing. */
export function configured(): boolean {
  return Boolean(
    process.env.S3_BUCKET &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY,
  );
}

/**
 * Where uploads are being sent — address and bucket only, never a key —
 * with whatever about that address is likely to be wrong. An endpoint
 * copied from the wrong place in a provider's dashboard is the usual
 * cause of an upload that reaches a server but not a storage API.
 */
export function target(): { endpoint: string; bucket: string; region: string; problems: string[] } {
  const raw = process.env.S3_ENDPOINT ?? "";
  const bucket = process.env.S3_BUCKET ?? "";
  const problems: string[] = [];
  let shown = raw || "(not set — AWS S3 default)";
  if (raw) {
    try {
      const u = new URL(raw);
      shown = `${u.protocol}//${u.host}${u.pathname === "/" ? "" : u.pathname}`;
      if (u.pathname && u.pathname !== "/") {
        problems.push(`S3_ENDPOINT has a path ("${u.pathname}"). It should be only the API address, e.g. https://<account-id>.r2.cloudflarestorage.com — the bucket goes in S3_BUCKET.`);
      }
      if (bucket && u.host.startsWith(`${bucket}.`)) {
        problems.push("S3_ENDPOINT starts with the bucket name. Remove it — the bucket goes only in S3_BUCKET.");
      }
      if (/\.r2\.dev$/i.test(u.host)) {
        problems.push("S3_ENDPOINT is an r2.dev public URL, which serves files to browsers but does not accept uploads. Use the S3 API address: https://<account-id>.r2.cloudflarestorage.com");
      }
      if (/dash\.cloudflare\.com|console\.aws\.amazon\.com|supabase\.com\/dashboard/i.test(u.host + u.pathname)) {
        problems.push("S3_ENDPOINT is a dashboard page, not the storage API address.");
      }
      if (/supabase\.co$/i.test(u.host) && !u.pathname.startsWith("/storage/v1/s3")) {
        problems.push("For Supabase, S3_ENDPOINT must end in /storage/v1/s3.");
      }
      if (u.protocol !== "https:") problems.push("S3_ENDPOINT should start with https://");
    } catch {
      problems.push("S3_ENDPOINT is not a valid web address.");
    }
  }
  return { endpoint: shown, bucket: bucket || "(not set)", region: process.env.S3_REGION ?? "auto", problems };
}

let client: S3Client | null = null;

function s3(): S3Client {
  if (client) return client;
  client = new S3Client({
    /* R2 and B2 ignore the region but the SDK insists on one; "auto" is
       what R2's own documentation uses. */
    region: process.env.S3_REGION ?? "auto",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
  });
  return client;
}

function keyFor(key: string): string {
  if (!isSafeKey(key)) {
    throw new Error(`Refusing an unsafe storage key: ${key}`);
  }
  const prefix = process.env.S3_PREFIX?.replace(/^\/+|\/+$/g, "");
  return prefix ? `${prefix}/${key}` : key;
}

/** Any of the several ways these stores say "no such object". */
function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === "NoSuchKey" ||
    e?.name === "NotFound" ||
    e?.$metadata?.httpStatusCode === 404
  );
}

export async function save(key: string, bytes: Uint8Array): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: required("S3_BUCKET"),
      Key: keyFor(key),
      Body: bytes,
      /* The real type was settled by the magic-number check before this
         was called, so it is not guessed from the extension here. */
      ContentType: "application/octet-stream",
    }),
  );
}

export async function read(key: string): Promise<Uint8Array | null> {
  try {
    const result = await s3().send(
      new GetObjectCommand({ Bucket: required("S3_BUCKET"), Key: keyFor(key) }),
    );
    if (!result.Body) return null;
    return new Uint8Array(await result.Body.transformToByteArray());
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function remove(key: string): Promise<boolean> {
  try {
    /* A delete of something absent succeeds on S3, so existence is
       checked first to report it honestly. */
    if (!(await exists(key))) return false;
    await s3().send(
      new DeleteObjectCommand({ Bucket: required("S3_BUCKET"), Key: keyFor(key) }),
    );
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export async function exists(key: string): Promise<boolean> {
  return (await sizeOf(key)) !== null;
}

export async function sizeOf(key: string): Promise<number | null> {
  try {
    const meta = await s3().send(
      new HeadObjectCommand({ Bucket: required("S3_BUCKET"), Key: keyFor(key) }),
    );
    return meta.ContentLength ?? null;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}
