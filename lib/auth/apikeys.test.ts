import { test } from "node:test";
import assert from "node:assert/strict";
import { generateApiKey, hashApiKey, looksLikeApiKey, hashesMatch } from "./apikeys";

test("a generated key hashes to the same value it reports, and two keys never collide", () => {
  const a = generateApiKey();
  const b = generateApiKey();
  assert.equal(hashApiKey(a.key), a.hash);
  assert.notEqual(a.key, b.key);
  assert.notEqual(a.hash, b.hash);
});

test("the display prefix is a strict prefix of the key and never carries the whole secret", () => {
  const { key, displayPrefix } = generateApiKey();
  assert.ok(key.startsWith(displayPrefix));
  assert.ok(displayPrefix.length < key.length);
});

test("looksLikeApiKey distinguishes a real key from an arbitrary string", () => {
  const { key } = generateApiKey();
  assert.equal(looksLikeApiKey(key), true);
  assert.equal(looksLikeApiKey("lekha_"), false);
  assert.equal(looksLikeApiKey("Bearer sometoken"), false);
  assert.equal(looksLikeApiKey(""), false);
});

test("hashesMatch is true only for equal hashes, including different-length inputs", () => {
  const { hash } = generateApiKey();
  assert.equal(hashesMatch(hash, hash), true);
  assert.equal(hashesMatch(hash, hashApiKey("something-else")), false);
  assert.equal(hashesMatch(hash, "ab"), false);
});
