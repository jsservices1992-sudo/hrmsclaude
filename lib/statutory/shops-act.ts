import { toCsv } from "./summaries";
import type { Paise } from "../payroll/money";

/**
 * Haryana's Shops & Establishments registers — the Punjab Shops and
 * Commercial Establishments Rules, 1958, Rule 5: Form C (register of
 * employees) and Form D (register of wages). See
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
export function haryanaFormC(rows: FormCRow[]): string {
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
export function haryanaFormD(rows: FormDRow[]): string {
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
