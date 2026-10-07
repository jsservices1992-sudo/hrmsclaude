import { test } from "node:test";
import assert from "node:assert/strict";
import { verificationErrorCode, verificationErrorMessage } from "./verification-error";

test("wrapped database failures provide actionable feedback without leaking queries", () => {
  const error = { message: "secret SQL", cause: { code: "42703", query: "private data" } };
  assert.equal(verificationErrorCode(error), "42703");
  assert.match(verificationErrorMessage(verificationErrorCode(error)), /migration/);
  assert.doesNotMatch(verificationErrorMessage(verificationErrorCode(error)), /secret|private/);
});

test("conflicts and unknown errors return safe feedback", () => {
  assert.match(verificationErrorMessage("23505"), /existing company row/);
  assert.equal(verificationErrorCode({ code: "postgres://credentials" }), "UNKNOWN");
  const circular: { cause?: unknown } = {};
  circular.cause = circular;
  assert.equal(verificationErrorCode(circular), "UNKNOWN");
});
