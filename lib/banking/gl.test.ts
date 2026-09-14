import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildJournal,
  allocateMover,
  journalToCsv,
  journalToTallyXml,
  tallyDate,
  DEFAULT_ACCOUNTS,
  DEFAULT_MAPPINGS,
  NET_PAYABLE_ACCOUNT,
  ROUNDING_ACCOUNT,
  type JournalInput,
} from "./gl";

const L = (rupees: number) => Math.round(rupees * 100);

/**
 * A realistic employee: ₹45,000 gross, PF and PT deducted, employer PF on
 * top. Net is gross less deductions, which is what makes it balance.
 */
const row = (over: Partial<JournalInput> = {}): JournalInput => ({
  employeeId: "e1",
  empCode: "KA0001",
  branchId: "br_ka",
  branchName: "Bengaluru",
  departmentId: "d1",
  departmentName: "Engineering",
  costCentre: "CC-ENG",
  netPaise: L(43000),
  lines: [
    { code: "BASIC", kind: "earning", amountPaise: L(22500) },
    { code: "HRA", kind: "earning", amountPaise: L(9000) },
    { code: "SPL", kind: "earning", amountPaise: L(13500) },
    { code: "EPF_EE", kind: "deduction", amountPaise: L(1800) },
    { code: "PT", kind: "deduction", amountPaise: L(200) },
    { code: "EPF_ER", kind: "employer_contribution", amountPaise: L(550) },
    { code: "EPS_ER", kind: "employer_contribution", amountPaise: L(1250) },
  ],
  ...over,
});

const build = (rows: JournalInput[], dimension: "none" | "branch" | "department" | "cost_centre" = "none") =>
  buildJournal({
    rows,
    accounts: DEFAULT_ACCOUNTS,
    mappings: DEFAULT_MAPPINGS,
    dimension,
  });

/* ---------------- the invariant ---------------- */

test("the journal balances to the paise", () => {
  const j = build([row()]);
  assert.equal(j.totalDebitPaise, j.totalCreditPaise);
  assert.equal(j.differencePaise, 0);
  assert.equal(j.balanced, true);
  assert.equal(j.warnings.length, 0);
});

test("it balances across many employees with different shapes", () => {
  const rows = [
    row(),
    // gross 18,500 less deductions of 1,500
    row({ employeeId: "e2", empCode: "KA0002", netPaise: L(17000), lines: [
      { code: "BASIC", kind: "earning", amountPaise: L(9000) },
      { code: "SPL", kind: "earning", amountPaise: L(9500) },
      { code: "EPF_EE", kind: "deduction", amountPaise: L(1080) },
      { code: "ESIC_EE", kind: "deduction", amountPaise: L(139) },
      { code: "PT", kind: "deduction", amountPaise: L(200) },
      { code: "TDS", kind: "deduction", amountPaise: L(81) },
      { code: "EPF_ER", kind: "employer_contribution", amountPaise: L(330) },
      { code: "ESIC_ER", kind: "employer_contribution", amountPaise: L(601) },
    ] }),
    row({ employeeId: "e3", empCode: "KA0003", netPaise: L(60000), lines: [
      { code: "BASIC", kind: "earning", amountPaise: L(60000) },
    ] }),
  ];
  const j = build(rows);
  assert.equal(j.balanced, true, `out by ${j.differencePaise}`);
});

/* ---------------- net-pay rounding ---------------- */

test("net rounded up to the rupee balances through the rounding account", () => {
  // Gross 45,000 less deductions 2,000 is 43,000.00; rounding net up by
  // 40 paise is exactly what roundNet does on a real run.
  const j = build([row({ netPaise: L(43000) + 40 })]);
  assert.equal(j.balanced, true, `out by ${j.differencePaise}`);
  const rounding = j.lines.find((l) => l.accountCode === ROUNDING_ACCOUNT)!;
  assert.equal(rounding.debitPaise, 40, "the company is 40 paise out of pocket");
});

test("net rounded down credits the rounding account instead", () => {
  const j = build([row({ netPaise: L(43000) - 35 })]);
  assert.equal(j.balanced, true);
  const rounding = j.lines.find((l) => l.accountCode === ROUNDING_ACCOUNT)!;
  assert.equal(rounding.creditPaise, 35);
});

test("rounding across many employees nets off rather than accumulating", () => {
  const rows = [
    row({ employeeId: "a", netPaise: L(43000) + 40 }),
    row({ employeeId: "b", netPaise: L(43000) - 40 }),
    row({ employeeId: "c", netPaise: L(43000) }),
  ];
  const j = build(rows);
  assert.equal(j.balanced, true);
  assert.equal(
    j.lines.find((l) => l.accountCode === ROUNDING_ACCOUNT),
    undefined,
    "equal and opposite rounding leaves no posting at all",
  );
});

test("an exact net posts nothing to rounding", () => {
  const j = build([row()]);
  assert.equal(j.lines.find((l) => l.accountCode === ROUNDING_ACCOUNT), undefined);
});

test("a rounding posting too large to be rounding is called out", () => {
  // The journal balances because rounding absorbed it, so the size of
  // the posting is the only remaining signal.
  const j = build([row({ netPaise: L(50000) })]);
  assert.equal(j.balanced, true);
  assert.equal(
    j.lines.find((l) => l.accountCode === ROUNDING_ACCOUNT)!.debitPaise,
    L(7000),
  );
  assert.ok(
    j.warnings.some((w) => w.includes("Rounding should be paise, not rupees")),
    j.warnings.join("; "),
  );
});

test("genuine paise-level rounding raises no warning", () => {
  const j = build([
    row({ employeeId: "a", netPaise: L(43000) + 40 }),
    row({ employeeId: "b", netPaise: L(43000) + 25 }),
  ]);
  assert.equal(j.balanced, true);
  assert.equal(j.warnings.length, 0);
});

/* ---------------- posting rules ---------------- */

test("earnings are debited to salary expense", () => {
  const j = build([row()]);
  const salary = j.lines.find((l) => l.accountCode === "SALARY_EXPENSE")!;
  assert.equal(salary.debitPaise, L(45000));
  assert.equal(salary.creditPaise, 0);
});

test("employee deductions credit a payable and create no extra cost", () => {
  const j = build([row()]);
  const pt = j.lines.find((l) => l.accountCode === "PT_PAYABLE")!;
  assert.equal(pt.creditPaise, L(200));
  assert.equal(pt.debitPaise, 0);

  // Salary expense is gross, not gross plus deductions.
  const salary = j.lines.find((l) => l.accountCode === "SALARY_EXPENSE")!;
  assert.equal(salary.debitPaise, L(45000));
});

test("employer contributions are both a cost and a liability", () => {
  const j = build([row()]);
  const expense = j.lines.find((l) => l.accountCode === "EMPLOYER_PF")!;
  assert.equal(expense.debitPaise, L(1800), "employer PF plus pension");

  const payable = j.lines.find((l) => l.accountCode === "PF_PAYABLE")!;
  // Employee ₹1,800 plus employer ₹1,800
  assert.equal(payable.creditPaise, L(3600));
});

test("net pay is credited to salaries payable", () => {
  const j = build([row()]);
  const net = j.lines.find((l) => l.accountCode === NET_PAYABLE_ACCOUNT)!;
  assert.equal(net.creditPaise, L(43000));
});

test("informational lines have no accounting effect", () => {
  const withInfo = build([
    row({
      lines: [
        ...row().lines,
        { code: "EPF_WAGES", kind: "info", amountPaise: L(15000) },
      ],
    }),
  ]);
  const plain = build([row()]);
  assert.equal(withInfo.totalDebitPaise, plain.totalDebitPaise);
  assert.equal(withInfo.balanced, true);
});

test("a zero-value line posts nothing", () => {
  const j = build([
    row({ lines: [...row().lines, { code: "LWF_EE", kind: "deduction", amountPaise: 0 }] }),
  ]);
  assert.equal(j.lines.find((l) => l.accountCode === "LWF_PAYABLE"), undefined);
});

test("loan recovery credits the receivable, not a payable", () => {
  const j = build([
    row({
      netPaise: L(33000),
      lines: [
        ...row().lines,
        { code: "LOAN:loan_abc", kind: "deduction", amountPaise: L(10000) },
      ],
    }),
  ]);
  const loan = j.lines.find((l) => l.accountCode === "LOAN_RECEIVABLE")!;
  assert.equal(loan.creditPaise, L(10000));
  assert.equal(j.balanced, true);
  assert.deepEqual(j.unmapped, [], "the loan code resolved by prefix");
});

/* ---------------- unmapped components ---------------- */

test("an unmapped earning goes to suspense and is named", () => {
  const j = build([
    row({
      netPaise: L(48000),
      lines: [...row().lines, { code: "BONUS", kind: "earning", amountPaise: L(5000) }],
    }),
  ]);
  const suspense = j.lines.find((l) => l.accountCode === "SUSPENSE")!;
  assert.equal(suspense.debitPaise, L(5000));
  assert.deepEqual(j.unmapped, ["BONUS"]);
  assert.ok(j.warnings.some((w) => w.includes("Map them before posting")));
});

test("suspense keeps the journal balanced rather than losing the amount", () => {
  const j = build([
    row({
      netPaise: L(48000),
      lines: [...row().lines, { code: "BONUS", kind: "earning", amountPaise: L(5000) }],
    }),
  ]);
  assert.equal(j.balanced, true);
});

/* ---------------- dimensions ---------------- */

test("with no dimension everything aggregates into one line per account", () => {
  const j = build([row(), row({ employeeId: "e2", branchName: "Mumbai" })]);
  const salary = j.lines.filter((l) => l.accountCode === "SALARY_EXPENSE");
  assert.equal(salary.length, 1);
  assert.equal(salary[0].debitPaise, L(90000));
});

test("by branch, cost splits per branch and still balances", () => {
  const j = build(
    [row(), row({ employeeId: "e2", branchId: "br_mh", branchName: "Mumbai" })],
    "branch",
  );
  const salary = j.lines.filter((l) => l.accountCode === "SALARY_EXPENSE");
  assert.equal(salary.length, 2);
  assert.deepEqual(
    salary.map((l) => l.dimension).sort(),
    ["Bengaluru", "Mumbai"],
  );
  assert.equal(j.balanced, true);
});

test("an employee with no department lands in Unassigned, not dropped", () => {
  const j = build([row({ departmentName: null })], "department");
  const salary = j.lines.find((l) => l.accountCode === "SALARY_EXPENSE")!;
  assert.equal(salary.dimension, "Unassigned");
  assert.equal(j.balanced, true);
});

test("cost centre is a distinct dimension from department", () => {
  const j = build([row()], "cost_centre");
  assert.equal(
    j.lines.find((l) => l.accountCode === "SALARY_EXPENSE")!.dimension,
    "CC-ENG",
  );
});

/* ---------------- mid-period movers ---------------- */

const mover = {
  employeeId: "e1",
  empCode: "KA0001",
  fromDimension: "Engineering",
  toDimension: "Platform",
  effectiveDay: 16,
  daysInMonth: 30,
};

test("the full-to-new rule charges the whole month to the new centre", () => {
  const parts = allocateMover({ mover, amountPaise: L(45000), rule: "full_to_new" });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].dimension, "Platform");
  assert.equal(parts[0].amountPaise, L(45000));
});

test("the full-to-old rule charges the whole month to the old centre", () => {
  const parts = allocateMover({ mover, amountPaise: L(45000), rule: "full_to_old" });
  assert.equal(parts[0].dimension, "Engineering");
});

test("prorating splits by days and loses nothing", () => {
  const parts = allocateMover({ mover, amountPaise: L(45000), rule: "prorate" });
  assert.equal(parts.length, 2);
  assert.equal(parts[0].amountPaise, L(22500), "15 of 30 days");
  assert.equal(parts[1].amountPaise, L(22500));
  assert.equal(
    parts.reduce((a, p) => a + p.amountPaise, 0),
    L(45000),
  );
});

test("proration with an odd amount still sums exactly", () => {
  const parts = allocateMover({
    mover: { ...mover, effectiveDay: 12, daysInMonth: 31 },
    amountPaise: 4500011,
    rule: "prorate",
  });
  assert.equal(parts.reduce((a, p) => a + p.amountPaise, 0), 4500011);
});

test("a move on the first day gives the old centre nothing", () => {
  const parts = allocateMover({
    mover: { ...mover, effectiveDay: 1 },
    amountPaise: L(45000),
    rule: "prorate",
  });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].dimension, "Platform");
});

test("each part states the basis it was allocated on", () => {
  const parts = allocateMover({ mover, amountPaise: L(45000), rule: "prorate" });
  assert.match(parts[0].basis, /15 of 30 days/);
});

/* ---------------- exports ---------------- */

test("the journal CSV has a row per posting and amounts in rupees", () => {
  const j = build([row()]);
  const csv = journalToCsv(j, "JV-2026-09");
  const rows = csv.trimEnd().split("\n");
  assert.equal(rows.length, j.lines.length + 1);
  assert.ok(rows[0].startsWith("Voucher,Account Code,"));
  assert.ok(csv.includes("45000.00"));
});

test("Tally dates are DD-MMM-YYYY", () => {
  assert.equal(tallyDate("2026-09-30"), "30-Sep-2026");
  assert.equal(tallyDate("2026-01-01"), "01-Jan-2026");
});

test("Tally XML marks debits deemed positive and negates their amount", () => {
  const j = build([row()]);
  const { xml, refused } = journalToTallyXml({
    journal: j,
    companyName: "Meridian Labs",
    voucherDate: "2026-09-30",
    narration: "Payroll September 2026",
  });
  assert.equal(refused, false);
  assert.ok(xml.includes("<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>"));
  assert.ok(xml.includes("-45000.00"), "salary expense is a negative debit");
  assert.ok(xml.includes("<LEDGERNAME>Salaries payable</LEDGERNAME>"));
});

test("an unbalanced journal is refused rather than exported", () => {
  // Constructed directly: buildJournal now balances through the rounding
  // account, so an unbalanced voucher can only arrive from elsewhere.
  const j = {
    lines: [
      { accountCode: "A", accountName: "A", dimension: "—", debitPaise: L(100), creditPaise: 0, narration: "A" },
    ],
    totalDebitPaise: L(100),
    totalCreditPaise: 0,
    balanced: false,
    differencePaise: L(100),
    unmapped: [],
    warnings: [],
  };
  const result = journalToTallyXml({
    journal: j,
    companyName: "Meridian Labs",
    voucherDate: "2026-09-30",
    narration: "Payroll",
  });
  assert.equal(result.refused, true);
  assert.equal(result.xml, "");
  assert.match(result.reason!, /has not been exported/);
});

test("a company name with an ampersand is escaped, not left to break the import", () => {
  const j = build([row()]);
  const { xml } = journalToTallyXml({
    journal: j,
    companyName: "Meridian Labs & Co",
    voucherDate: "2026-09-30",
    narration: 'Payroll <"September">',
  });
  assert.ok(xml.includes("Meridian Labs &amp; Co"));
  assert.ok(xml.includes("&lt;&quot;September&quot;&gt;"));
  assert.ok(!xml.includes("Labs & Co"), "the raw ampersand does not survive");
});
