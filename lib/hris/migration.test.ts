import test from "node:test";
import assert from "node:assert/strict";
import { readCsv, collapseProblems, parseRupees, splitCsvLine } from "./csv";
import { parseSalaryCsv, unknownEmployees, alreadyPaid } from "./salary-bulk";
import { parseLeaveBalanceCsv, unknownLeaveReferences } from "./leave-bulk";

/* ---------------- the shared reader ---------------- */

test("columns are found by name, whatever the order or spacing", () => {
  const t = readCsv("Emp_Code, Amount ,pay mode\nE1,1000,gross", ["empCode", "amount"]);
  assert.deepEqual(t.problems, []);
  assert.equal(t.rows[0].get("empCode"), "E1");
  assert.equal(t.rows[0].get("payMode"), "gross");
});

test("comment lines and blanks are skipped, so a template imports as-is", () => {
  const t = readCsv("# notes\nempCode,amount\n# example\n#E9,999\n\nE1,1000", ["empCode"]);
  assert.equal(t.rows.length, 1);
  assert.equal(t.rows[0].get("empCode"), "E1");
});

test("a missing required column is reported once, not per row", () => {
  const t = readCsv("empCode\nE1\nE2\nE3", ["empCode", "amount"]);
  assert.equal(t.problems.length, 1);
  assert.match(t.problems[0].message, /amount/);
});

test("empty and header-only files each say which they are", () => {
  assert.match(readCsv("", ["a"]).problems[0].message, /empty/);
  assert.match(readCsv("a,b", ["a"]).problems[0].message, /no rows/);
});

test("one cause collapses however many rows share it", () => {
  const many = Array.from({ length: 82 }, (_, i) => ({
    line: i + 2, column: "branchCode", message: '"GGN" is not a branch.',
  }));
  const collapsed = collapseProblems(many);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].rows, 82);
  assert.equal(collapsed[0].line, 2, "points at the first occurrence");
});

test("rupees are read the way people type them", () => {
  assert.deepEqual(parseRupees("₹12,50,000"), { ok: true, paise: 125_000_000 });
  assert.deepEqual(parseRupees("1200.50"), { ok: true, paise: 120_050 });
  assert.equal(parseRupees("").ok, false);
  assert.equal(parseRupees("0").ok, false);
  assert.equal(parseRupees("abc").ok, false);
});

test("quoted commas survive", () => {
  assert.deepEqual(splitCsvLine('a,"b,c",d'), ["a", "b,c", "d"]);
});

/* ---------------- salary ---------------- */

const salaryCsv = (...rows: string[]) =>
  ["empCode,amount,payMode,effectiveFrom,reason", ...rows].join("\n");

test("a salary row resolves to the basis it states", () => {
  const r = parseSalaryCsv(salaryCsv("E1,2400000,ctc,2026-04-01,Migrated"));
  assert.deepEqual(r.problems, []);
  assert.equal(r.rows[0].payMode, "ctc");
  assert.equal(r.rows[0].amountPaise, 240_000_000);
  assert.equal(r.rows[0].effectiveFrom, "2026-04-01");
});

test("the basis must be stated, because guessing it divides a CTC by twelve", () => {
  const r = parseSalaryCsv(salaryCsv("E1,2400000,,2026-04-01,"));
  assert.equal(r.rows.length, 0);
  assert.match(r.problems[0].message, /State what the amount is/);
});

test("an unrecognised basis lists the ones that work", () => {
  const r = parseSalaryCsv(salaryCsv("E1,50000,monthly,2026-04-01,"));
  assert.match(r.problems[0].message, /gross, annual_gross, ctc, take_home/);
});

test("the same employee cannot be given two salaries in one file", () => {
  const r = parseSalaryCsv(salaryCsv("E1,50000,gross,,", "E1,60000,gross,,"));
  assert.equal(r.rows.length, 1);
  assert.match(r.problems[0].message, /appears twice — first on line 2/);
});

test("an employee who does not exist is reported, with where to fix it", () => {
  const { rows } = parseSalaryCsv(salaryCsv("GHOST,50000,gross,,"));
  const p = unknownEmployees(rows, ["E1"]);
  assert.match(p[0].message, /not an employee/);
  assert.equal(p[0].fix?.href, "/console/employees");
});

test("importing over an existing salary is refused, not silently done", () => {
  const { rows } = parseSalaryCsv(salaryCsv("E1,50000,gross,,"));
  const p = alreadyPaid(rows, ["E1"]);
  assert.match(p[0].message, /already has a salary[\s\S]*versioned/);
});

/* ---------------- leave balances ---------------- */

const leaveCsv = (...rows: string[]) =>
  ["empCode,leaveType,balanceDays,asOf", ...rows].join("\n");

test("a leave balance reads, including fractions and negatives", () => {
  const r = parseLeaveBalanceCsv(leaveCsv("E1,Earned leave,18.5,2026-03-31", "E2,Sick leave,-2,2026-03-31"));
  assert.deepEqual(r.problems, []);
  assert.equal(r.rows[0].balanceDays, 18.5);
  assert.equal(r.rows[1].balanceDays, -2, "advance leave already taken is real");
});

test("a figure with a misplaced decimal point is caught", () => {
  const r = parseLeaveBalanceCsv(leaveCsv("E1,Earned leave,1850,2026-03-31"));
  assert.match(r.problems[0].message, /looks wrong/);
});

test("one balance per person per type", () => {
  const r = parseLeaveBalanceCsv(leaveCsv("E1,Earned leave,10,", "E1,earned leave,12,"));
  assert.equal(r.rows.length, 1);
  assert.match(r.problems[0].message, /already has a earned leave balance on line 2/);
});

test("a leave type that does not exist is a message, not a new type", () => {
  const { rows } = parseLeaveBalanceCsv(leaveCsv("E1,Sabbatical,10,"));
  const p = unknownLeaveReferences(rows, { empCodes: ["E1"], leaveTypeNames: ["Earned leave", "Sick leave"] });
  assert.match(p[0].message, /Earned leave, Sick leave/);
  assert.equal(p[0].fix?.href, "/console/settings/master-data?tab=leave");
});

test("leave types match case-insensitively, as people type them", () => {
  const { rows } = parseLeaveBalanceCsv(leaveCsv("E1,EARNED LEAVE,10,"));
  assert.deepEqual(unknownLeaveReferences(rows, { empCodes: ["E1"], leaveTypeNames: ["Earned leave"] }), []);
});

test("a blank balance is 'nothing to carry over', not a bad number", () => {
  const r = parseLeaveBalanceCsv(
    leaveCsv("E1,Earned leave,12,2026-03-31", "E1,Sick leave,,2026-03-31", "E2,Earned leave,,"),
  );
  assert.deepEqual(r.problems, [], "the template pre-fills blanks; they must not fail");
  assert.equal(r.rows.length, 1, "only the filled row is imported");
  assert.equal(r.rows[0].leaveType, "Earned leave");
});

test("a file of entirely blank balances says so rather than doing nothing", () => {
  const r = parseLeaveBalanceCsv(leaveCsv("E1,Earned leave,,", "E2,Sick leave,,"));
  assert.equal(r.rows.length, 0);
  assert.match(r.problems[0].message, /nothing to import/);
});
