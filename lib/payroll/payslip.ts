import { maskAccount } from "@/lib/ess/profile";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import type { PayFigures } from "./load";
import { evaluateStructure } from "./compensation";
import { loadStructureResolutionContext, resolveEmployeeStructure } from "./load";
import { rupeesInWords } from "./amount-in-words";

/** One row on either side of the slip. */
export type SlipLine = {
  label: string;
  amountPaise: number;
};

export type SlipEarningLine = SlipLine & {
  /** Backdated portion, where a revision reached into a month already run. */
  arrearPaise: number;
};

export type PayslipHeader = {
  companyName: string;
  companyAddressLines: string[];
  /** Null falls back to a monogram of the company name. */
  logoUrl: string | null;
  name: string;
  employeeId: string;
  joiningDate: string;
  pfNumber: string;
  panNo: string;
  uanNo: string;
  bankName: string;
  accountNo: string;
  ifsc: string;
  department: string;
  designation: string;
  daysPaid: string;
  daysLwp: string;
  arrearDays: string;
  location: string;
};

export type PayslipData = {
  header: PayslipHeader;
  periodLabel: string;
  /** Un-prorated monthly rate per component — the "salary rates" column. */
  rates: SlipLine[];
  ratesTotalPaise: number;
  earnings: SlipEarningLine[];
  arrearTotalPaise: number;
  grossPaise: number;
  deductions: SlipLine[];
  deductionsTotalPaise: number;
  netPaise: number;
  netInWords: string;
  warnings: string[];
};

const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

/** dd/mm/yyyy, as payslips print dates. */
function slipDate(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function num(value: number): string {
  return value.toFixed(2);
}

/**
 * Everything one payslip prints, for one employee in one period.
 *
 * The figures come from the run itself rather than being recomputed, so a
 * slip always says exactly what the run paid. The only thing derived here
 * is the un-prorated monthly rate column, which the engine has no reason
 * to carry because it pays the prorated figure.
 */
export async function loadPayslips(args: {
  companyId: string;
  year: number;
  month: number;
  results: PayFigures[];
  /**
   * Show only the last four digits of the account number.
   *
   * A single payslip is read by the one person it belongs to, or by
   * someone in payroll checking that one person's account — the number
   * is the point. A bulk print is a different object: thirty-odd
   * account numbers on one PDF that then travels by email. Mask there.
   */
  maskAccounts?: boolean;
}): Promise<Map<string, PayslipData>> {
  const { companyId, year, month, results } = args;
  const employeeIds = results.map((r) => r.employeeId);

  const [company] = await db
    .select()
    .from(s.companies)
    .where(eq(s.companies.id, companyId))
    .limit(1);

  const employeeRows = employeeIds.length
    ? await db
        .select({
          emp: s.employees,
          departmentName: s.departments.name,
          branchName: s.branches.name,
          branchCity: s.branches.city,
        })
        .from(s.employees)
        .leftJoin(s.departments, eq(s.employees.departmentId, s.departments.id))
        .leftJoin(s.branches, eq(s.employees.branchId, s.branches.id))
        .where(inArray(s.employees.id, employeeIds))
    : [];
  const byEmployee = new Map(employeeRows.map((r) => [r.emp.id, r]));

  const salaryRows = employeeIds.length
    ? await db
        .select()
        .from(s.employeeSalaries)
        .where(inArray(s.employeeSalaries.employeeId, employeeIds))
    : [];
  // The row in force for this period — the latest one that had started.
  const periodEnd = `${year}-${String(month).padStart(2, "0")}-31`;
  const salaryByEmployee = new Map<string, (typeof salaryRows)[number]>();
  for (const row of salaryRows) {
    if (row.effectiveFrom > periodEnd) continue;
    const held = salaryByEmployee.get(row.employeeId);
    if (!held || row.effectiveFrom > held.effectiveFrom) {
      salaryByEmployee.set(row.employeeId, row);
    }
  }

  const structureCtx = await loadStructureResolutionContext(companyId);

  const companyAddressLines = [
    company?.registeredAddress,
    [company?.registeredCity, company?.registeredStateCode].filter(Boolean).join(", "),
    company?.registeredPincode ? `Pin ${company.registeredPincode}` : null,
  ].filter((x): x is string => Boolean(x && x.trim()));

  const out = new Map<string, PayslipData>();

  for (const r of results) {
    const row = byEmployee.get(r.employeeId);
    const emp = row?.emp;
    const salary = salaryByEmployee.get(r.employeeId);

    /* The un-prorated monthly rate for each component. The run pays the
       prorated figure; this column is what the rate card says. */
    let rates: SlipLine[] = [];
    if (salary) {
      const resolved = resolveEmployeeStructure(structureCtx, {
        employeeStructureId: salary.structureId,
        employeeDepartmentId: emp?.departmentId ?? null,
      });
      rates = evaluateStructure(resolved.components, salary.monthlyGrossPaise).components.map(
        (c) => ({ label: `Fixed ${c.label}`, amountPaise: c.amountPaise }),
      );
    }
    const ratesTotalPaise = rates.reduce((a, x) => a + x.amountPaise, 0);

    const earnings: SlipEarningLine[] = r.lines
      .filter((l) => l.kind === "earning")
      .map((l) => ({ label: l.label, amountPaise: l.amountPaise, arrearPaise: 0 }));

    const deductions: SlipLine[] = r.lines
      .filter((l) => l.kind === "deduction")
      .map((l) => ({ label: l.label, amountPaise: l.amountPaise }));

    out.set(r.employeeId, {
      header: {
        companyName: company?.name ?? "",
        companyAddressLines,
        logoUrl: company?.logoUrl ?? null,
        name: r.name,
        employeeId: r.empCode,
        joiningDate: slipDate(emp?.dateOfJoining),
        pfNumber: company?.pfCode ?? "",
        panNo: emp?.pan ?? "",
        uanNo: emp?.uan ?? "",
        // The employee master holds the account and IFSC; the bank's own
        // name is not captured, so it is left blank rather than guessed.
        bankName: "",
        accountNo: args.maskAccounts
          ? maskAccount(emp?.bankAccount)
          : (emp?.bankAccount ?? ""),
        ifsc: emp?.ifsc ?? "",
        department: row?.departmentName ?? emp?.department ?? "",
        designation: emp?.designation ?? "",
        daysPaid: num(r.paidDays),
        daysLwp: num(r.lopDays),
        arrearDays: num(0),
        location: row?.branchCity ?? row?.branchName ?? "",
      },
      periodLabel: `${MONTHS[month - 1]},${year}`,
      rates,
      ratesTotalPaise,
      earnings,
      arrearTotalPaise: earnings.reduce((a, x) => a + x.arrearPaise, 0),
      grossPaise: r.grossPaise,
      deductions,
      deductionsTotalPaise: r.deductionsPaise,
      netPaise: r.netPaise,
      netInWords: rupeesInWords(r.netPaise).replace(/^Rupees/, "Indian Rupees"),
      warnings: r.warnings,
    });
  }

  return out;
}
