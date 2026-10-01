import "server-only";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { formatDateLetter } from "../format/date";
import { rupeesInWords } from "../payroll/amount-in-words";

export type LetterValues = {
  /** Read from the records. A field with nothing behind it is left out, not guessed. */
  values: Record<string, string>;
  /** Starting values for the fields asked when issuing, where a record suggests one. */
  inputDefaults: Record<string, string>;
};

/** Whole months from one ISO date to another. */
function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0));
}

/** "2 years 3 months", counted in whole months from joining to leaving. */
export function tenureBetween(from: string, to: string): string {
  const months = monthsBetween(from, to);
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years) parts.push(`${years} year${years === 1 ? "" : "s"}`);
  if (rest || !years) parts.push(`${rest} month${rest === 1 ? "" : "s"}`);
  return parts.join(" ");
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Every field a letter can reference, for one employee, as of today. */
export async function letterFieldsFor(employeeId: string): Promise<LetterValues> {
  const [emp] = await db.select().from(s.employees).where(eq(s.employees.id, employeeId)).limit(1);
  if (!emp) return { values: {}, inputDefaults: {} };

  const [[company], [salary], [branch], [manager], [grade], [dept], [exit]] = await Promise.all([
    db.select().from(s.companies).where(eq(s.companies.id, emp.companyId)).limit(1),
    db
      .select()
      .from(s.employeeSalaries)
      .where(eq(s.employeeSalaries.employeeId, employeeId))
      .orderBy(desc(s.employeeSalaries.effectiveFrom))
      .limit(1),
    emp.branchId ? db.select().from(s.branches).where(eq(s.branches.id, emp.branchId)).limit(1) : Promise.resolve([]),
    emp.managerId ? db.select().from(s.employees).where(eq(s.employees.id, emp.managerId)).limit(1) : Promise.resolve([]),
    emp.gradeId ? db.select().from(s.grades).where(eq(s.grades.id, emp.gradeId)).limit(1) : Promise.resolve([]),
    emp.departmentId
      ? db.select().from(s.departments).where(eq(s.departments.id, emp.departmentId)).limit(1)
      : Promise.resolve([]),
    db
      .select()
      .from(s.exitCases)
      .where(and(eq(s.exitCases.employeeId, employeeId), notInArray(s.exitCases.status, ["withdrawn"])))
      .orderBy(desc(s.exitCases.resignationDate))
      .limit(1),
  ]);

  const [fnf] = exit
    ? await db
        .select()
        .from(s.fnfSettlements)
        .where(eq(s.fnfSettlements.exitCaseId, exit.id))
        .orderBy(desc(s.fnfSettlements.createdAt))
        .limit(1)
    : [];

  const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;
  const today = new Date().toISOString().slice(0, 10);

  const companyAddress = company
    ? [company.registeredAddress, company.registeredCity, company.registeredStateCode, company.registeredPincode]
        .filter(Boolean)
        .join(", ")
    : "";

  const values: Record<string, string> = {
    employee_name: [emp.firstName, emp.middleName, emp.lastName].filter(Boolean).join(" "),
    first_name: emp.firstName,
    employee_code: emp.empCode,
    designation: emp.designation ?? "",
    department: dept?.name ?? emp.department ?? "",
    date_of_joining: formatDateLetter(emp.dateOfJoining),
    company_name: company?.legalName || company?.name || "",
    company_address: companyAddress,
    today: formatDateLetter(today),
    employee_address: [emp.addressLine, emp.city, emp.stateCode, emp.pincode].filter(Boolean).join(", "),
  };
  if (branch) values.work_location = [branch.name, branch.city].filter(Boolean).join(", ");
  if (manager) values.reporting_manager = `${manager.firstName} ${manager.lastName}`.trim();
  if (salary?.annualCtcPaise) {
    values.annual_ctc = rupees(salary.annualCtcPaise);
    values.annual_ctc_words = rupeesInWords(salary.annualCtcPaise);
  }
  if (salary?.monthlyGrossPaise) values.monthly_gross = rupees(salary.monthlyGrossPaise);

  const lastDay = emp.dateOfExit ?? exit?.lastWorkingDay ?? null;
  if (lastDay) {
    values.last_working_day = formatDateLetter(lastDay);
    values.date_of_exit = values.last_working_day;
    values.tenure = tenureBetween(emp.dateOfJoining, lastDay);
  }
  if (exit?.resignationDate) values.resignation_date = formatDateLetter(exit.resignationDate);
  if (fnf && fnf.status !== "draft") {
    values.fnf_net_amount = rupees(fnf.netPaise);
    values.fnf_amount_words = rupeesInWords(fnf.netPaise);
    if (fnf.releasedAt) values.fnf_paid_on = formatDateLetter(fnf.releasedAt.slice(0, 10));
  }

  const inputDefaults: Record<string, string> = {
    offer_valid_till: formatDateLetter(addDays(today, 7)),
    loi_valid_till: formatDateLetter(addDays(today, 7)),
    documents_due_by: formatDateLetter(addDays(today, 5)),
    conduct: "During this period, their conduct and performance were found to be good.",
  };
  const probation =
    grade?.probationMonths ??
    (emp.probationEndDate ? monthsBetween(emp.dateOfJoining, emp.probationEndDate) || null : null);
  if (probation) inputDefaults.probation_months = String(probation);
  if (grade?.noticeDays) inputDefaults.notice_period_days = String(grade.noticeDays);

  return { values, inputDefaults };
}

/** `HR/OFFER/JBM00015/2026-27/3` — unique enough to quote back, readable enough to type. */
export function letterRefNo(type: string, empCode: string, today: string, sequence: number): string {
  const [y, m] = today.split("-").map(Number);
  const fyStart = m >= 4 ? y : y - 1;
  const fy = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
  const code = { offer: "OL", loi: "LOI", relieving: "RL", experience: "EXP", fnf_noc: "NOC" }[type] ?? type.toUpperCase();
  return `HR/${code}/${empCode}/${fy}/${sequence}`;
}

/**
 * The reference the next letter of this type to this person will carry —
 * also shown on the issue screen, so the preview matches what is issued.
 */
export async function nextRefNo(employeeId: string, type: string, empCode: string, today: string): Promise<string> {
  const earlier = await db
    .select({ id: s.letterIssues.id })
    .from(s.letterIssues)
    .where(and(eq(s.letterIssues.employeeId, employeeId), eq(s.letterIssues.type, type as "offer")));
  return letterRefNo(type, empCode, today, earlier.length + 1);
}


