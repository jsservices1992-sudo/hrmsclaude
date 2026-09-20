import { maskAccount } from "@/lib/ess/profile";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import type { PayFigures } from "./load";
import {
  employerCostFor,
  evaluateStructure,
} from "./compensation";
import {
  loadStatutoryConfig,
  loadStructureResolutionContext,
  resolveEmployeeStructure,
} from "./load";
import { rupeesInWords } from "./amount-in-words";
import { formatDate } from "@/lib/format/date";

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
  /** The establishment's PF code — the company's, not the employee's. */
  pfNumber: string;
  /** The employee's ESIC insurance number, where they are covered. */
  esicIp: string;
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
  /**
   * Un-prorated monthly rate per component — the "salary rates" column.
   *
   * Empty in a month paid in full, where it would repeat the earnings
   * column line for line and read as every component listed twice. It
   * earns its place only when the two differ: a month with loss of pay, a
   * mid-month joiner, somebody who left.
   */
  rates: SlipLine[];
  ratesTotalPaise: number;
  earnings: SlipEarningLine[];
  arrearTotalPaise: number;
  grossPaise: number;
  deductions: SlipLine[];
  deductionsTotalPaise: number;
  /**
   * What the employer pays on top of the salary. Not deducted from anybody
   * — but it is money spent on this employee, and a payslip that omits it
   * makes the employee's own PF look like it has no counterpart.
   */
  employerContributions: SlipLine[];
  employerTotalPaise: number;
  /**
   * Cost to company at the full monthly rate — gross, the employer's
   * statutory share and the gratuity provision.
   *
   * Stated at the rate rather than at what this month happened to cost, so
   * a month with unpaid leave does not read as a cut in the package. The
   * contributions above are this month's; these two are the contract.
   */
  monthlyCtcPaise: number;
  annualCtcPaise: number;
  netPaise: number;
  netInWords: string;
  warnings: string[];
};

const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

/** dd/mm/yyyy, as payslips print dates. */
/* The payslip's own copy of this predates the shared one; it stays a
   named function only because a payslip shows an empty cell rather than
   an em dash where a date is missing. */
function slipDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const out = formatDate(iso);
  return out === "—" ? "" : out;
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
          branchStateCode: s.branches.stateCode,
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
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const statutory = await loadStatutoryConfig(
    `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    companyId,
  );

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
        /* The column is already headed "Salary rates", so prefixing every
           row with "Fixed" said the same thing twice and left the slip
           reading "Fixed Basic, Fixed HRA" instead of the component
           names the employee knows. */
        (c) => ({ label: c.label, amountPaise: c.amountPaise }),
      );
    }
    const ratesTotalPaise = rates.reduce((a, x) => a + x.amountPaise, 0);

    const earnings: SlipEarningLine[] = r.lines
      .filter((l) => l.kind === "earning")
      .map((l) => ({ label: l.label, amountPaise: l.amountPaise, arrearPaise: 0 }));

    const deductions: SlipLine[] = r.lines
      .filter((l) => l.kind === "deduction")
      .map((l) => ({ label: l.label, amountPaise: l.amountPaise }));

    const employerContributions: SlipLine[] = r.lines
      .filter((l) => l.kind === "employer_contribution" && l.amountPaise !== 0)
      .map((l) => ({ label: l.label, amountPaise: l.amountPaise }));

    /* Cost to company at the full monthly rate, so unpaid leave in this
       month does not read as a cut in the package. The gratuity provision
       belongs in it — it is money set aside for this employee — even
       though no run line pays it out. */
    let monthlyCtcPaise = 0;
    if (salary && emp) {
      const resolved = resolveEmployeeStructure(structureCtx, {
        employeeStructureId: salary.structureId,
        employeeDepartmentId: emp.departmentId,
      });
      const full = evaluateStructure(resolved.components, salary.monthlyGrossPaise);
      const cost = employerCostFor(full, {
        epfCeilingPaise: statutory.epf.wageCeilingPaise,
        epfEmployerBps: statutory.epf.employerBps,
        epfOnActualBasic: company?.epfOnActualBasic ?? false,
        esicThresholdPaise: statutory.esic.wageThresholdPaise,
        esicEmployerBps: statutory.esic.employerBps,
        gratuityAccrualBps: statutory.gratuity.accrualBps,
        pfOptedIn: emp.pfOptedIn,
        hadPriorPfMembership: emp.hadPriorPfMembership,
      });
      /* Labour welfare fund falls in named months, so a monthly package
         carries its share of the year rather than the whole charge. */
      const stateCode = row?.branchStateCode ?? "";
      const lwfRate = statutory.lwfByState[stateCode] ?? null;
      const lwfEmployerMonthly =
        lwfRate && (statutory.lwfApplicableByState[stateCode] ?? false)
          ? Math.round((lwfRate.employerPaise * lwfRate.deductionMonths.length) / 12)
          : 0;
      monthlyCtcPaise =
        full.grossPaise +
        cost.pf +
        cost.esic +
        cost.gratuity +
        cost.bonus +
        cost.other +
        lwfEmployerMonthly;
    }

    /* The rate card only where it says something the earnings column does
       not. Paid in full with no arrear, the two are the same figures. */
    const ratesDiffer =
      rates.length !== earnings.length ||
      earnings.some(
        (e, i) => e.amountPaise !== rates[i]?.amountPaise || e.arrearPaise !== 0,
      );

    out.set(r.employeeId, {
      header: {
        companyName: company?.name ?? "",
        companyAddressLines,
        logoUrl: company?.logoUrl ?? null,
        name: r.name,
        employeeId: r.empCode,
        joiningDate: slipDate(emp?.dateOfJoining),
        pfNumber: company?.pfCode ?? "",
        esicIp: emp?.esicIp ?? "",
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
      rates: ratesDiffer ? rates : [],
      ratesTotalPaise: ratesDiffer ? ratesTotalPaise : 0,
      earnings,
      arrearTotalPaise: earnings.reduce((a, x) => a + x.arrearPaise, 0),
      grossPaise: r.grossPaise,
      deductions,
      deductionsTotalPaise: r.deductionsPaise,
      employerContributions,
      employerTotalPaise: employerContributions.reduce((a, x) => a + x.amountPaise, 0),
      monthlyCtcPaise,
      annualCtcPaise: monthlyCtcPaise * 12,
      netPaise: r.netPaise,
      netInWords: rupeesInWords(r.netPaise).replace(/^Rupees/, "Indian Rupees"),
      warnings: r.warnings,
    });
  }

  return out;
}
