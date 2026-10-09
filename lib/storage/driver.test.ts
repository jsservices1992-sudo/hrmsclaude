import test from "node:test";
import assert from "node:assert/strict";
import { resolveStorageProvider } from "./provider";

/**
 * The driver choice itself, exercised without importing the modules
 * that pull in `server-only` and the Vercel SDK. The rule under test is
 * the one that matters: production never silently falls back to a
 * filesystem that does not survive a deploy.
 */
function chooseDriver(env: { BLOB_READ_WRITE_TOKEN?: string; NODE_ENV?: string }) {
  const result = resolveStorageProvider({ production: env.NODE_ENV === "production", s3Configured: false, blobConfigured: Boolean(env.BLOB_READ_WRITE_TOKEN) });
  if (result.error) throw new Error(result.error);
  return result.provider;
}

test("a configured store is used wherever it is configured", () => {
  for (const NODE_ENV of ["development", "test", "production"]) {
    assert.equal(
      chooseDriver({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x", NODE_ENV }),
      "vercel-blob",
      NODE_ENV,
    );
  }
});

test("development falls back to the local filesystem", () => {
  assert.equal(chooseDriver({ NODE_ENV: "development" }), "local-disk");
  assert.equal(chooseDriver({ NODE_ENV: "test" }), "local-disk");
});

test("production refuses to fall back rather than losing documents later", () => {
  assert.throws(
    () => chooseDriver({ NODE_ENV: "production" }),
    /No durable document store/,
  );
});

test("an empty token is not a configured store", () => {
  assert.equal(chooseDriver({ BLOB_READ_WRITE_TOKEN: "", NODE_ENV: "development" }), "local-disk");
  assert.throws(() => chooseDriver({ BLOB_READ_WRITE_TOKEN: "", NODE_ENV: "production" }));
});

const base = { production: true, s3Configured: false, blobConfigured: false };
test("explicit Blob selection wins over existing S3 credentials", () => {
  assert.deepEqual(resolveStorageProvider({ ...base, requested: "vercel-blob", blobConfigured: true, s3Configured: true }), { provider: "vercel-blob", error: null });
});
test("selected Blob never silently falls back to S3 or local disk", () => {
  for (const production of [false, true]) {
    const result = resolveStorageProvider({ ...base, requested: "vercel-blob", s3Configured: true, production });
    assert.equal(result.provider, null);
    assert.match(result.error!, /BLOB_READ_WRITE_TOKEN/);
  }
});
test("legacy automatic selection preserves S3 priority", () => {
  assert.equal(resolveStorageProvider({ ...base, s3Configured: true, blobConfigured: true }).provider, "s3");
  assert.equal(resolveStorageProvider({ ...base, blobConfigured: true }).provider, "vercel-blob");
});
test("production refuses explicitly selected local disk", () => {
  assert.equal(resolveStorageProvider({ ...base, requested: "local-disk", blobConfigured: true }).provider, null);
});
test("invalid and incomplete provider configuration fails closed", () => {
  assert.match(resolveStorageProvider({ ...base, requested: "blob" }).error!, /STORAGE_PROVIDER/);
  assert.equal(resolveStorageProvider({ ...base, requested: "s3", blobConfigured: true }).provider, null);
});
