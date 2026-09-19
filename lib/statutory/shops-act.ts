import { toCsv } from "./summaries";
import type { Paise } from "../payroll/money";

/**
 * The Punjab Shops and Commercial Establishments Rules, 1958, Rule 5:
 * Form C (register of employees) and Form D (register of wages) —
 * shared, word for word, by Haryana, Punjab and Chandigarh, the three
 * jurisdictions still governed by the one pre-1966 Punjab Act. See
 * `db/shops-act-data.ts` for the primary source these are read from.
 *
 * CSV, not the bound, page-numbered register the Rules literally
 * describe (Rule 6(2): "duly bound and page-marked in serial number") —
 * this is a working export for an inspector or an audit, the same
 * relationship every other register in this codebase has to its own
 * prescribed paper form.
 */

const hhmm = (minute: number | null): string => {
  if (minute == null) return "";
  const h = Math.floor(minute / 60)
    .toString()
    .padStart(2, "0");
  const m = (minute % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
};

export type FormCRow = {
  empCode: string;
  name: string;
  fatherOrHusbandName: string | null;
  natureOfWork: string | null;
  wageBasis: string;
  dateOfAppointment: string;
  date: string;
  spreadOverFromMinute: number | null;
  spreadOverToMinute: number | null;
  restFromMinute: number | null;
  restToMinute: number | null;
  workingMinutes: number;
  onLeave: boolean;
  remarks: string;
};

/**
 * Form C — Register of Employees.
 *
 * Overtime is left blank throughout: this build tracks total worked
 * minutes per day, not a separately-identified overtime figure, and a
 * blank column an inspector can fill by hand is preferred to a number
 * this system did not actually compute. Leave's "duration / date of
 * application / date of grant" sub-columns are likewise reduced to a
 * single Y/N — the leave module here records approved requests, not a
 * day-by-day application-and-grant date pair distinct from that.
 */
export function punjabActFormC(rows: FormCRow[]): string {
  return toCsv(
    [
      "Employee code",
      "Name of employee",
      "Father's/Husband's name",
      "Nature of work",
      "Wage basis",
      "Date of appointment",
      "Date",
      "Spread-over from",
      "Spread-over to",
      "Interval of rest from",
      "Interval of rest to",
      "Total working hours",
      "Overtime",
      "On leave",
      "Remarks",
    ],
    rows.map((r) => [
      r.empCode,
      r.name,
      r.fatherOrHusbandName ?? "",
      r.natureOfWork ?? "",
      r.wageBasis,
      r.dateOfAppointment,
      r.date,
      hhmm(r.spreadOverFromMinute),
      hhmm(r.spreadOverToMinute),
      hhmm(r.restFromMinute),
      hhmm(r.restToMinute),
      (r.workingMinutes / 60).toFixed(2),
      "",
      r.onLeave ? "Y" : "",
      r.remarks,
    ]),
  );
}

export type FormDRow = {
  empCode: string;
  name: string;
  wagesFixedPaise: Paise;
  wagesEarnedPaise: Paise;
  deductionsPaise: Paise;
  netPaidPaise: Paise;
};

/**
 * Form D — Register of Wages.
 *
 * "Arrears from last month" and "advance made" are the Rules' own
 * columns but are not figures this build tracks as distinct concepts —
 * the loans module tracks a recovery schedule, not a same-period
 * advance-against-wages entry — so both are left blank rather than
 * approximated from something that means a different thing. Ordinary
 * and overtime wages are not separately available either, so "wages
 * earned" is the one figure the payroll run actually carries.
 */
export function punjabActFormD(rows: FormDRow[]): string {
  return toCsv(
    [
      "Employee code",
      "Name of employee",
      "Wages fixed",
      "Arrears from last month",
      "Wages earned during the month",
      "Deductions (Register E)",
      "Advance made",
      "Wages due",
      "Payment made",
    ],
    rows.map((r) => [
      r.empCode,
      r.name,
      (r.wagesFixedPaise / 100).toFixed(2),
      "",
      (r.wagesEarnedPaise / 100).toFixed(2),
      (r.deductionsPaise / 100).toFixed(2),
      "",
      ((r.wagesEarnedPaise - r.deductionsPaise) / 100).toFixed(2),
      (r.netPaidPaise / 100).toFixed(2),
    ]),
  );
}

/* ==================================================================
   Combined muster-roll-cum-wages register — every other verified state
   ================================================================== */

/**
 * The common shape behind most of the 35-state research: a single
 * combined register naming attendance, overtime, wages and deductions
 * together (Karnataka's Form T, Madhya Pradesh's Form N, Maharashtra's
 * Form Q, Odisha's Form 10, and the rest — see `db/shops-act-data.ts`
 * for exactly which form each state's row stands for). The research
 * confirmed each form's NAME, its rule and what payroll data it needs,
 * not a literal column-by-column transcription the way Haryana's own
 * Rules text gave that state's Form C — so this is one honest, common
 * register built to that description, not a claim of word-for-word
 * reproduction of any one gazette form.
 */
export type CombinedRegisterRow = {
  empCode: string;
  name: string;
  designation: string | null;
  dateOfAppointment: string;
  totalDays: number;
  paidDays: number;
  daysOnLeaveOrAbsent: number;
  overtimeHours: number | null;
  wagesFixedPaise: Paise;
  wagesEarnedPaise: Paise;
  deductionsPaise: Paise;
  netPaidPaise: Paise;
};

export function combinedMusterRollWages(
  rows: CombinedRegisterRow[],
  formTitle: string,
): string {
  return toCsv(
    [
      `Form: ${formTitle}`,
      "Name of employee",
      "Designation",
      "Date of appointment",
      "Total days",
      "Days paid",
      "Days on leave / absent",
      "Overtime hours",
      "Wages fixed",
      "Wages earned",
      "Deductions",
      "Net paid",
    ],
    rows.map((r) => [
      r.empCode,
      r.name,
      r.designation ?? "",
      r.dateOfAppointment,
      r.totalDays.toFixed(1),
      r.paidDays.toFixed(1),
      r.daysOnLeaveOrAbsent.toFixed(1),
      r.overtimeHours == null ? "" : r.overtimeHours.toFixed(2),
      (r.wagesFixedPaise / 100).toFixed(2),
      (r.wagesEarnedPaise / 100).toFixed(2),
      (r.deductionsPaise / 100).toFixed(2),
      (r.netPaidPaise / 100).toFixed(2),
    ]),
  );
}
