import test from "node:test";
import assert from "node:assert/strict";

/**
 * The driver choice itself, exercised without importing the modules
 * that pull in `server-only` and the Vercel SDK. The rule under test is
 * the one that matters: production never silently falls back to a
 * filesystem that does not survive a deploy.
 */
function chooseDriver(env: { BLOB_READ_WRITE_TOKEN?: string; NODE_ENV?: string }) {
  const hasBlobStore = Boolean(env.BLOB_READ_WRITE_TOKEN);
  if (!hasBlobStore && env.NODE_ENV === "production") {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is not set. Document storage would fall back to a local filesystem that does not survive a deploy, so uploaded documents would be silently lost.",
    );
  }
  return hasBlobStore ? "vercel-blob" : "local-disk";
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
    /BLOB_READ_WRITE_TOKEN is not set/,
  );
});

test("an empty token is not a configured store", () => {
  assert.equal(chooseDriver({ BLOB_READ_WRITE_TOKEN: "", NODE_ENV: "development" }), "local-disk");
  assert.throws(() => chooseDriver({ BLOB_READ_WRITE_TOKEN: "", NODE_ENV: "production" }));
});
