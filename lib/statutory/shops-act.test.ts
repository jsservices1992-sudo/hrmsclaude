import { test } from "node:test";
import assert from "node:assert/strict";
import {
  punjabActFormC,
  punjabActFormD,
  combinedMusterRollWages,
  type FormCRow,
  type FormDRow,
  type CombinedRegisterRow,
} from "./shops-act";

const L = (rupees: number) => Math.round(rupees * 100);

const cRow = (over: Partial<FormCRow> = {}): FormCRow => ({
  empCode: "HR0001",
  name: "Aarav Nair",
  fatherOrHusbandName: null,
  natureOfWork: "Sales executive",
  wageBasis: "Monthly",
  dateOfAppointment: "2024-01-15",
  date: "2026-09-01",
  spreadOverFromMinute: 9 * 60,
  spreadOverToMinute: 18 * 60,
  restFromMinute: null,
  restToMinute: null,
  workingMinutes: 480,
  onLeave: false,
  remarks: "",
  ...over,
});

test("Form C carries every prescribed column, and overtime always reads blank", () => {
  const csv = punjabActFormC([cRow()]);
  const [header, row] = csv.trim().split("\n");
  assert.match(header, /Spread-over from/);
  assert.match(header, /Overtime/);
  const cells = row.split(",");
  assert.equal(cells[7], "09:00", "spread-over from, as HH:MM");
  assert.equal(cells[8], "18:00", "spread-over to");
  assert.equal(cells[11], "8.00", "8 hours");
  assert.equal(cells[12], "", "overtime is never computed, always blank");
});

test("a rest interval only appears with exactly two punch pairs", () => {
  const csv = punjabActFormC([
    cRow({ restFromMinute: 13 * 60, restToMinute: 14 * 60 }),
  ]);
  const row = csv.trim().split("\n")[1];
  assert.match(row, /13:00,14:00/);
});

test("a day with no attendance record still gets a row, marked, not skipped", () => {
  const csv = punjabActFormC([
    cRow({ spreadOverFromMinute: null, spreadOverToMinute: null, workingMinutes: 0, remarks: "No attendance record for this date" }),
  ]);
  assert.match(csv, /No attendance record for this date/);
});

test("leave shows as Y, not a guessed duration", () => {
  const csv = punjabActFormC([cRow({ onLeave: true })]);
  const row = csv.trim().split("\n")[1];
  const cells = row.split(",");
  assert.equal(cells[13], "Y");
});

const dRow = (over: Partial<FormDRow> = {}): FormDRow => ({
  empCode: "HR0001",
  name: "Aarav Nair",
  wagesFixedPaise: L(30000),
  wagesEarnedPaise: L(28000),
  deductionsPaise: L(3000),
  netPaidPaise: L(25000),
  ...over,
});

test("Form D leaves arrears and advance blank, never approximated", () => {
  const csv = punjabActFormD([dRow()]);
  const [header, row] = csv.trim().split("\n");
  assert.match(header, /Arrears from last month/);
  assert.match(header, /Advance made/);
  const cells = row.split(",");
  assert.equal(cells[3], "", "arrears — not tracked, left blank");
  assert.equal(cells[6], "", "advance — not tracked, left blank");
});

test("Form D's wages due is earned less deductions", () => {
  const csv = punjabActFormD([dRow()]);
  const row = csv.trim().split("\n")[1];
  const cells = row.split(",");
  assert.equal(cells[7], "25000.00", "28000 - 3000");
  assert.equal(cells[8], "25000.00", "payment made, from the run's net pay");
});

/* ---------------- combined muster-roll-cum-wages register ---------------- */

const combinedRow = (over: Partial<CombinedRegisterRow> = {}): CombinedRegisterRow => ({
  empCode: "KA0001",
  name: "Divya Rao",
  designation: "Sales executive",
  dateOfAppointment: "2024-01-15",
  totalDays: 30,
  paidDays: 28,
  daysOnLeaveOrAbsent: 2,
  overtimeHours: null,
  wagesFixedPaise: L(30000),
  wagesEarnedPaise: L(28000),
  deductionsPaise: L(3000),
  netPaidPaise: L(25000),
  ...over,
});

test("the combined register names the actual prescribed form in its header", () => {
  const csv = combinedMusterRollWages([combinedRow()], "Form T (combined muster roll-cum-wages)");
  const header = csv.trim().split("\n")[0];
  assert.match(header, /Form T \(combined muster roll-cum-wages\)/);
});

test("overtime hours are blank when not separately tracked, not zero", () => {
  const csv = combinedMusterRollWages([combinedRow({ overtimeHours: null })], "Form Q");
  const row = csv.trim().split("\n")[1];
  const cells = row.split(",");
  assert.equal(cells[7], "", "blank, not a guessed zero");
});

test("an empty register still produces a header row", () => {
  const csv = combinedMusterRollWages([], "Form N");
  assert.equal(csv.trim().split("\n").length, 1);
});
