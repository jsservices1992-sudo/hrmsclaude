import { test } from "node:test";
import assert from "node:assert/strict";
import {
  signWebhookBody,
  verifyWebhookSignature,
  isWebhookEvent,
  parseEventList,
  WEBHOOK_EVENTS,
} from "./signing";

test("a signature verifies against the exact body and secret it was made with", () => {
  const sig = signWebhookBody("s3cret", '{"a":1}');
  assert.equal(verifyWebhookSignature("s3cret", '{"a":1}', sig), true);
});

test("a signature fails if the body changed after signing", () => {
  const sig = signWebhookBody("s3cret", '{"a":1}');
  assert.equal(verifyWebhookSignature("s3cret", '{"a":2}', sig), false);
});

test("a signature fails against the wrong secret", () => {
  const sig = signWebhookBody("s3cret", '{"a":1}');
  assert.equal(verifyWebhookSignature("wrong", '{"a":1}', sig), false);
});

test("signature format is sha256=<hex>", () => {
  const sig = signWebhookBody("s3cret", "body");
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
});

test("isWebhookEvent accepts only the named catalog", () => {
  for (const e of WEBHOOK_EVENTS) assert.equal(isWebhookEvent(e), true);
  assert.equal(isWebhookEvent("employee_deleted"), false);
  assert.equal(isWebhookEvent(""), false);
});

test("parseEventList drops anything not in the catalog rather than storing garbage", () => {
  const list = parseEventList("employee_created, bogus_event ,leave_applied,");
  assert.deepEqual(list, ["employee_created", "leave_applied"]);
});
