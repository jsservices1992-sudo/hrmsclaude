import test from "node:test";
import assert from "node:assert/strict";
import {
  parseTimeToMinutes,
  formatMinutes,
  daysBefore,
  validateRegularisation,
  REGULARISATION_WINDOW_DAYS,
} from "./regularisation";

const base = {
  date: "2026-09-10",
  inTime: "09:30",
  outTime: "18:45",
  reason: "Forgot to punch out, was on a client call.",
  today: "2026-09-14",
  periodPublished: false,
  hasPendingForDate: false,
};

test("times round-trip through minutes", () => {
  assert.equal(parseTimeToMinutes("09:30"), 570);
  assert.equal(parseTimeToMinutes("9:05"), 545);
  assert.equal(parseTimeToMinutes("00:00"), 0);
  assert.equal(parseTimeToMinutes("23:59"), 1439);
  assert.equal(formatMinutes(570), "09:30");
  assert.equal(formatMinutes(0), "00:00");
});

test("a time that is not a time is rejected rather than coerced", () => {
  for (const bad of ["", "9", "24:00", "09:60", "9.30", "nine", "09:30:00"]) {
    assert.equal(parseTimeToMinutes(bad), null, bad);
  }
});

test("a well-formed request produces one punch pair", () => {
  const r = validateRegularisation(base);
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.punches, [{ inMinute: 570, outMinute: 1125 }]);
});

test("a future day cannot be corrected", () => {
  const r = validateRegularisation({ ...base, date: "2026-09-20" });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /has not happened/);
});

test("the window closes after the configured number of days", () => {
  const inside = validateRegularisation({ ...base, date: "2026-08-01" });
  assert.equal(daysBefore("2026-09-14", "2026-08-01"), 44);
  assert.equal(inside.ok, true);

  const outside = validateRegularisation({ ...base, date: "2026-07-31" });
  assert.equal(daysBefore("2026-09-14", "2026-07-31"), 45);
  assert.equal(outside.ok, true, "exactly at the window is still allowed");

  const older = validateRegularisation({ ...base, date: "2026-07-30" });
  assert.equal(older.ok, false);
  assert.match(older.ok === false ? older.error : "", new RegExp(String(REGULARISATION_WINDOW_DAYS)));
});

test("an approved period is settled and sends the employee to HR", () => {
  const r = validateRegularisation({ ...base, periodPublished: true });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /arrear/);
});

test("only one correction may be open per day", () => {
  const r = validateRegularisation({ ...base, hasPendingForDate: true });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /already have a correction/);
});

test("an out time at or before the in time is rejected", () => {
  for (const outTime of ["09:30", "08:00"]) {
    const r = validateRegularisation({ ...base, outTime });
    assert.equal(r.ok, false, outTime);
    assert.match(r.ok === false ? r.error : "", /before the in time/);
  }
});

test("a reason is required, and whitespace is not one", () => {
  for (const reason of ["", "   ", "ok"]) {
    const r = validateRegularisation({ ...base, reason });
    assert.equal(r.ok, false, JSON.stringify(reason));
  }
});
