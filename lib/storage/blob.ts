import "server-only";
import { put, get, del, head, BlobNotFoundError } from "@vercel/blob";
import { isSafeKey } from "./rules";

/**
 * Document storage on Vercel Blob.
 *
 * The disk implementation next door writes to the local filesystem,
 * which on a serverless platform is ephemeral: every PAN card,
 * cancelled cheque and investment proof would be gone on the next
 * deploy. This is the same narrow interface — save, read, remove,
 * exists, sizeOf — backed by durable object storage.
 *
 * Two properties of the disk version are deliberately preserved.
 *
 * Blobs are written with `access: "private"`, so the stored object is
 * not readable by URL. The public-with-an-unguessable-URL option would
 * make every identity document a bearer token: anyone who came by the
 * link — a forwarded email, a log, a browser history — could open it,
 * with no record that they had. Reads therefore go through `get`, which
 * authenticates with the store token server-side, and the bytes are
 * streamed back through the same authorised route handlers as before.
 * Knowing a key remains quite different from being allowed to open it.
 *
 * And the key is the key. `addRandomSuffix` is off so the pathname
 * stored in `employee_documents.storage_ref` is the pathname that comes
 * back; with a suffix the database would hold a reference that no
 * longer resolves.
 */

function keyFor(key: string): string {
  if (!isSafeKey(key)) {
    throw new Error(`Refusing an unsafe storage key: ${key}`);
  }
  return key;
}

export async function save(key: string, bytes: Uint8Array): Promise<void> {
  await put(keyFor(key), Buffer.from(bytes), {
    access: "private",
    addRandomSuffix: false,
    /* A re-upload of the same document replaces it rather than failing;
       the application decides what a document is, not the store. */
    allowOverwrite: true,
    /* The type is decided by the magic-number check before this is
       called, so it is stated rather than guessed from the extension. */
    contentType: "application/octet-stream",
  });
}

export async function read(key: string): Promise<Uint8Array | null> {
  try {
    const result = await get(keyFor(key), { access: "private" });
    if (!result || result.statusCode !== 200) return null;
    const buffer = await new Response(result.stream).arrayBuffer();
    return new Uint8Array(buffer);
  } catch (error) {
    if (error instanceof BlobNotFoundError) return null;
    throw error;
  }
}

export async function remove(key: string): Promise<boolean> {
  try {
    await del(keyFor(key));
    return true;
  } catch (error) {
    if (error instanceof BlobNotFoundError) return false;
    throw error;
  }
}

export async function exists(key: string): Promise<boolean> {
  return (await sizeOf(key)) !== null;
}

export async function sizeOf(key: string): Promise<number | null> {
  try {
    const meta = await head(keyFor(key));
    return meta?.size ?? null;
  } catch (error) {
    if (error instanceof BlobNotFoundError) return null;
    throw error;
  }
}
