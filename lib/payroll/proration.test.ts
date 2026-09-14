import test from "node:test";
import assert from "node:assert/strict";
import {
  computeProration,
  daysInMonth,
  paidDaysForPeriod,
  periodDivisor,
  prorate,
} from "./proration";

/* A day's pay on ₹15,000 a month, which is the figure the question was
   asked with: ₹500 in a 30-day month, and less in a 31-day one. */
const MONTHLY = 15_000_00;

const dayRate = (year: number, month: number) =>
  Math.round(MONTHLY / periodDivisor({ basis: "calendar_days", year, month }));

test("a day is worth the month it falls in, on the calendar basis", () => {
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 5), 31);
  assert.equal(daysInMonth(2026, 2), 28);

  assert.equal(dayRate(2026, 4), 500_00, "April: 15000/30");
  assert.equal(dayRate(2026, 5), 48387, "May: 15000/31, not 15000/30");
  assert.equal(dayRate(2026, 2), 535_71, "February: 15000/28");
});

test("the other bases are fixed by choice, not by the calendar", () => {
  assert.equal(periodDivisor({ basis: "fixed_30", year: 2026, month: 5 }), 30);
  assert.equal(
    periodDivisor({ basis: "standard_days", year: 2026, month: 5, standardDays: 26 }),
    26,
  );
});

test("a whole month worked is a whole month paid, whatever its length", () => {
  for (const month of [1, 2, 4, 5, 12]) {
    const paidDays = paidDaysForPeriod({
      basis: "calendar_days",
      year: 2026,
      month,
      dateOfJoining: "2020-01-01",
    });
    const result = computeProration({ basis: "calendar_days", year: 2026, month, paidDays });
    assert.equal(
      prorate(MONTHLY, result),
      MONTHLY,
      `month ${month} should pay exactly one month`,
    );
  }
});

test("leaving on the last day of a 31-day month is not 31/30 of a salary", () => {
  const paidDays = paidDaysForPeriod({
    basis: "calendar_days",
    year: 2026,
    month: 5,
    dateOfJoining: "2020-01-01",
    dateOfExit: "2026-05-31",
  });
  const result = computeProration({ basis: "calendar_days", year: 2026, month: 5, paidDays });
  assert.equal(result.divisor, 31);
  assert.equal(prorate(MONTHLY, result), MONTHLY, "a full May is one month, not 31/30");
});

test("working all of February is a full month, not 28/30", () => {
  const paidDays = paidDaysForPeriod({
    basis: "calendar_days",
    year: 2026,
    month: 2,
    dateOfJoining: "2020-01-01",
    dateOfExit: "2026-02-28",
  });
  const result = computeProration({ basis: "calendar_days", year: 2026, month: 2, paidDays });
  assert.equal(prorate(MONTHLY, result), MONTHLY);
});

test("a part month is the days worked over the days the month has", () => {
  const halfMay = computeProration({
    basis: "calendar_days",
    year: 2026,
    month: 5,
    paidDays: paidDaysForPeriod({
      basis: "calendar_days",
      year: 2026,
      month: 5,
      dateOfJoining: "2020-01-01",
      dateOfExit: "2026-05-15",
    }),
  });
  assert.equal(halfMay.basisLabel, "15 / 31 calendar days");
  assert.equal(prorate(MONTHLY, halfMay), Math.round((MONTHLY * 15) / 31));

  const halfApril = computeProration({
    basis: "calendar_days",
    year: 2026,
    month: 4,
    paidDays: paidDaysForPeriod({
      basis: "calendar_days",
      year: 2026,
      month: 4,
      dateOfJoining: "2020-01-01",
      dateOfExit: "2026-04-15",
    }),
  });
  assert.equal(prorate(MONTHLY, halfApril), Math.round((MONTHLY * 15) / 30));
  assert.ok(
    prorate(MONTHLY, halfApril) > prorate(MONTHLY, halfMay),
    "fifteen days of April is worth more than fifteen days of May",
  );
});

test("someone who joins and leaves inside one month is paid only for that span", () => {
  const paidDays = paidDaysForPeriod({
    basis: "calendar_days",
    year: 2026,
    month: 5,
    dateOfJoining: "2026-05-10",
    dateOfExit: "2026-05-20",
  });
  assert.equal(paidDays, 11, "both boundaries are inclusive");
});

test("loss of pay comes off the paid days, not the divisor", () => {
  const paidDays = paidDaysForPeriod({
    basis: "calendar_days",
    year: 2026,
    month: 5,
    dateOfJoining: "2020-01-01",
    lopDays: 3,
  });
  const result = computeProration({ basis: "calendar_days", year: 2026, month: 5, paidDays });
  assert.equal(result.divisor, 31);
  assert.equal(result.paidDays, 28);
});
