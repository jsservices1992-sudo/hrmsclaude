import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseDaysWorkedCsv, outcomeForDaysWorked } from "./days-worked";

describe("Reading a days-worked register", () => {
  test("a code and a number is the whole file", () => {
    const { rows, errors } = parseDaysWorkedCsv("JBM00015,13\nJBM00025,25");
    assert.deepEqual(errors, []);
    assert.deepEqual(rows, [
      { empCode: "JBM00015", daysWorked: 13, halfDays: 0 },
      { empCode: "JBM00025", daysWorked: 25, halfDays: 0 },
    ]);
  });

  test("the header and a name column are both tolerated", () => {
    const { rows, errors } = parseDaysWorkedCsv(
      "empCode,name,daysWorked\nJBM00015,BADAL SINGH,13\n",
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(rows, [{ empCode: "JBM00015", daysWorked: 13, halfDays: 0 }]);
  });

  test("half days are read when they are there", () => {
    const { rows } = parseDaysWorkedCsv("empCode,name,daysWorked,halfDays\nE1,Asha,20,2");
    assert.deepEqual(rows, [{ empCode: "E1", daysWorked: 20, halfDays: 2 }]);
  });

  test("zero days is a real answer, not a missing one", () => {
    const { rows, errors } = parseDaysWorkedCsv("E1,0");
    assert.deepEqual(errors, []);
    assert.equal(rows[0].daysWorked, 0);
  });

  test("a line with no number is refused by name", () => {
    const { rows, errors } = parseDaysWorkedCsv("E1,Asha,\nE2,21");
    assert.equal(rows.length, 1);
    assert.match(errors[0].message, /E1 has no number/);
  });

  test("a negative figure is refused", () => {
    const { errors } = parseDaysWorkedCsv("E1,-3");
    assert.match(errors[0].message, /zero or more/);
  });

  test("the same person twice is refused rather than guessed at", () => {
    /* Two different answers for one person is a question for whoever
       wrote the file, not something to resolve by taking the last. */
    const { rows, errors } = parseDaysWorkedCsv("E1,13\nE1,20");
    assert.equal(rows.length, 1);
    assert.match(errors[0].message, /appears twice/);
  });

  test("comments and blank lines are skipped", () => {
    const { rows, errors } = parseDaysWorkedCsv("# a note\n\nE1,13\n");
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 1);
  });
});

describe("What days worked means for the month", () => {
  /* August 2026: 31 days, five Sundays and one holiday — 25 working days. */
  const august = { workingDays: 25, employedDays: 31 };

  test("working every working day is a full month", () => {
    const r = outcomeForDaysWorked({ ...august, daysWorked: 25, halfDays: 0 });
    assert.equal(r.lopDays, 0);
    assert.equal(r.paidDays, 31);
  });

  test("thirteen days worked costs the twelve not worked", () => {
    const r = outcomeForDaysWorked({ ...august, daysWorked: 13, halfDays: 0 });
    assert.equal(r.lopDays, 12);
    assert.equal(r.paidDays, 19);
  });

  test("weekly offs and holidays are paid without being counted", () => {
    /* The answer to the question everybody asks: the 13 does not include
       the Sundays, and the Sundays are paid anyway. */
    const r = outcomeForDaysWorked({ ...august, daysWorked: 13, halfDays: 0 });
    assert.equal(r.paidDays - r.lopDays, 31 - 2 * 12);
    assert.equal(r.paidDays, 13 + 6, "the days worked plus the offs and the holiday");
  });

  test("half days cost half a day each", () => {
    const r = outcomeForDaysWorked({ ...august, daysWorked: 20, halfDays: 2 });
    assert.equal(r.lopDays, 4);
  });

  test("nobody worked is a whole month of loss of pay, not an error", () => {
    const r = outcomeForDaysWorked({ ...august, daysWorked: 0, halfDays: 0 });
    assert.equal(r.lopDays, 25);
    assert.equal(r.paidDays, 6);
  });

  test("more days than the month has is refused, and says why", () => {
    const r = outcomeForDaysWorked({ ...august, daysWorked: 31, halfDays: 0 });
    assert.match(r.problem!, /only 25 working day/);
  });

  test("a mid-month joiner is judged against their own working days", () => {
    // Joined on the 18th: 10 working days, 14 days employed.
    const r = outcomeForDaysWorked({
      workingDays: 10,
      employedDays: 14,
      daysWorked: 8,
      halfDays: 0,
    });
    assert.equal(r.lopDays, 2);
    assert.equal(r.paidDays, 12);
  });
});
