import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { formatDate } from "../format/date";

/** Every field a letter template can reference, for one employee, as of today. */
export async function letterFieldsFor(employeeId: string): Promise<Record<string, string>> {
  const [emp] = await db.select().from(s.employees).where(eq(s.employees.id, employeeId)).limit(1);
  if (!emp) return {};

  const [company] = await db
    .select()
    .from(s.companies)
    .where(eq(s.companies.id, emp.companyId))
    .limit(1);

  const [salary] = await db
    .select()
    .from(s.employeeSalaries)
    .where(and(eq(s.employeeSalaries.employeeId, employeeId)))
    .orderBy(desc(s.employeeSalaries.effectiveFrom))
    .limit(1);

  const department = emp.departmentId
    ? (await db.select().from(s.departments).where(eq(s.departments.id, emp.departmentId)).limit(1))[0]?.name
    : emp.department;

  const rupees = (paise: number | null | undefined) =>
    paise == null ? "" : `₹${(paise / 100).toLocaleString("en-IN")}`;

  const companyAddress = company
    ? [company.registeredAddress, company.registeredCity, company.registeredStateCode, company.registeredPincode]
        .filter(Boolean)
        .join(", ")
    : "";

  const fields: Record<string, string> = {
    employee_name: `${emp.firstName} ${emp.lastName}`.trim(),
    employee_code: emp.empCode,
    designation: emp.designation ?? "",
    department: department ?? "",
    date_of_joining: formatDate(emp.dateOfJoining),
    company_name: company?.legalName || company?.name || "",
    company_address: companyAddress,
    today: formatDate(new Date().toISOString().slice(0, 10)),
  };
  if (emp.dateOfExit) fields.date_of_exit = formatDate(emp.dateOfExit);
  if (salary?.annualCtcPaise) fields.annual_ctc = rupees(salary.annualCtcPaise);
  if (salary?.monthlyGrossPaise) fields.monthly_gross = rupees(salary.monthlyGrossPaise);

  return fields;
}
