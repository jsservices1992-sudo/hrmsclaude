import "server-only";
import { mkdir, writeFile, readFile, unlink, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { isSafeKey } from "./rules";

/**
 * Local-disk document storage.
 *
 * Files live under ./data/uploads, deliberately outside ./public: nothing
 * here is served statically. Every read goes through an authorised route
 * handler, so knowing a key is not the same as being allowed to open it.
 *
 * The interface is narrow on purpose — save, read, remove, exists — so
 * swapping to an object store later is a new file, not a refactor.
 */

const ROOT = resolve(process.env.UPLOAD_ROOT ?? "./data/uploads");

/**
 * Resolve a key to a path, refusing anything that escapes the root.
 *
 * The key is validated by shape first and then the resolved path is
 * checked against the root as well. Two checks rather than one, because
 * this is the boundary where a traversal bug becomes arbitrary file read.
 */
function pathFor(key: string): string {
  if (!isSafeKey(key)) {
    throw new Error(`Refusing an unsafe storage key: ${key}`);
  }

  const full = resolve(join(ROOT, key));
  if (full !== ROOT && !full.startsWith(ROOT + sep)) {
    throw new Error("Refusing a storage key that escapes the upload root");
  }
  return full;
}

export async function save(key: string, bytes: Uint8Array): Promise<void> {
  const path = pathFor(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

export async function read(key: string): Promise<Uint8Array | null> {
  try {
    return await readFile(pathFor(key));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function remove(key: string): Promise<boolean> {
  try {
    await unlink(pathFor(key));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function exists(key: string): Promise<boolean> {
  try {
    await stat(pathFor(key));
    return true;
  } catch {
    return false;
  }
}

export async function sizeOf(key: string): Promise<number | null> {
  try {
    return (await stat(pathFor(key))).size;
  } catch {
    return null;
  }
}

/** Hex of the first bytes, for the magic-number check. */
export function headHex(bytes: Uint8Array, count = 8): string {
  return Buffer.from(bytes.subarray(0, count)).toString("hex");
}

export const UPLOAD_ROOT = ROOT;
