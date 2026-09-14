import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * API key generation and verification — PRD §3.18.
 *
 * Keys are high-entropy random tokens, not low-entropy user passwords, so
 * a fast deterministic hash (SHA-256) is the right tool: it lets a lookup
 * find the row by hash without an expensive per-row scrypt comparison,
 * and the entropy of the key itself is what actually resists guessing.
 * Only the hash is stored; the plaintext key is shown to the caller once,
 * at creation, and never again.
 */

const KEY_PREFIX = "lekha_";
/** Shown in the UI so an admin can tell keys apart without the secret. */
const DISPLAY_PREFIX_LENGTH = KEY_PREFIX.length + 8;

export function generateApiKey(): { key: string; displayPrefix: string; hash: string } {
  const secret = randomBytes(24).toString("base64url");
  const key = `${KEY_PREFIX}${secret}`;
  return {
    key,
    displayPrefix: key.slice(0, DISPLAY_PREFIX_LENGTH),
    hash: hashApiKey(key),
  };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(KEY_PREFIX) && value.length > KEY_PREFIX.length + 16;
}

/** Constant-time so a timing side channel cannot narrow down a hash byte by byte. */
export function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
