import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEsicLine,
  formatEsicCsv,
  summariseEsicReturn,
  buildHalfYearlyReturn,
  reconcileEsic,
  periodOf,
  monthsOfPeriod,
  periodLabel,
  type EsicMemberInput,
} from "./esic-return";

const L = (rupees: number) => Math.round(rupees * 100);

const member = (over: Partial<EsicMemberInput> = {}): EsicMemberInput => ({
  ipNumber: "1234567890",
  memberName: "Nisha Pillai",
  empCode: "KA0010",
  daysPaid: 30,
  monthlyWagesPaise: L(18000),
  employeeContributionPaise: L(135),
  employerContributionPaise: L(585),
  lastWorkingDay: null,
  zeroWageReason: "0",
  ...over,
});

/* ---------------- lines ---------------- */

test("a normal line carries wages and both contributions", () => {
  const line = buildEsicLine(member());
  assert.equal(line.monthlyWagesRupees, 18000);
  assert.equal(line.employeeContributionRupees, 135);
  assert.equal(line.employerContributionRupees, 585);
  assert.deepEqual(line.warnings, []);
});

test("a missing insurance number is flagged", () => {
  const line = buildEsicLine(member({ ipNumber: null }));
  assert.equal(line.ipNumber, "");
  assert.ok(line.warnings.some((w) => w.includes("no insurance number")));
});

test("an insurance number that is not ten digits is flagged", () => {
  const line = buildEsicLine(member({ ipNumber: "12345" }));
  assert.ok(line.warnings.some((w) => w.includes("10 digits")));
});

test("zero wages without a reason code is the classic rejection", () => {
  const line = buildEsicLine(
    member({ monthlyWagesPaise: 0, daysPaid: 0, zeroWageReason: "0" }),
  );
  assert.ok(line.warnings.some((w) => w.includes("no reason code")));
});

test("zero wages with a reason code passes cleanly", () => {
  const line = buildEsicLine(
    member({
      monthlyWagesPaise: 0,
      daysPaid: 0,
      employeeContributionPaise: 0,
      employerContributionPaise: 0,
      zeroWageReason: "1",
    }),
  );
  assert.deepEqual(line.warnings, []);
});

test("a reason code alongside real wages is contradictory and flagged", () => {
  const line = buildEsicLine(member({ zeroWageReason: "2" }));
  assert.ok(line.warnings.some((w) => w.includes("while wages were paid")));
});

test("a last working day without a leaving reason is flagged", () => {
  const line = buildEsicLine(member({ lastWorkingDay: "2026-09-20" }));
  assert.ok(line.warnings.some((w) => w.includes("not marked as having left")));
});

test("an impossible day count is flagged", () => {
  const line = buildEsicLine(member({ daysPaid: 40 }));
  assert.ok(line.warnings.some((w) => w.includes("not possible")));
});

/* ---------------- CSV ---------------- */

test("the CSV carries a header row and one row per member", () => {
  const csv = formatEsicCsv([
    buildEsicLine(member({ empCode: "A" })),
    buildEsicLine(member({ empCode: "B" })),
  ]);
  const rows = csv.trimEnd().split("\n");
  assert.equal(rows.length, 3);
  assert.ok(rows[0].startsWith("IP Number,IP Name"));
});

test("a name containing a comma is quoted rather than breaking the row", () => {
  const csv = formatEsicCsv([
    buildEsicLine(member({ memberName: "Pillai, Nisha" })),
  ]);
  const row = csv.trimEnd().split("\n")[1];
  assert.ok(row.includes('"PILLAI, NISHA"'));
  assert.equal(row.split(",").length, 7, "the quoted comma does not add a field");
});

test("a name containing a quote is escaped", () => {
  const csv = formatEsicCsv([buildEsicLine(member({ memberName: 'A "B" C' }))]);
  assert.ok(csv.includes('"A ""B"" C"'));
});

/* ---------------- summary ---------------- */

test("the summary totals both shares", () => {
  const s = summariseEsicReturn([
    buildEsicLine(member({ empCode: "A" })),
    buildEsicLine(member({ empCode: "B" })),
  ]);
  assert.equal(s.memberCount, 2);
  assert.equal(s.employeeContributionPaise, L(270));
  assert.equal(s.employerContributionPaise, L(1170));
  assert.equal(s.totalPayablePaise, L(1440));
});

test("employees awaiting an insurance number are listed, not silently dropped", () => {
  const s = summariseEsicReturn([
    buildEsicLine(member({ empCode: "A" })),
    buildEsicLine(member({ empCode: "B", ipNumber: null })),
  ]);
  assert.equal(s.pendingIpNumbers.length, 1);
  assert.equal(s.pendingIpNumbers[0].empCode, "B");
  assert.ok(
    s.warnings.some((w) => w.includes("the contribution is still due")),
  );
});

test("zero-wage members are counted", () => {
  const s = summariseEsicReturn([
    buildEsicLine(member({ empCode: "A" })),
    buildEsicLine(
      member({ empCode: "B", monthlyWagesPaise: 0, zeroWageReason: "1" }),
    ),
  ]);
  assert.equal(s.zeroWageCount, 1);
});

/* ---------------- contribution periods ---------------- */

test("the contribution periods run April to September and October to March", () => {
  assert.equal(periodOf(4), "apr_sep");
  assert.equal(periodOf(9), "apr_sep");
  assert.equal(periodOf(10), "oct_mar");
  assert.equal(periodOf(3), "oct_mar");
  assert.equal(periodOf(1), "oct_mar");
});

test("the October period spans a calendar year boundary", () => {
  assert.deepEqual(monthsOfPeriod("oct_mar"), [10, 11, 12, 1, 2, 3]);
  assert.equal(periodLabel("oct_mar", 2026), "October 2026 to March 2027");
});

test("a complete half-year totals its six months", () => {
  const r = buildHalfYearlyReturn({
    period: "apr_sep",
    year: 2026,
    monthly: monthsOfPeriod("apr_sep").map((month) => ({
      month,
      memberCount: 10,
      totalWagesPaise: L(180000),
      totalPayablePaise: L(7200),
    })),
  });
  assert.equal(r.complete, true);
  assert.equal(r.totalPayablePaise, L(43200));
  assert.deepEqual(r.monthsMissing, []);
  assert.equal(r.warnings.length, 0);
});

test("a missing month is named rather than quietly lowering the total", () => {
  const r = buildHalfYearlyReturn({
    period: "apr_sep",
    year: 2026,
    monthly: [4, 5, 6, 8].map((month) => ({
      month,
      memberCount: 10,
      totalWagesPaise: L(180000),
      totalPayablePaise: L(7200),
    })),
  });
  assert.equal(r.complete, false);
  assert.deepEqual(r.monthsMissing, [7, 9]);
  assert.ok(r.warnings.some((w) => w.includes("must not be filed as final")));
  assert.equal(r.months.find((m) => m.month === 7)!.filed, false);
});

test("months appear in filing order, not sorted numerically", () => {
  const r = buildHalfYearlyReturn({ period: "oct_mar", year: 2026, monthly: [] });
  assert.deepEqual(
    r.months.map((m) => m.month),
    [10, 11, 12, 1, 2, 3],
  );
});


/* ---------------- reconciliation ---------------- */

test("an exact match reconciles and says so", () => {
  const summary = summariseEsicReturn([buildEsicLine(member())]);
  const r = reconcileEsic({
    summary,
    registerEmployeePaise: L(135),
    registerEmployerPaise: L(585),
  });
  assert.equal(r.matches, true);
  assert.equal(r.differencePaise, 0);
  assert.match(r.note, /matches the register exactly/);
});

test("rounding to whole rupees is explained, not hidden", () => {
  // The register carries paise the file cannot express.
  const summary = summariseEsicReturn([
    buildEsicLine(member({ employeeContributionPaise: 13550 })),
  ]);
  const r = reconcileEsic({
    summary,
    registerEmployeePaise: 13550,
    registerEmployerPaise: L(585),
  });
  assert.equal(r.matches, true);
  assert.notEqual(r.differencePaise, 0);
  assert.match(r.note, /rounding to whole rupees the file format requires/);
  assert.match(r.note, /register is the accounting figure/);
});

test("a difference rounding cannot explain refuses the filing", () => {
  const summary = summariseEsicReturn([buildEsicLine(member())]);
  const r = reconcileEsic({
    summary,
    registerEmployeePaise: L(500),
    registerEmployerPaise: L(585),
  });
  assert.equal(r.matches, false);
  assert.match(r.note, /Do not file this/);
});

test("the tolerance scales with the number of members", () => {
  const lines = Array.from({ length: 50 }, (_, i) =>
    buildEsicLine(member({ empCode: `E${i}` })),
  );
  const summary = summariseEsicReturn(lines);
  // ₹40 of drift across 50 members is within a rupee each on both shares
  const r = reconcileEsic({
    summary,
    registerEmployeePaise: L(135 * 50) - L(40),
    registerEmployerPaise: L(585 * 50),
  });
  assert.equal(r.matches, true);
});
