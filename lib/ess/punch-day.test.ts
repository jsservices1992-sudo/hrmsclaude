import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  applyPunch,
  clockOf,
  durationOf,
  punchDayState,
  type DayPunch,
} from "./punch-day";

const at = (h: number, m = 0) => h * 60 + m;

describe("A day with one in and one out", () => {
  test("an empty day offers the punch in", () => {
    const s = punchDayState([]);
    assert.equal(s.next, "in");
    assert.equal(s.inMinute, null);
    assert.equal(s.doneReason, null);
  });

  test("an open punch offers the punch out and nothing else", () => {
    const s = punchDayState([{ inMinute: at(9, 12), outMinute: null }]);
    assert.equal(s.next, "out");
    assert.equal(s.inMinute, at(9, 12));
    assert.equal(s.outMinute, null);
  });

  test("a closed day offers neither, and says why", () => {
    const s = punchDayState([{ inMinute: at(9, 12), outMinute: at(18, 30) }]);
    assert.equal(s.next, null);
    assert.match(s.doneReason!, /already punched in and out|punched in and out for today/i);
    assert.equal(s.workedMinutes, at(9, 18));
  });

  test("punching in, then out, closes the day", () => {
    const first = applyPunch([], "in", at(9, 12));
    assert.equal(first.ok, true);
    const second = applyPunch(first.ok ? first.punches : [], "out", at(18, 30));
    assert.equal(second.ok, true);
    const s = punchDayState(second.ok ? second.punches : []);
    assert.equal(s.next, null);
    assert.equal(durationOf(s.workedMinutes), "9h 18m");
  });

  test("a second punch in after lunch is refused, not opened as a new shift", () => {
    const day: DayPunch[] = [{ inMinute: at(9, 12), outMinute: at(13, 30) }];
    const again = applyPunch(day, "in", at(14, 15));
    assert.equal(again.ok, false);
    assert.match(again.ok ? "" : again.error, /already punched in and out/i);
  });

  test("a second punch out is refused", () => {
    const day: DayPunch[] = [{ inMinute: at(9, 12), outMinute: at(18, 30) }];
    const again = applyPunch(day, "out", at(19, 0));
    assert.equal(again.ok, false);
  });

  test("punching in twice in a row is refused", () => {
    const day: DayPunch[] = [{ inMinute: at(9, 12), outMinute: null }];
    const again = applyPunch(day, "in", at(9, 40));
    assert.equal(again.ok, false);
    assert.match(again.ok ? "" : again.error, /already punched in/i);
  });

  test("punching out without punching in is refused", () => {
    const r = applyPunch([], "out", at(18, 0));
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /nothing to punch out of/i);
  });

  test("an out before the in is refused rather than stored as negative time", () => {
    const day: DayPunch[] = [{ inMinute: at(9, 12), outMinute: null }];
    const r = applyPunch(day, "out", at(8, 0));
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /before it started/i);
  });

  test("a day HR corrected into two pairs still reads, and stays closed", () => {
    /* The rule is about what the employee may press, not about what the
       record can hold — a correction can leave two pairs on the day. */
    const day: DayPunch[] = [
      { inMinute: at(9, 0), outMinute: at(13, 0) },
      { inMinute: at(14, 0), outMinute: at(18, 0) },
    ];
    const s = punchDayState(day);
    assert.equal(s.next, null);
    assert.equal(s.inMinute, at(9, 0), "the first in of the day");
    assert.equal(s.outMinute, at(18, 0), "the last out of the day");
    assert.equal(durationOf(s.workedMinutes), "8h 00m");
  });
});

describe("Reading the figures", () => {
  test("clock pads both halves", () => {
    assert.equal(clockOf(at(9, 5)), "09:05");
    assert.equal(clockOf(at(18, 30)), "18:30");
    assert.equal(clockOf(0), "00:00");
    assert.equal(clockOf(null), null);
  });

  test("duration reads as hours and minutes", () => {
    assert.equal(durationOf(at(9, 18)), "9h 18m");
    assert.equal(durationOf(45), "0h 45m");
    assert.equal(durationOf(null), null);
  });
});
