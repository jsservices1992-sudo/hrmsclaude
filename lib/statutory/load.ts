import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { validatePan } from "../tax/engine";
import { effectiveAsOf } from "../payroll/statutory";
import {
  buildEcrLine,
  formatEcrFile,
  computeChallan,
  reconcileWithRegister,
  blockingIssues,
  isEpsEligible,
  ageAsOfMonth,
  EPF_CHARGES_2026,
  ECR_VERSION,
  ECR_VERIFIED,
  type EcrLine,
} from "./ecr";
import {
  buildEsicLine,
  formatEsicCsv,
  summariseEsicReturn,
  buildHalfYearlyReturn,
  reconcileEsic,
  periodOf,
  monthsOfPeriod,
  type EsicReturnLine,
  type ZeroWageReason,
} from "./esic-return";
import {
  summarisePf,
  summariseEsic,
  summariseTds,
  summarisePt,
  summariseLwf,
  wageRegister,
  employeeRegister,
  attendanceRegister,
  leaveRegister,
  bonusRegister,
  CODE,
  type RegisterLine,
} from "./summaries";
import { calendarFor, trackStatus, filingKey, type CompanyRegistrations } from "./calendar";

/** Run states in which the figures have actually been signed off. */
export const APPROVED_STATUSES = new Set([
  "approved",
  "finalised",
  "disbursed",
  "closed",
]);

/** The run whose figures a return is built from. */
export async function latestRunFor(companyId: string, year: number, month: number) {
  const [run] = await db
    .select()
    .from(s.payrollRuns)
    .where(
      and(
        eq(s.payrollRuns.companyId, companyId),
        eq(s.payrollRuns.periodYear, year),
        eq(s.payrollRuns.periodMonth, month),
      ),
    )
    .orderBy(desc(s.payrollRuns.version))
    .limit(1);
  return run ?? null;
}

export type LoadedRegister = {
  run: typeof s.payrollRuns.$inferSelect;
  lines: RegisterLine[];
  employees: Map<string, typeof s.employees.$inferSelect>;
  summaries: Map<string, typeof s.payrollEmployeeSummaries.$inferSelect>;
};

/** The payroll register for a period, shaped for the statutory engines. */
export async function loadRegister(
  companyId: string,
  year: number,
  month: number,
): Promise<LoadedRegister | null> {
  const run = await latestRunFor(companyId, year, month);
  if (!run) return null;

  const rows = await db
    .select({ line: s.payrollLines, emp: s.employees, branch: s.branches })
    .from(s.payrollLines)
    .innerJoin(s.employees, eq(s.payrollLines.employeeId, s.employees.id))
    .innerJoin(s.branches, eq(s.employees.branchId, s.branches.id))
    .where(eq(s.payrollLines.runId, run.id));

  const summaryRows = await db
    .select()
    .from(s.payrollEmployeeSummaries)
    .where(eq(s.payrollEmployeeSummaries.runId, run.id));

  const summaries = new Map(summaryRows.map((r) => [r.employeeId, r]));
  const employees = new Map<string, typeof s.employees.$inferSelect>();
  const byEmployee = new Map<string, RegisterLine>();

  for (const { line, emp, branch } of rows) {
    employees.set(emp.id, emp);

    let entry = byEmployee.get(emp.id);
    if (!entry) {
      entry = {
        employeeId: emp.id,
        empCode: emp.empCode,
        name: `${emp.firstName} ${emp.lastName}`,
        branchId: branch.id,
        branchName: branch.name,
        stateCode: branch.stateCode,
        grossPaise: summaries.get(emp.id)?.grossPaise ?? 0,
        amounts: {},
      };
      byEmployee.set(emp.id, entry);
    }
    // Several lines can share a code across a run; sum rather than
    // overwrite, or a second instalment would silently replace the first.
    entry.amounts[line.code] = (entry.amounts[line.code] ?? 0) + line.amountPaise;
  }

  const lines = [...byEmployee.values()].sort((a, b) =>
    a.empCode.localeCompare(b.empCode),
  );

  return { run, lines, employees, summaries };
}

/* ==================================================================
   EPF
   ================================================================== */

export type EpfReturn = {
  lines: EcrLine[];
  file: string;
  challan: ReturnType<typeof computeChallan>;
  reconciliation: ReturnType<typeof reconcileWithRegister>;
  blocking: string[];
  version: string;
  verified: boolean;
  warnings: string[];
};

export async function buildEpfReturn(
  register: LoadedRegister,
  epsBps = 833,
): Promise<EpfReturn> {
  const members = register.lines.filter(
    (l) => (l.amounts[CODE.pfEmployee] ?? 0) > 0,
  );

  const exits = await db
    .select()
    .from(s.exitCases)
    .where(
      inArray(
        s.exitCases.employeeId,
        members.map((m) => m.employeeId),
      ),
    );
  const exitByEmployee = new Map(exits.map((e) => [e.employeeId, e]));

  const pensionWarnings: string[] = [];

  const lines = members.map((m) => {
    const emp = register.employees.get(m.employeeId)!;
    const summary = register.summaries.get(m.employeeId);
    const exit = exitByEmployee.get(m.employeeId);
    const pfWagePaise = m.amounts[CODE.pfWages] ?? 0;

    const pension = isEpsEligible({
      hadPriorPfMembership: emp.hadPriorPfMembership,
      pfWagePaise,
      wageCeilingPaise: EPF_CHARGES_2026.wageCeilingPaise,
      ageAsOfPeriod: ageAsOfMonth(emp.dateOfBirth, register.run.periodYear, register.run.periodMonth),
      isInternationalWorker: false,
    });
    if (!pension.eligible) {
      pensionWarnings.push(`${emp.firstName} ${emp.lastName} (${emp.empCode}): ${pension.reason}`);
    }

    return buildEcrLine(
      {
        uan: emp.uan,
        memberName: `${emp.firstName} ${emp.lastName}`,
        empCode: emp.empCode,
        grossWagesPaise: m.grossPaise,
        epfWagesPaise: pfWagePaise,
        employeeContributionPaise: m.amounts[CODE.pfEmployee] ?? 0,
        employerContributionPaise:
          (m.amounts[CODE.pfEmployer] ?? 0) + (m.amounts[CODE.pension] ?? 0),
        // Days with no wages: the LOP already computed by the run.
        nonContributoryDays: Math.round(summary?.lopDays ?? 0),
        refundOfAdvancesPaise: 0,
        eligibleForPension: pension.eligible,
        isInternationalWorker: false,
        dateOfExit: emp.dateOfExit,
        reasonForLeaving: exit ? exit.exitType : emp.dateOfExit ? null : null,
      },
      EPF_CHARGES_2026,
      epsBps,
    );
  });

  const challan = computeChallan(lines, EPF_CHARGES_2026);

  const reconciliation = reconcileWithRegister({
    lines,
    challan,
    register: {
      employeeContributionPaise: members.reduce(
        (a, m) => a + (m.amounts[CODE.pfEmployee] ?? 0),
        0,
      ),
      employerContributionPaise: members.reduce(
        (a, m) =>
          a + (m.amounts[CODE.pfEmployer] ?? 0) + (m.amounts[CODE.pension] ?? 0),
        0,
      ),
      pensionPaise: members.reduce((a, m) => a + (m.amounts[CODE.pension] ?? 0), 0),
      epfWagesPaise: members.reduce((a, m) => a + (m.amounts[CODE.pfWages] ?? 0), 0),
    },
  });

  const warnings = [
    ...lines.flatMap((l) => l.warnings),
    ...reconciliation.warnings,
    ...pensionWarnings,
  ];

  // A return built from a run nobody approved is a draft of a draft.
  if (!APPROVED_STATUSES.has(register.run.status)) {
    warnings.push(
      `This return is built from version ${register.run.version}, which is ${register.run.status.replace(/_/g, " ")} rather than approved. Approve the run before filing, or the figures filed will not be the figures anyone signed off.`,
    );
  }

  if (members.some((m) => (m.amounts[CODE.pfWages] ?? 0) === 0)) {
    warnings.push(
      "Some members show no PF wage. A run calculated before PF wages were recorded on the register cannot produce a valid ECR — recalculate the period first.",
    );
  }

  if (!ECR_VERIFIED) {
    warnings.push(
      `The ECR layout (${ECR_VERSION}) has not been validated against a live EPFO upload. Treat the file as a draft.`,
    );
  }

  return {
    lines,
    file: formatEcrFile(lines),
    challan,
    reconciliation,
    blocking: blockingIssues(lines),
    version: ECR_VERSION,
    verified: ECR_VERIFIED,
    warnings,
  };
}

/* ==================================================================
   ESIC
   ================================================================== */

export type EsicReturn = {
  lines: EsicReturnLine[];
  file: string;
  summary: ReturnType<typeof summariseEsicReturn>;
  reconciliation: ReturnType<typeof reconcileEsic>;
  warnings: string[];
};

export function buildEsicReturn(register: LoadedRegister): EsicReturn {
  const covered = register.lines.filter(
    (l) => (l.amounts[CODE.esicEmployee] ?? 0) > 0,
  );

  const lines = covered.map((m) => {
    const emp = register.employees.get(m.employeeId)!;
    const summary = register.summaries.get(m.employeeId);
    const daysPaid = Math.round(summary?.paidDays ?? 0);

    // A zero-wage month needs a reason the portal recognises.
    const reason: ZeroWageReason =
      m.grossPaise > 0 ? "0" : emp.dateOfExit ? "2" : "1";

    return buildEsicLine({
      ipNumber: emp.esicIp,
      memberName: `${emp.firstName} ${emp.lastName}`,
      empCode: emp.empCode,
      daysPaid,
      monthlyWagesPaise: m.grossPaise,
      employeeContributionPaise: m.amounts[CODE.esicEmployee] ?? 0,
      employerContributionPaise: m.amounts[CODE.esicEmployer] ?? 0,
      lastWorkingDay: emp.dateOfExit,
      zeroWageReason: reason,
    });
  });

  const summary = summariseEsicReturn(lines);

  const reconciliation = reconcileEsic({
    summary,
    registerEmployeePaise: covered.reduce(
      (a, m) => a + (m.amounts[CODE.esicEmployee] ?? 0),
      0,
    ),
    registerEmployerPaise: covered.reduce(
      (a, m) => a + (m.amounts[CODE.esicEmployer] ?? 0),
      0,
    ),
  });

  return {
    lines,
    file: formatEsicCsv(lines),
    summary,
    reconciliation,
    warnings: [
      ...lines.flatMap((l) => l.warnings),
      ...summary.warnings,
      ...(reconciliation.matches ? [] : [reconciliation.note]),
    ],
  };
}

/** The half-yearly return, assembled from whatever monthly runs exist. */
export async function loadHalfYearly(
  companyId: string,
  year: number,
  month: number,
) {
  const period = periodOf(month);
  const months = monthsOfPeriod(period);

  const monthly: {
    month: number;
    memberCount: number;
    totalWagesPaise: number;
    totalPayablePaise: number;
  }[] = [];

  for (const m of months) {
    // October to March straddles the calendar year.
    const y = period === "oct_mar" && m <= 3 ? year + 1 : year;
    const register = await loadRegister(companyId, y, m);
    if (!register) continue;

    const esic = buildEsicReturn(register);
    if (esic.lines.length === 0) continue;

    monthly.push({
      month: m,
      memberCount: esic.summary.memberCount,
      totalWagesPaise: esic.summary.totalWagesPaise,
      totalPayablePaise: esic.summary.totalPayablePaise,
    });
  }

  return buildHalfYearlyReturn({ period, year, monthly });
}

/* ==================================================================
   Summaries — FR-PAY-6, 9, 12
   ================================================================== */

export async function buildSummaries(register: LoadedRegister, month: number, year: number) {
  const employees = [...register.employees.values()];

  const uan = new Map(employees.map((e) => [e.id, e.uan]));
  const ip = new Map(employees.map((e) => [e.id, e.esicIp]));
  const pan = new Map(employees.map((e) => [e.id, validatePan(e.pan).valid]));

  const jurisdictions = await db.select().from(s.jurisdictions);
  const ptStates = new Set(
    jurisdictions.filter((j) => j.ptApplicable).map((j) => j.stateCode),
  );

  /* Only the rows in force for this period. Reading every row and
     building a Map would let a superseded rate win on key collision,
     silently, whenever its row happened to come back last. */
  const asOf = `${year}-${String(month).padStart(2, "0")}-01`;
  const lwfRates = effectiveAsOf(await db.select().from(s.lwfRates), asOf);
  // The months each state actually collects in are configuration already,
  // so read them rather than re-deriving from the frequency label.
  const stateRules = new Map(
    lwfRates.map((r) => [
      r.stateCode,
      {
        frequency: r.frequency.replace(/_/g, "-"),
        collectionMonths: r.deductionMonths
          .split(",")
          .map((m) => Number(m.trim()))
          .filter((m) => Number.isInteger(m) && m >= 1 && m <= 12),
        employerMinimumPaise: r.employerMinimumPaise,
      },
    ]),
  );

  return {
    pf: summarisePf(register.lines, uan),
    esic: summariseEsic(register.lines, ip),
    tds: summariseTds(register.lines, pan),
    pt: summarisePt({ lines: register.lines, ptLevyingStates: ptStates }),
    lwf: summariseLwf({ lines: register.lines, stateRules, month }),
  };
}

/* ==================================================================
   Registers — FR-STAT-6
   ================================================================== */

export function buildWageRegister(register: LoadedRegister): string {
  return wageRegister(register.lines);
}

export async function buildEmployeeRegister(companyId: string): Promise<string> {
  const rows = await db
    .select({ emp: s.employees, branch: s.branches })
    .from(s.employees)
    .innerJoin(s.branches, eq(s.employees.branchId, s.branches.id))
    .where(eq(s.employees.companyId, companyId));

  return employeeRegister(
    rows.map(({ emp, branch }) => ({
      empCode: emp.empCode,
      name: `${emp.firstName} ${emp.lastName}`,
      gender: emp.gender,
      dateOfBirth: emp.dateOfBirth,
      dateOfJoining: emp.dateOfJoining,
      dateOfExit: emp.dateOfExit,
      designation: emp.designation,
      branchName: branch.name,
      stateCode: branch.stateCode,
      pan: emp.pan,
      uan: emp.uan,
      esicIp: emp.esicIp,
    })),
  );
}

/**
 * The attendance register — days worked, paid and lost, for one period.
 * Drawn from the same per-employee summary payroll itself was
 * calculated from, so it and the payslip can never disagree.
 */
export function buildAttendanceRegister(register: LoadedRegister): string {
  return attendanceRegister(
    [...register.employees.values()].map((emp) => {
      const sm = register.summaries.get(emp.id);
      return {
        empCode: emp.empCode,
        name: `${emp.firstName} ${emp.lastName}`,
        branchName:
          register.lines.find((l) => l.employeeId === emp.id)?.branchName ?? "",
        totalDays: sm?.totalDays ?? 0,
        paidDays: sm?.paidDays ?? 0,
        lopDays: sm?.lopDays ?? 0,
        offDaysWorked: sm?.offDaysWorked ?? 0,
      };
    }),
  );
}

/**
 * The leave register for one period — every employee and leave type
 * with any approved activity in it, alongside the balance as it stands
 * today. See `leaveRegister`'s own comment for why the balance is not
 * reconstructed as of the period.
 */
export async function buildLeaveRegister(
  companyId: string,
  year: number,
  month: number,
): Promise<string> {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const employees = await db
    .select({ id: s.employees.id, empCode: s.employees.empCode, firstName: s.employees.firstName, lastName: s.employees.lastName })
    .from(s.employees)
    .where(eq(s.employees.companyId, companyId));
  const empById = new Map(employees.map((e) => [e.id, e]));
  if (employees.length === 0) return leaveRegister([]);

  const empIds = employees.map((e) => e.id);

  const requests = await db
    .select({ req: s.leaveRequests, type: s.leaveTypes })
    .from(s.leaveRequests)
    .innerJoin(s.leaveTypes, eq(s.leaveRequests.leaveTypeId, s.leaveTypes.id))
    .where(
      and(inArray(s.leaveRequests.employeeId, empIds), eq(s.leaveRequests.status, "approved")),
    );

  /* Overlaps the period rather than falling entirely inside it — a
     leave spanning the month boundary is still this period's activity
     for the days that fall within it. The set is already narrowed to
     this company's employees and is small, so filtering here rather
     than in the query is not a real cost. */
  const inPeriod = requests.filter((r) => r.req.fromDate <= to && r.req.toDate >= from);

  const balances = await db
    .select()
    .from(s.leaveBalances)
    .where(inArray(s.leaveBalances.employeeId, empIds));
  const balanceByKey = new Map(balances.map((b) => [`${b.employeeId}|${b.leaveType}`, b]));

  const rows = new Map<string, { empCode: string; name: string; leaveTypeName: string; leaveTypeCode: string; employeeId: string; daysTakenInPeriod: number; lopDaysInPeriod: number }>();
  for (const { req, type } of inPeriod) {
    const emp = empById.get(req.employeeId);
    if (!emp) continue;
    const key = `${req.employeeId}|${type.code}`;
    const row = rows.get(key) ?? {
      empCode: emp.empCode,
      name: `${emp.firstName} ${emp.lastName}`,
      leaveTypeName: type.name,
      leaveTypeCode: type.code,
      employeeId: req.employeeId,
      daysTakenInPeriod: 0,
      lopDaysInPeriod: 0,
    };
    row.daysTakenInPeriod += req.days;
    row.lopDaysInPeriod += req.lopDays;
    rows.set(key, row);
  }

  return leaveRegister(
    [...rows.values()]
      .sort((a, b) => a.empCode.localeCompare(b.empCode) || a.leaveTypeName.localeCompare(b.leaveTypeName))
      .map((r) => {
        const bal = balanceByKey.get(`${r.employeeId}|${r.leaveTypeCode}`);
        return {
          empCode: r.empCode,
          name: r.name,
          leaveTypeName: r.leaveTypeName,
          daysTakenInPeriod: r.daysTakenInPeriod,
          lopDaysInPeriod: r.lopDaysInPeriod,
          currentBalanceDays: bal?.balanceDays ?? null,
          balanceAsOf: bal?.asOf ?? null,
        };
      }),
  );
}

/**
 * The bonus register — Payment of Bonus Act, Form C — assembled across
 * a financial year's runs the same way the half-yearly ESIC return is:
 * each month contributes what it actually calculated, so a month never
 * run is missing from the total rather than assumed to be zero.
 *
 * Assumes an April-start financial year, the convention this codebase
 * seeds every other statutory figure on; a company set to a different
 * start month is not yet read here.
 */
export async function buildBonusRegister(
  companyId: string,
  financialYearStartCalendarYear: number,
): Promise<string> {
  const components = await db
    .select({ code: s.payComponents.code, bonusBase: s.payComponents.bonusBase, bonusRole: s.payComponents.bonusRole })
    .from(s.payComponents)
    .where(eq(s.payComponents.companyId, companyId));
  const bonusBaseCodes = new Set(components.filter((c) => c.bonusBase).map((c) => c.code));
  const bonusPaidCodes = new Set(components.filter((c) => c.bonusRole === "statutory_bonus").map((c) => c.code));

  const eligibilityParamVersions = await db
    .select()
    .from(s.statutoryParams)
    .where(eq(s.statutoryParams.key, "bonus.eligibility_wage"));
  const eligibilityWagePaise = effectiveAsOf(
    eligibilityParamVersions,
    `${financialYearStartCalendarYear}-04-01`,
  )[0]?.value;

  type Acc = { empCode: string; name: string; bonusBaseWagePaise: number; bonusPaidPaise: number; monthsIncluded: number };
  const byEmployee = new Map<string, Acc>();

  const monthsInFy: { calendarYear: number; month: number }[] = [
    ...Array.from({ length: 9 }, (_, i) => ({ calendarYear: financialYearStartCalendarYear, month: i + 4 })),
    ...Array.from({ length: 3 }, (_, i) => ({ calendarYear: financialYearStartCalendarYear + 1, month: i + 1 })),
  ];

  for (const { calendarYear, month } of monthsInFy) {
    const register = await loadRegister(companyId, calendarYear, month);
    if (!register) continue;

    for (const line of register.lines) {
      const acc = byEmployee.get(line.employeeId) ?? {
        empCode: line.empCode,
        name: line.name,
        bonusBaseWagePaise: 0,
        bonusPaidPaise: 0,
        monthsIncluded: 0,
      };
      for (const [code, amount] of Object.entries(line.amounts)) {
        if (bonusBaseCodes.has(code)) acc.bonusBaseWagePaise += amount;
        if (bonusPaidCodes.has(code)) acc.bonusPaidPaise += amount;
      }
      acc.monthsIncluded += 1;
      byEmployee.set(line.employeeId, acc);
    }
  }

  return bonusRegister(
    [...byEmployee.values()]
      .sort((a, b) => a.empCode.localeCompare(b.empCode))
      .map((r) => ({
        ...r,
        eligible:
          eligibilityWagePaise === undefined || r.monthsIncluded === 0
            ? true
            : r.bonusBaseWagePaise / r.monthsIncluded <= eligibilityWagePaise,
      })),
    12,
  );
}

/* ==================================================================
   Compliance calendar — FR-STAT-5
   ================================================================== */

export async function loadCalendar(args: {
  companyId: string;
  year: number;
  month: number;
  today?: string;
}) {
  const [company] = await db
    .select()
    .from(s.companies)
    .where(eq(s.companies.id, args.companyId))
    .limit(1);
  if (!company) return null;

  const branches = await db
    .select()
    .from(s.branches)
    .where(eq(s.branches.companyId, args.companyId));

  const jurisdictions = await db.select().from(s.jurisdictions);
  const branchStates = [...new Set(branches.map((b) => b.stateCode))];

  const registrations: CompanyRegistrations = {
    hasPfCode: Boolean(company.pfCode),
    hasEsicCode: Boolean(company.esicCode),
    hasTan: Boolean(company.tan),
    branchStates,
    ptStates: jurisdictions.filter((j) => j.ptApplicable).map((j) => j.stateCode),
    lwfStates: jurisdictions.filter((j) => j.lwfApplicable).map((j) => j.stateCode),
  };

  const items = calendarFor({
    registrations,
    periodYear: args.year,
    periodMonth: args.month,
  });

  const stored = await db
    .select()
    .from(s.statutoryFilings)
    .where(
      and(
        eq(s.statutoryFilings.companyId, args.companyId),
        eq(s.statutoryFilings.periodYear, args.year),
        eq(s.statutoryFilings.periodMonth, args.month),
      ),
    );

  const lodged = new Map(
    stored.map((r) => [
      r.filingKey,
      {
        status: r.status,
        reference: r.filingReference,
        owner: r.owner,
        filedAt: r.filedAt,
      },
    ]),
  );

  const today = args.today ?? new Date().toISOString().slice(0, 10);
  const tracked = trackStatus(items, lodged, today);

  return {
    company,
    registrations,
    items: tracked,
    overdue: tracked.filter((t) => t.status === "overdue"),
    filed: tracked.filter((t) => t.status === "filed"),
    missingRegistrations: [
      !company.pfCode && "PF code",
      !company.esicCode && "ESIC code",
      !company.tan && "TAN",
    ].filter((x): x is string => Boolean(x)),
  };
}

export { filingKey };
