import test from "node:test";
import assert from "node:assert/strict";
import {
  restrictedHolidayOptions,
  validateRestrictedHoliday,
  type RestrictedHolidayDef,
} from "./restricted";

const holidays: RestrictedHolidayDef[] = [
  { id: "h1", date: "2026-01-14", name: "Makar Sankranti", branchId: null, restricted: true },
  { id: "h2", date: "2026-12-25", name: "Christmas", branchId: null, restricted: true },
  { id: "h3", date: "2026-10-20", name: "Diwali", branchId: null, restricted: false },
  { id: "h4", date: "2026-04-14", name: "Vishu", branchId: "br_kochi", restricted: true },
  { id: "h5", date: "2025-12-25", name: "Christmas", branchId: null, restricted: true },
];

const opts = (branchId = "br_blr", claimedDates: string[] = [], today = "2026-09-14") =>
  restrictedHolidayOptions({ holidays, branchId, year: 2026, claimedDates, today });

test("closed holidays are not on the optional list", () => {
  assert.equal(opts().some((o) => o.name === "Diwali"), false);
});

test("another branch's restricted holiday is not offered", () => {
  assert.equal(opts("br_blr").some((o) => o.name === "Vishu"), false);
  assert.equal(opts("br_kochi").some((o) => o.name === "Vishu"), true);
});

test("a company-wide restricted holiday reaches every branch", () => {
  for (const branch of ["br_blr", "br_kochi", "br_pune"]) {
    assert.equal(opts(branch).some((o) => o.name === "Makar Sankranti"), true, branch);
  }
});

test("only this year's holidays are listed, in date order", () => {
  const list = opts();
  assert.deepEqual(list.map((o) => o.date), ["2026-01-14", "2026-12-25"]);
});

test("what has been and gone is marked past, what is claimed is marked taken", () => {
  const list = opts("br_blr", ["2026-12-25"]);
  const sankranti = list.find((o) => o.date === "2026-01-14")!;
  const christmas = list.find((o) => o.date === "2026-12-25")!;
  assert.equal(sankranti.past, true);
  assert.equal(sankranti.taken, false);
  assert.equal(christmas.past, false);
  assert.equal(christmas.taken, true);
});

const check = (over: Partial<Parameters<typeof validateRestrictedHoliday>[0]> = {}) =>
  validateRestrictedHoliday({
    fromDate: "2026-12-25",
    toDate: "2026-12-25",
    halfDay: false,
    options: opts(),
    claimedCount: 0,
    quota: 2,
    ...over,
  });

test("a published, future, unclaimed date within quota is allowed", () => {
  const r = check();
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.holidayName, "Christmas");
});

test("a restricted holiday is one whole day", () => {
  assert.match(
    (check({ toDate: "2026-12-26" }) as { error: string }).error,
    /single day/,
  );
  assert.match((check({ halfDay: true }) as { error: string }).error, /whole day/);
});

test("a date not on the list is refused rather than quietly allowed", () => {
  const r = check({ fromDate: "2026-11-11", toDate: "2026-11-11" });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /not on your branch/);
});

test("a closed holiday is not a restricted one", () => {
  const r = check({ fromDate: "2026-10-20", toDate: "2026-10-20" });
  assert.equal(r.ok, false);
});

test("the same holiday cannot be claimed twice", () => {
  const r = check({ options: opts("br_blr", ["2026-12-25"]) });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /already claimed Christmas/);
});

test("a restricted holiday is chosen in advance, not backdated", () => {
  const r = check({ fromDate: "2026-01-14", toDate: "2026-01-14" });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /already passed/);
});

test("the quota is enforced, and zero says so plainly", () => {
  const used = check({ claimedCount: 2, quota: 2 });
  assert.equal(used.ok, false);
  assert.match(used.ok === false ? used.error : "", /all 2 of your restricted holidays/);

  const none = check({ claimedCount: 0, quota: 0 });
  assert.equal(none.ok, false);
  assert.match(none.ok === false ? none.error : "", /has not allowed any/);
});

test("the date check runs before the quota check, so the message is the useful one", () => {
  const r = check({ fromDate: "2026-11-11", toDate: "2026-11-11", claimedCount: 9, quota: 2 });
  assert.match(r.ok === false ? r.error : "", /not on your branch/);
});
