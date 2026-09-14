import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEcrLine,
  formatEcrLine,
  formatEcrFile,
  computeChallan,
  reconcileWithRegister,
  blockingIssues,
  ECR_DELIMITER,
  EPF_CHARGES_2026 as P,
  type EcrMemberInput,
} from "./ecr";

const L = (rupees: number) => Math.round(rupees * 100);
const EPS_BPS = 833;

const member = (over: Partial<EcrMemberInput> = {}): EcrMemberInput => ({
  uan: "100123456789",
  memberName: "Aarav Nair",
  empCode: "KA0001",
  grossWagesPaise: L(45000),
  epfWagesPaise: L(15000),
  employeeContributionPaise: L(1800),
  employerContributionPaise: L(1800),
  nonContributoryDays: 0,
  refundOfAdvancesPaise: 0,
  eligibleForPension: true,
  isInternationalWorker: false,
  dateOfExit: null,
  reasonForLeaving: null,
  ...over,
});

/* ---------------- member lines ---------------- */

test("the employer share splits into pension and the difference", () => {
  const line = buildEcrLine(member(), P, EPS_BPS);
  assert.equal(line.epsContributionRupees, 1250, "8.33% of ₹15,000");
  assert.equal(line.epfEpsDiffRupees, 550, "₹1,800 less ₹1,250");
  assert.equal(
    line.epsContributionRupees + line.epfEpsDiffRupees,
    1800,
    "the two must sum to the employer share",
  );
});

test("a member outside the pension scheme sends the whole employer share to PF", () => {
  const line = buildEcrLine(member({ eligibleForPension: false }), P, EPS_BPS);
  assert.equal(line.epsWagesRupees, 0);
  assert.equal(line.epsContributionRupees, 0);
  assert.equal(line.epfEpsDiffRupees, 1800, "nothing is diverted to pension");
});

test("pension and EDLI wages are capped even when EPF wages are not", () => {
  const line = buildEcrLine(
    member({
      epfWagesPaise: L(40000),
      employeeContributionPaise: L(4800),
      employerContributionPaise: L(4800),
    }),
    P,
    EPS_BPS,
  );
  assert.equal(line.epfWagesRupees, 40000, "PF is on actual wages here");
  assert.equal(line.epsWagesRupees, 15000, "pension stops at the ceiling");
  assert.equal(line.edliWagesRupees, 15000, "so does EDLI");
});

test("the ceiling does not apply to an international worker", () => {
  const line = buildEcrLine(
    member({
      epfWagesPaise: L(40000),
      employeeContributionPaise: L(4800),
      employerContributionPaise: L(4800),
      isInternationalWorker: true,
    }),
    P,
    EPS_BPS,
  );
  assert.equal(line.epsWagesRupees, 40000);
  assert.equal(line.edliWagesRupees, 40000);
});

test("a member without a UAN is flagged, because it fails the whole file", () => {
  const line = buildEcrLine(member({ uan: null }), P, EPS_BPS);
  assert.equal(line.uan, "");
  assert.ok(line.warnings.some((w) => w.includes("rejects the whole file")));
});

test("a UAN that is not twelve digits is flagged", () => {
  const line = buildEcrLine(member({ uan: "10012345678" }), P, EPS_BPS);
  assert.ok(line.warnings.some((w) => w.includes("12 digits")));
});

test("an exit without a reason is flagged", () => {
  const line = buildEcrLine(
    member({ dateOfExit: "2026-09-30", reasonForLeaving: null }),
    P,
    EPS_BPS,
  );
  assert.ok(line.warnings.some((w) => w.includes("reason for leaving")));
});

test("an impossible non-contributory day count is flagged", () => {
  const line = buildEcrLine(member({ nonContributoryDays: 45 }), P, EPS_BPS);
  assert.ok(line.warnings.some((w) => w.includes("not a possible number")));
});

test("a pension share exceeding the employer share is flagged, not silently clamped to a wrong value", () => {
  const line = buildEcrLine(
    member({ employerContributionPaise: L(500) }),
    P,
    EPS_BPS,
  );
  assert.ok(line.warnings.some((w) => w.includes("cannot be right")));
  assert.equal(line.epfEpsDiffRupees, 0, "never negative in the file");
});

test("member names are upper-cased, as the portal expects", () => {
  const line = buildEcrLine(member({ memberName: "Aarav Nair" }), P, EPS_BPS);
  assert.equal(line.memberName, "AARAV NAIR");
});

/* ---------------- file format ---------------- */

test("a line has eleven fields in the portal's order", () => {
  const line = buildEcrLine(member(), P, EPS_BPS);
  const fields = formatEcrLine(line).split(ECR_DELIMITER);
  assert.equal(fields.length, 11);
  assert.equal(fields[0], "100123456789");
  assert.equal(fields[1], "AARAV NAIR");
  assert.equal(fields[2], "45000", "gross wages");
  assert.equal(fields[3], "15000", "EPF wages");
  assert.equal(fields[4], "15000", "EPS wages");
  assert.equal(fields[6], "1800", "employee contribution");
  assert.equal(fields[7], "1250", "pension");
  assert.equal(fields[8], "550", "the difference");
});

test("every field is a whole rupee, never a decimal", () => {
  const line = buildEcrLine(
    member({
      grossWagesPaise: 4512345,
      epfWagesPaise: 1500050,
      employeeContributionPaise: 180006,
    }),
    P,
    EPS_BPS,
  );
  for (const field of formatEcrLine(line).split(ECR_DELIMITER).slice(2)) {
    assert.ok(!field.includes("."), `${field} carries a decimal`);
  }
});

test("the file ends with a newline", () => {
  const file = formatEcrFile([buildEcrLine(member(), P, EPS_BPS)]);
  assert.ok(file.endsWith("\n"));
});

test("one line per member, and no header row", () => {
  const file = formatEcrFile([
    buildEcrLine(member({ empCode: "A" }), P, EPS_BPS),
    buildEcrLine(member({ empCode: "B" }), P, EPS_BPS),
  ]);
  assert.equal(file.trimEnd().split("\n").length, 2);
  assert.ok(!file.startsWith("UAN"));
});

/* ---------------- challan ---------------- */

test("the challan splits into the five accounts", () => {
  const lines = [buildEcrLine(member(), P, EPS_BPS)];
  const challan = computeChallan(lines, P);
  assert.deepEqual(
    challan.accounts.map((a) => a.account),
    ["A/c 1", "A/c 2", "A/c 10", "A/c 21", "A/c 22"],
  );
});

test("A/c 1 carries the employee share plus the employer's PF portion only", () => {
  const lines = [buildEcrLine(member(), P, EPS_BPS)];
  const challan = computeChallan(lines, P);
  const ac1 = challan.accounts.find((a) => a.account === "A/c 1")!;
  assert.equal(ac1.amountPaise, L(1800 + 550), "pension is not in A/c 1");

  const ac10 = challan.accounts.find((a) => a.account === "A/c 10")!;
  assert.equal(ac10.amountPaise, L(1250));
});

test("administrative charges hit their floor on a small wage bill", () => {
  const lines = [buildEcrLine(member(), P, EPS_BPS)];
  const challan = computeChallan(lines, P);
  const ac2 = challan.accounts.find((a) => a.account === "A/c 2")!;
  // 0.5% of ₹15,000 is ₹75, below the ₹500 minimum
  assert.equal(ac2.amountPaise, L(500));
  assert.match(ac2.basis, /Minimum/);
});

test("administrative charges follow the rate once wages are large enough", () => {
  const lines = Array.from({ length: 40 }, (_, i) =>
    buildEcrLine(member({ empCode: `E${i}` }), P, EPS_BPS),
  );
  const challan = computeChallan(lines, P);
  const ac2 = challan.accounts.find((a) => a.account === "A/c 2")!;
  // 0.5% of ₹6,00,000 is ₹3,000, above the floor
  assert.equal(ac2.amountPaise, L(3000));
  assert.match(ac2.basis, /0.50% of EPF wages/);
});

test("EDLI administrative charges are waived", () => {
  const challan = computeChallan([buildEcrLine(member(), P, EPS_BPS)], P);
  const ac22 = challan.accounts.find((a) => a.account === "A/c 22")!;
  assert.equal(ac22.amountPaise, 0);
  assert.equal(ac22.basis, "Waived");
});

test("the challan total is the sum of its accounts", () => {
  const lines = Array.from({ length: 12 }, (_, i) =>
    buildEcrLine(member({ empCode: `E${i}` }), P, EPS_BPS),
  );
  const challan = computeChallan(lines, P);
  assert.equal(
    challan.totalPaise,
    challan.accounts.reduce((a, x) => a + x.amountPaise, 0),
  );
  assert.equal(challan.memberCount, 12);
});

/* ---------------- reconciliation ---------------- */

test("a return that agrees with the register reconciles", () => {
  const lines = [buildEcrLine(member(), P, EPS_BPS)];
  const challan = computeChallan(lines, P);
  const r = reconcileWithRegister({
    lines,
    challan,
    register: {
      employeeContributionPaise: L(1800),
      employerContributionPaise: L(1800),
      pensionPaise: L(1250),
      epfWagesPaise: L(15000),
    },
  });
  assert.equal(r.matches, true);
  assert.equal(r.warnings.length, 0);
});

test("rounding to whole rupees is tolerated within a rupee a member", () => {
  const lines = Array.from({ length: 10 }, (_, i) =>
    buildEcrLine(member({ empCode: `E${i}` }), P, EPS_BPS),
  );
  const challan = computeChallan(lines, P);
  const r = reconcileWithRegister({
    lines,
    challan,
    register: {
      employeeContributionPaise: L(18000) + 600, // ₹6 of paise-level drift
      employerContributionPaise: L(18000),
      pensionPaise: L(12500),
      epfWagesPaise: L(150000),
    },
  });
  assert.equal(r.matches, true);
});

test("a real difference is refused rather than filed", () => {
  const lines = [buildEcrLine(member(), P, EPS_BPS)];
  const challan = computeChallan(lines, P);
  const r = reconcileWithRegister({
    lines,
    challan,
    register: {
      employeeContributionPaise: L(2400),
      employerContributionPaise: L(1800),
      pensionPaise: L(1250),
      epfWagesPaise: L(15000),
    },
  });
  assert.equal(r.matches, false);
  assert.ok(r.warnings.some((w) => w.includes("Do not file this")));
  const row = r.differences.find((d) => d.label === "Employee contribution")!;
  assert.equal(row.differencePaise, L(-600));
});

/* ---------------- blocking issues ---------------- */

test("missing UANs are collected as one blocking issue", () => {
  const lines = [
    buildEcrLine(member({ empCode: "A", uan: null }), P, EPS_BPS),
    buildEcrLine(member({ empCode: "B", uan: null }), P, EPS_BPS),
    buildEcrLine(member({ empCode: "C" }), P, EPS_BPS),
  ];
  const issues = blockingIssues(lines);
  assert.equal(issues.length, 1);
  assert.ok(issues[0].includes("2 member(s)"));
  assert.ok(issues[0].includes("A, B"));
});

test("a clean file has no blocking issues", () => {
  assert.deepEqual(blockingIssues([buildEcrLine(member(), P, EPS_BPS)]), []);
});
