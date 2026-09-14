import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarFor,
  trackStatus,
  filingKey,
  type CompanyRegistrations,
} from "./calendar";

const full: CompanyRegistrations = {
  hasPfCode: true,
  hasEsicCode: true,
  hasTan: true,
  branchStates: ["KA", "MH", "TG"],
  ptStates: ["KA", "MH", "TG"],
  lwfStates: ["KA", "MH"],
};

const find = (items: ReturnType<typeof calendarFor>, kind: string, state?: string) =>
  items.find((i) => i.kind === kind && (state ? i.stateCode === state : true));

/* ---------------- derivation ---------------- */

test("a fully registered company owes the central filings every month", () => {
  const items = calendarFor({ registrations: full, periodYear: 2026, periodMonth: 9 });
  assert.ok(find(items, "epf_ecr"));
  assert.ok(find(items, "esic_contribution"));
  assert.ok(find(items, "tds_deposit"));
});

test("no PF code means no ECR is ever listed", () => {
  const items = calendarFor({
    registrations: { ...full, hasPfCode: false },
    periodYear: 2026,
    periodMonth: 9,
  });
  assert.equal(find(items, "epf_ecr"), undefined);
  assert.ok(find(items, "esic_contribution"), "the others are unaffected");
});

test("no ESIC code removes both the monthly and the half-yearly return", () => {
  const items = calendarFor({
    registrations: { ...full, hasEsicCode: false },
    periodYear: 2026,
    periodMonth: 10,
  });
  assert.equal(find(items, "esic_contribution"), undefined);
  assert.equal(find(items, "esic_half_yearly"), undefined);
});

test("no TAN removes the TDS obligations", () => {
  const items = calendarFor({
    registrations: { ...full, hasTan: false },
    periodYear: 2026,
    periodMonth: 6,
  });
  assert.equal(find(items, "tds_deposit"), undefined);
  assert.equal(find(items, "tds_24q"), undefined);
});

test("a state with no branch never appears", () => {
  const items = calendarFor({
    registrations: { ...full, branchStates: ["KA"] },
    periodYear: 2026,
    periodMonth: 9,
  });
  assert.ok(find(items, "pt_return", "KA"));
  assert.equal(find(items, "pt_return", "MH"), undefined);
});

test("a branch in a state that does not levy PT produces no PT return", () => {
  const items = calendarFor({
    registrations: { ...full, branchStates: ["KA"], ptStates: [] },
    periodYear: 2026,
    periodMonth: 9,
  });
  assert.equal(find(items, "pt_return", "KA"), undefined);
});

test("LWF appears only where the state levies it", () => {
  const items = calendarFor({ registrations: full, periodYear: 2026, periodMonth: 6 });
  // Telangana has a branch and PT, but is not in lwfStates
  assert.equal(find(items, "lwf_return", "TG"), undefined);
});

/* ---------------- frequency ---------------- */

test("the ESIC half-yearly return appears only after a period closes", () => {
  // September wages are filed in October — not a half-yearly month
  const sep = calendarFor({ registrations: full, periodYear: 2026, periodMonth: 9 });
  assert.equal(find(sep, "esic_half_yearly"), undefined);

  // October wages are filed in November, when the April-September return is due
  const oct = calendarFor({ registrations: full, periodYear: 2026, periodMonth: 10 });
  assert.ok(find(oct, "esic_half_yearly"));
});

test("Form 24Q appears only in the four filing months", () => {
  const listed = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((m) =>
    find(calendarFor({ registrations: full, periodYear: 2026, periodMonth: m }), "tds_24q"),
  );
  assert.equal(listed.length, 4, `24Q appeared in ${listed.length} months`);
});

test("monthly Haryana LWF appears every month, unlike half-yearly states", () => {
  const reg = {
    ...full,
    branchStates: ["HR", "MH"],
    ptStates: [],
    lwfStates: ["HR", "MH"],
  };
  const june = calendarFor({ registrations: reg, periodYear: 2026, periodMonth: 6 });
  assert.ok(find(june, "lwf_return", "HR"), "Haryana is monthly");
  assert.ok(find(june, "lwf_return", "MH"), "June wages are filed in July, a Maharashtra month");

  const july = calendarFor({ registrations: reg, periodYear: 2026, periodMonth: 7 });
  assert.ok(find(july, "lwf_return", "HR"));
  assert.equal(find(july, "lwf_return", "MH"), undefined, "August is not a Maharashtra month");
});

/* ---------------- due dates ---------------- */

test("a filing is due in the month after the wage month", () => {
  const items = calendarFor({ registrations: full, periodYear: 2026, periodMonth: 9 });
  assert.equal(find(items, "epf_ecr")!.dueDate, "2026-10-15");
});

test("December wages roll into January of the next year", () => {
  const items = calendarFor({ registrations: full, periodYear: 2026, periodMonth: 12 });
  assert.equal(find(items, "epf_ecr")!.dueDate, "2027-01-15");
});

test("March TDS is due on 30 April, not 7 April", () => {
  const items = calendarFor({ registrations: full, periodYear: 2027, periodMonth: 3 });
  assert.equal(find(items, "tds_deposit")!.dueDate, "2027-04-30");

  const feb = calendarFor({ registrations: full, periodYear: 2027, periodMonth: 2 });
  assert.equal(find(feb, "tds_deposit")!.dueDate, "2027-03-07");
});

test("a due day of 31 clamps to the end of a short month", () => {
  // Maharashtra PT is due on the 31st; September wages are due in October
  const items = calendarFor({
    registrations: { ...full, branchStates: ["MH"], lwfStates: [] },
    periodYear: 2026,
    periodMonth: 8,
  });
  // August wages are due in September, which has 30 days
  assert.equal(find(items, "pt_return", "MH")!.dueDate, "2026-09-30");
});

test("items come back sorted by due date", () => {
  const items = calendarFor({ registrations: full, periodYear: 2026, periodMonth: 9 });
  const dates = items.map((i) => i.dueDate);
  assert.deepEqual(dates, [...dates].sort());
});

/* ---------------- status ---------------- */

const items = calendarFor({ registrations: full, periodYear: 2026, periodMonth: 9 });

test("nothing lodged means not started", () => {
  const tracked = trackStatus(items, new Map(), "2026-10-01");
  assert.ok(tracked.every((t) => t.status === "not_started"));
});

test("a past due date with nothing lodged is overdue", () => {
  const tracked = trackStatus(items, new Map(), "2026-11-01");
  assert.ok(tracked.every((t) => t.status === "overdue"));
});

test("a filed item stays filed even after its due date", () => {
  const ecr = items.find((i) => i.kind === "epf_ecr")!;
  const lodged = new Map([
    [
      filingKey(ecr),
      {
        status: "filed" as const,
        reference: "ECR/2026/09/001",
        owner: "payroll@example.com",
        filedAt: "2026-10-14",
      },
    ],
  ]);
  const tracked = trackStatus(items, lodged, "2026-12-01");
  const found = tracked.find((t) => t.kind === "epf_ecr")!;
  assert.equal(found.status, "filed");
  assert.equal(found.filingReference, "ECR/2026/09/001");
});

test("an in-progress item that passes its date becomes overdue", () => {
  const ecr = items.find((i) => i.kind === "epf_ecr")!;
  const lodged = new Map([
    [
      filingKey(ecr),
      { status: "in_progress" as const, reference: null, owner: null, filedAt: null },
    ],
  ]);
  const tracked = trackStatus(items, lodged, "2026-11-01");
  assert.equal(tracked.find((t) => t.kind === "epf_ecr")!.status, "overdue");
});

test("days until due counts down and goes negative once passed", () => {
  const tracked = trackStatus(items, new Map(), "2026-10-10");
  const ecr = tracked.find((t) => t.kind === "epf_ecr")!;
  assert.equal(ecr.daysUntilDue, 5);

  const late = trackStatus(items, new Map(), "2026-10-20");
  assert.equal(late.find((t) => t.kind === "epf_ecr")!.daysUntilDue, -5);
});

test("the filing key distinguishes state filings from each other", () => {
  const ka = filingKey({ kind: "pt_return", stateCode: "KA", periodYear: 2026, periodMonth: 9 });
  const mh = filingKey({ kind: "pt_return", stateCode: "MH", periodYear: 2026, periodMonth: 9 });
  assert.notEqual(ka, mh);
  assert.equal(ka, "pt_return:KA:2026:09");
});

test("the filing key distinguishes periods", () => {
  const sep = filingKey({ kind: "epf_ecr", stateCode: null, periodYear: 2026, periodMonth: 9 });
  const oct = filingKey({ kind: "epf_ecr", stateCode: null, periodYear: 2026, periodMonth: 10 });
  assert.notEqual(sep, oct);
});
