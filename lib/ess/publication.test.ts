import test from "node:test";
import assert from "node:assert/strict";
import {
  isPublishedToEmployee,
  unpublishedReason,
  PUBLISHED_RUN_STATUSES,
} from "./publication";

test("a run in progress is never published to the employee", () => {
  for (const status of ["draft", "inputs_locked", "calculated", "in_review"]) {
    assert.equal(isPublishedToEmployee(status), false, status);
  }
});

test("approval is the point at which figures reach the employee", () => {
  assert.equal(isPublishedToEmployee("approved"), true);
  for (const status of ["finalised", "disbursed", "closed"]) {
    assert.equal(isPublishedToEmployee(status), true, status);
  }
});

test("an unknown status is treated as not published", () => {
  assert.equal(isPublishedToEmployee("something_new"), false);
  assert.equal(isPublishedToEmployee(""), false);
});

test("every published status is explained as available", () => {
  for (const status of PUBLISHED_RUN_STATUSES) {
    assert.equal(isPublishedToEmployee(status), true);
  }
});

test("the reason distinguishes not-run from not-yet-approved", () => {
  assert.match(unpublishedReason(null), /not been run/);
  assert.match(unpublishedReason("calculated"), /not yet approved/);
  assert.match(unpublishedReason("in_review"), /not yet approved/);
  assert.match(unpublishedReason("draft"), /being prepared/);
});
