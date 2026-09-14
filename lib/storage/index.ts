import "server-only";
import * as disk from "./disk";
import * as blob from "./blob";

/**
 * Where documents are stored.
 *
 * Vercel Blob when the store is configured, the local filesystem
 * otherwise. The two implement the same narrow interface, so nothing
 * that saves or reads a document knows or cares which is in use.
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
  const hasBlobStore = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  if (!hasBlobStore && process.env.NODE_ENV === "production") {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is not set. Document storage would fall back to a local filesystem that does not survive a deploy, so uploaded documents would be silently lost.",
    );
  }
  return hasBlobStore ? blob : disk;
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
  if (process.env.BLOB_READ_WRITE_TOKEN) return null;
  if (process.env.NODE_ENV !== "production") return null;
  return "Document storage is not configured for this deployment, so nothing can be uploaded yet. Add a Blob store in the Vercel project's Storage tab, set BLOB_READ_WRITE_TOKEN, and redeploy.";
}

/** Which store is in use, so a settings screen can say so plainly. */
export function storageDriverName(): "vercel-blob" | "local-disk" {
  return process.env.BLOB_READ_WRITE_TOKEN ? "vercel-blob" : "local-disk";
}

export function save(key: string, bytes: Uint8Array): Promise<void> {
  return driver().save(key, bytes);
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
