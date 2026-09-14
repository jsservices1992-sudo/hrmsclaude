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
