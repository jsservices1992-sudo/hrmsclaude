import test from "node:test";
import assert from "node:assert/strict";
import { certainHolidays, goodFriday, easterSunday, MOVABLE_HOLIDAYS } from "./holidays-india";

test("the three national holidays never move", () => {
  for (const year of [2026, 2027, 2030]) {
    const dates = Object.fromEntries(certainHolidays(year).map((h) => [h.name, h.date]));
    assert.equal(dates["Republic Day"], `${year}-01-26`);
    assert.equal(dates["Independence Day"], `${year}-08-15`);
    assert.equal(dates["Gandhi Jayanti"], `${year}-10-02`);
    assert.equal(dates["Christmas Day"], `${year}-12-25`);
  }
});

test("Easter lands on the days the Church published", () => {
  /* Checked against the published Gregorian Easter dates rather than
     against this implementation's own output. */
  const known: Record<number, string> = {
    2024: "2024-03-31",
    2025: "2025-04-20",
    2026: "2026-04-05",
    2027: "2027-03-28",
    2028: "2028-04-16",
    2030: "2030-04-21",
  };
  for (const [year, date] of Object.entries(known)) {
    assert.equal(easterSunday(Number(year)).toISOString().slice(0, 10), date, `Easter ${year}`);
  }
});

test("Good Friday is the Friday two days before Easter", () => {
  for (const year of [2024, 2025, 2026, 2027, 2028, 2030]) {
    const gf = new Date(goodFriday(year) + "T00:00:00Z");
    assert.equal(gf.getUTCDay(), 5, `${year} must be a Friday`);
    const easter = easterSunday(year);
    assert.equal((easter.getTime() - gf.getTime()) / 86_400_000, 2);
  }
});

test("every seeded holiday is a real date in the year asked for", () => {
  for (const h of certainHolidays(2027)) {
    assert.match(h.date, /^2027-\d{2}-\d{2}$/, h.name);
    assert.ok(!Number.isNaN(Date.parse(h.date)), h.name);
  }
});

test("the movable ones carry no dates, because they move", () => {
  assert.ok(MOVABLE_HOLIDAYS.includes("Diwali (Deepavali)"));
  assert.ok(MOVABLE_HOLIDAYS.includes("Eid-ul-Fitr"));
  for (const name of MOVABLE_HOLIDAYS) {
    assert.doesNotMatch(name, /\d{4}-\d{2}-\d{2}/, "a name, not a date");
  }
});
