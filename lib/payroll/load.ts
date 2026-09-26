import "server-only";

/* The headcount each Act reaches from. Defaults, not law-by-state: a
   company that differs says so with its coverage setting. */
const EPF_HEADCOUNT_THRESHOLD = 20;
const ESIC_HEADCOUNT_THRESHOLD = 10;
import { and, asc, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  computeEmployeePay,
  summariseRun,
  DEFAULT_STRUCTURE,
  type CompanyConfig,
  type StatutoryConfig,
  type EmployeeInput,
  type EmployeePayResult,
  type RunTotals,
  type PayLine,
} from "./engine";
import type { ProrationBasis } from "./proration";
import type { RoundingMode } from "./money";
import {
  resolveDepartmentConventions,
  type DepartmentOverride,
  type PayrollConventions,
} from "./settings";
import { effectiveAsOf, type PtSlab, type LwfCategory,
  type LwfRate } from "./statutory";
import {
  anchorsFrom,
  grossForTargetTakeHome,
  BONUS_DEFAULTS,
  GRATUITY_ACCRUAL_BPS,
  type ComponentSpec,
} from "./compensation";
import {
  buildComponentSpecs,
  resolveStructureId,
  type StructureLineJoined,
  type ResolvedStructureSource,
} from "./structures";
import type { RecoverableLoan } from "../loans/engine";

function periodEndDate(year: number, month: number) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

/**
 * The financial year a contribution period belongs to. Jan–Mar fall in the
 * Oct–Mar period that began in the *previous* calendar year.
 */
export function contributionPeriodKey(year: number, month: number) {
  const period = month >= 4 && month <= 9 ? "apr_sep" : "oct_mar";
  const financialYear = month >= 4 ? year : year - 1;
  return { period, financialYear } as const;
}

/**
 * Statutory config as at a date — the effective-dated lookup.
 *
 * `companyId`, where given, is what lets a company's own minimum wage
 * rows — for a notified schedule the shared, general-employment figure
 * does not fit — be seen at all; without it only the shared rows come
 * back and a company override resolves to nothing.
 */
export async function loadStatutoryConfig(
  asOf: string,
  companyId?: string | null,
): Promise<StatutoryConfig> {
  const effective = <T extends { effectiveFrom: string; effectiveTo: string | null }>(rows: T[]) =>
    effectiveAsOf(rows, asOf);

  const [params, slabs, lwf, juris, minWages] = await Promise.all([
    db.select().from(s.statutoryParams),
    db.select().from(s.ptSlabs).orderBy(asc(s.ptSlabs.minPaise)),
    db.select().from(s.lwfRates),
    db.select().from(s.jurisdictions),
    companyId
      ? db
          .select()
          .from(s.minimumWages)
          .where(or(isNull(s.minimumWages.companyId), eq(s.minimumWages.companyId, companyId)))
      : db.select().from(s.minimumWages).where(isNull(s.minimumWages.companyId)),
  ]);

  const p = Object.fromEntries(effective(params).map((r) => [r.key, r.value]));

  const ptSlabsByState: Record<string, PtSlab[]> = {};
  for (const row of effective(slabs)) {
    (ptSlabsByState[row.stateCode] ??= []).push({
      minPaise: row.minPaise,
      maxPaise: row.maxPaise,
      amountPaise: row.amountPaise,
      overrideMonth: row.overrideMonth,
      overrideAmountPaise: row.overrideAmountPaise,
      gender: row.gender,
      annualCapPaise: row.annualCapPaise,
      requiresIncomeTaxLiability: row.requiresIncomeTaxLiability,
    });
  }
  for (const code of Object.keys(ptSlabsByState)) {
    ptSlabsByState[code].sort((a, b) => a.minPaise - b.minPaise);
  }

  const lwfByState: Record<string, LwfRate | null> = {};
  for (const row of effective(lwf)) {
    lwfByState[row.stateCode] = {
      employeePaise: row.employeePaise,
      employerPaise: row.employerPaise,
      employeePercentBps: row.employeePercentBps,
      employerMultiple: row.employerMultiple,
      frequency: row.frequency,
      deductionMonths: row.deductionMonths.split(",").map(Number),
      minEstablishmentHeadcount: row.minEstablishmentHeadcount,
      employerMinimumPaise: row.employerMinimumPaise,
      governmentPaise: row.governmentPaise,
      exclusion:
        row.excludeAboveWagePaise === null
          ? null
          : {
              aboveWagePaise: row.excludeAboveWagePaise,
              categories: (row.excludedCategories ?? "")
                .split(",")
                .map((c) => c.trim())
                .filter((c): c is LwfCategory => c === "managerial" || c === "supervisory"),
            },
    };
  }

  return {
    epf: {
      wageCeilingPaise: p["epf.wage_ceiling"] ?? 1_500_000,
      employeeBps: p["epf.employee_bps"] ?? 1200,
      employerBps: p["epf.employer_bps"] ?? 1200,
      epsBps: p["epf.eps_bps"] ?? 833,
      epsCeilingPaise: p["epf.eps_ceiling"] ?? 1_500_000,
    },
    esic: {
      wageThresholdPaise: p["esic.wage_threshold"] ?? 2_100_000,
      /* ₹176 a day: at or below it the employee owes no share of their own. */
      lowWageDailyPaise: p["esic.low_wage_daily_limit"] ?? 17_600,
      employeeBps: p["esic.employee_bps"] ?? 75,
      employerBps: p["esic.employer_bps"] ?? 325,
    },
    gratuity: {
      accrualBps: p["gratuity.accrual_bps"] ?? GRATUITY_ACCRUAL_BPS,
    },
    minimumWages: effective(minWages).map((r) => ({
      stateCode: r.stateCode,
      zone: r.zone,
      companyId: r.companyId,
      skillCategory: r.skillCategory,
      monthlyPaise: r.monthlyPaise,
      effectiveFrom: r.effectiveFrom,
    })),
    /* Percentages are held in basis points like every other rate here,
       so 8.33% is 833 and nobody has to remember which keys are which. */
    bonus: {
      eligibilityWagePaise:
        p["bonus.eligibility_wage"] ?? BONUS_DEFAULTS.eligibilityWagePaise,
      calculationCeilingPaise:
        p["bonus.calculation_ceiling"] ?? BONUS_DEFAULTS.calculationCeilingPaise,
      minPercent: (p["bonus.min_bps"] ?? BONUS_DEFAULTS.minPercent * 100) / 100,
      maxPercent: (p["bonus.max_bps"] ?? BONUS_DEFAULTS.maxPercent * 100) / 100,
    },
    bonusHeadcountThreshold: p["bonus.headcount_threshold"] ?? 20,
    wageCodeMinimumShareBps: p["wage_code.minimum_share_bps"] ?? 5000,
    ptSlabsByState,
    ptApplicableByState: Object.fromEntries(juris.map((j) => [j.stateCode, j.ptApplicable])),
    lwfByState,
    lwfApplicableByState: Object.fromEntries(juris.map((j) => [j.stateCode, j.lwfApplicable])),
  };
}

/**
 * The company's configured components. Falls back to DEFAULT_STRUCTURE only
 * when a company has none, so a fresh tenant still computes something.
 */
/**
 * The flat component list, memoised for the life of one request.
 *
 * Every tax worksheet loads it, and a payroll run loads a worksheet per
 * employee — so a hundred people meant a hundred identical queries for
 * a list that cannot change while the run is being computed. The cache
 * is per server instance and short-lived on purpose: payroll is
 * recomputed often enough that a stale structure would be noticed, and
 * editing one revalidates the pages that read it.
 */
const structureCache = new Map<string, { at: number; value: ComponentSpec[] }>();
const STRUCTURE_TTL_MS = 5_000;

export async function loadStructure(companyId: string): Promise<ComponentSpec[]> {
  const cached = structureCache.get(companyId);
  if (cached && Date.now() - cached.at < STRUCTURE_TTL_MS) return cached.value;

  const rows = await db
    .select()
    .from(s.payComponents)
    .where(
      and(eq(s.payComponents.companyId, companyId), eq(s.payComponents.active, true)),
    )
    .orderBy(asc(s.payComponents.sequence));

  if (rows.length === 0) {
    structureCache.set(companyId, { at: Date.now(), value: DEFAULT_STRUCTURE });
    return DEFAULT_STRUCTURE;
  }

  const specs = rows.map((r) => ({
    code: r.code,
    label: r.name,
    kind: r.kind,
    calcMethod: r.calcMethod,
    percentValue: r.percentValue,
    percentOfCode: r.percentOfCode,
    fixedPaise: r.fixedPaise,
    taxable: r.taxable,
    epfBase: r.epfBase,
    esicBase: r.esicBase,
    esicTreatment: r.esicTreatment,
    ptBase: r.ptBase,
    bonusBase: r.bonusBase,
    gratuityBase: r.gratuityBase,
    prorates: r.prorates,
    sequence: r.sequence,
  }));

  structureCache.set(companyId, { at: Date.now(), value: specs });
  return specs;
}

export type StructureResolution = {
  structureId: string | null;
  source: ResolvedStructureSource;
  components: ComponentSpec[];
  presentation: StructurePresentation;
};

export type StructureResolutionContext = {
  structuresById: Map<string, ComponentSpec[]>;
  /** What each structure's payslip is about — see StructurePresentation. */
  presentationById: Map<string, StructurePresentation>;
  deptOverrideByDept: Map<string, string>;
  defaultStructureId: string | null;
  fallback: ComponentSpec[];
};

/**
 * What a structure's payslip shows, as distinct from what it pays.
 *
 * A company paying eight people a net in hand has no cost to company to
 * print and no employer contribution to print either; doing it anyway
 * puts figures on a payslip that nobody agreed to and that the employee
 * cannot check. None of this touches a deduction — that is the statutory
 * side, decided from coverage and the person's own record.
 */
export type StructurePresentation = {
  payBasis: "nth_only" | "gross" | "ctc";
  showCtcOnPayslip: boolean;
  showEmployerContribution: boolean;
  hideZeroComponents: boolean;
};

/** What a company with no structures of its own has always shown. */
export const DEFAULT_PRESENTATION: StructurePresentation = {
  payBasis: "ctc",
  showCtcOnPayslip: true,
  showEmployerContribution: true,
  hideZeroComponents: true,
};

/**
 * Everything needed to resolve, per employee, which set of pay components
 * actually applies to them. A company with no salaryStructures rows gets
 * an empty structuresById and a null defaultStructureId, so every
 * employee resolves to the untouched loadStructure() fallback below —
 * this is what keeps existing companies computing exactly as before.
 */
export async function loadStructureResolutionContext(
  companyId: string,
): Promise<StructureResolutionContext> {
  const [structureRows, lineRows, deptOverrideRows, fallback] = await Promise.all([
    db
      .select()
      .from(s.salaryStructures)
      .where(and(eq(s.salaryStructures.companyId, companyId), eq(s.salaryStructures.active, true))),
    db
      .select({
        structureId: s.salaryStructureLines.structureId,
        sequence: s.salaryStructureLines.sequence,
        calcMethodOverride: s.salaryStructureLines.calcMethodOverride,
        percentValueOverride: s.salaryStructureLines.percentValueOverride,
        fixedPaiseOverride: s.salaryStructureLines.fixedPaiseOverride,
        componentCode: s.payComponents.code,
        componentLabel: s.payComponents.name,
        componentKind: s.payComponents.kind,
        componentCalcMethod: s.payComponents.calcMethod,
        componentPercentValue: s.payComponents.percentValue,
        componentPercentOfCode: s.payComponents.percentOfCode,
        componentFixedPaise: s.payComponents.fixedPaise,
        componentTaxable: s.payComponents.taxable,
        componentEpfBase: s.payComponents.epfBase,
        componentEsicBase: s.payComponents.esicBase,
        componentEsicTreatment: s.payComponents.esicTreatment,
        componentPtBase: s.payComponents.ptBase,
        componentBonusBase: s.payComponents.bonusBase,
        componentGratuityBase: s.payComponents.gratuityBase,
        componentProrates: s.payComponents.prorates,
      })
      .from(s.salaryStructureLines)
      .innerJoin(s.payComponents, eq(s.salaryStructureLines.componentId, s.payComponents.id)),
    db
      .select()
      .from(s.departmentSalaryStructureOverrides)
      .where(eq(s.departmentSalaryStructureOverrides.companyId, companyId)),
    loadStructure(companyId),
  ]);

  const linesByStructure = new Map<string, StructureLineJoined[]>();
  for (const l of lineRows) {
    const list = linesByStructure.get(l.structureId) ?? [];
    list.push(l);
    linesByStructure.set(l.structureId, list);
  }

  const structuresById = new Map(
    structureRows.map((st) => [st.id, buildComponentSpecs(linesByStructure.get(st.id) ?? [])]),
  );
  const presentationById = new Map<string, StructurePresentation>(
    structureRows.map((st) => [
      st.id,
      {
        payBasis: st.payBasis,
        showCtcOnPayslip: st.showCtcOnPayslip,
        showEmployerContribution: st.showEmployerContribution,
        hideZeroComponents: st.hideZeroComponents,
      },
    ]),
  );
  const deptOverrideByDept = new Map(deptOverrideRows.map((r) => [r.departmentId, r.structureId]));
  /* There should be exactly one default, and every write path now
     enforces that. Older data can still carry two — and picking the
     first row was picking by query order, which is how an employee ends
     up resolving to an empty structure and being paid nothing. A default
     with components in it wins over one without. */
  const defaults = structureRows.filter((st) => st.isDefault);
  const defaultStructureId =
    defaults.find((st) => (structuresById.get(st.id)?.length ?? 0) > 0)?.id ??
    defaults[0]?.id ??
    null;

  return { structuresById, presentationById, deptOverrideByDept, defaultStructureId, fallback };
}

export function resolveEmployeeStructure(
  ctx: StructureResolutionContext,
  args: { employeeStructureId: string | null; employeeDepartmentId: string | null },
): StructureResolution {
  const { structureId, source } = resolveStructureId({
    employeeStructureId: args.employeeStructureId,
    employeeDepartmentId: args.employeeDepartmentId,
    deptOverrideByDept: ctx.deptOverrideByDept,
    defaultStructureId: ctx.defaultStructureId,
  });
  if (structureId && ctx.structuresById.has(structureId)) {
    return {
      structureId,
      source,
      components: ctx.structuresById.get(structureId)!,
      presentation: ctx.presentationById.get(structureId) ?? DEFAULT_PRESENTATION,
    };
  }
  return {
    structureId: null,
    source: "fallback_flat_components",
    components: ctx.fallback,
    presentation: DEFAULT_PRESENTATION,
  };
}

/** Which active employees currently resolve to a given structure, and how. */
export async function findCandidateEmployees(
  companyId: string,
  structureId: string,
): Promise<{ employeeId: string; name: string; empCode: string; source: ResolvedStructureSource }[]> {
  const ctx = await loadStructureResolutionContext(companyId);

  const [emps, salaryRows] = await Promise.all([
    db
      .select({
        id: s.employees.id,
        empCode: s.employees.empCode,
        firstName: s.employees.firstName,
        lastName: s.employees.lastName,
        departmentId: s.employees.departmentId,
      })
      .from(s.employees)
      .where(and(eq(s.employees.companyId, companyId), eq(s.employees.status, "active"))),
    db
      .select({ employeeId: s.employeeSalaries.employeeId, structureId: s.employeeSalaries.structureId })
      .from(s.employeeSalaries)
      .where(isNull(s.employeeSalaries.effectiveTo)),
  ]);
  const structureIdByEmployee = new Map(salaryRows.map((r) => [r.employeeId, r.structureId]));

  return emps
    .map((e) => {
      const resolved = resolveEmployeeStructure(ctx, {
        employeeStructureId: structureIdByEmployee.get(e.id) ?? null,
        employeeDepartmentId: e.departmentId,
      });
      return {
        employeeId: e.id,
        name: `${e.firstName} ${e.lastName}`,
        empCode: e.empCode,
        source: resolved.source,
        structureId: resolved.structureId,
      };
    })
    .filter((r) => r.structureId === structureId)
    .map(({ employeeId, name, empCode, source }) => ({ employeeId, name, empCode, source }));
}

export type PreviewResult = {
  company: typeof s.companies.$inferSelect;
  results: EmployeePayResult[];
  totals: RunTotals;
  asOf: string;
  /**
   * People who should have been in this run and are not.
   *
   * The query below joins to a current salary, so anyone without one
   * drops out of the result set — and used to drop out of payroll
   * entirely, unannounced. Nobody is told on the 30th that four of
   * thirty employees are missing; they simply are not paid, and the
   * totals look like a complete run because every row in them is
   * correct. Naming them is the difference between a payroll that is
   * short and a payroll that is wrong.
   */
  excluded: { employeeId: string; empCode: string; name: string; reason: string }[];
};

/**
 * Compute a period without persisting — the pre-run preview.
 * A finalised run would snapshot these lines plus the config versions used.
 */
export async function previewRun(args: {
  companyId: string;
  year: number;
  month: number;
}): Promise<PreviewResult | null> {
  const asOf = periodEndDate(args.year, args.month);

  const [company] = await db
    .select()
    .from(s.companies)
    .where(eq(s.companies.id, args.companyId))
    .limit(1);
  if (!company) return null;

  const statutory = await loadStatutoryConfig(asOf, args.companyId);
  const structureCtx = await loadStructureResolutionContext(args.companyId);

  const rows = await db
    .select({
      emp: s.employees,
      branch: s.branches,
      salary: s.employeeSalaries,
    })
    .from(s.employees)
    .innerJoin(s.branches, eq(s.employees.branchId, s.branches.id))
    .innerJoin(
      s.employeeSalaries,
      and(
        eq(s.employeeSalaries.employeeId, s.employees.id),
        lte(s.employeeSalaries.effectiveFrom, asOf),
        isNull(s.employeeSalaries.effectiveTo),
      ),
    )
    .where(
      and(
        eq(s.employees.companyId, args.companyId),
        lte(s.employees.dateOfJoining, asOf),
        or(isNull(s.employees.dateOfExit), eq(s.employees.status, "resigned")),
      ),
    );

  /*
   * Consultants and contractors are paid a fee, not a salary, and share
   * almost nothing with the engine below: no structure, no PF, no ESI,
   * no professional tax, no tax worksheet. They are separated here and
   * computed on their own so that none of that has to be defended
   * against inside the salary path.
   */
  const professionalRows = rows.filter(
    (r) => r.emp.paymentBasis === "professional_fee",
  );
  const rowsSalary = rows.filter((r) => r.emp.paymentBasis !== "professional_fee");

  /* Whether a job is managerial or supervisory decides some states'
     welfare fund exclusions. It sits on the grade, which is the
     job-level concept, and an employee may override it. */
  const lwfByGrade = new Map(
    (
      await db
        .select({ id: s.grades.id, lwfCategory: s.grades.lwfCategory })
        .from(s.grades)
        .where(eq(s.grades.companyId, args.companyId))
    ).map((g) => [g.id, g.lwfCategory]),
  );

  /* The headcount that matters for a floor is the establishment's, and
     the branch is the establishment: a company may run one branch over
     the line and another under it. */
  const headcountByBranch = new Map<string, number>();
  for (const { emp } of rowsSalary) {
    if (!emp.branchId) continue;
    headcountByBranch.set(emp.branchId, (headcountByBranch.get(emp.branchId) ?? 0) + 1);
  }

  const attendance = await db
    .select()
    .from(s.attendanceInputs)
    .where(
      and(
        eq(s.attendanceInputs.periodYear, args.year),
        eq(s.attendanceInputs.periodMonth, args.month),
      ),
    );
  const lopByEmployee = Object.fromEntries(
    attendance.map((a) => [a.employeeId, a.lopDays]),
  );
  const offDaysByEmployee = Object.fromEntries(
    attendance.map((a) => [a.employeeId, a.offDaysWorked]),
  );

  // Persisted ESIC coverage for this contribution period.
  const { period, financialYear } = contributionPeriodKey(args.year, args.month);
  const coverageRows = await db
    .select()
    .from(s.esicCoverage)
    .where(
      and(
        eq(s.esicCoverage.financialYear, financialYear),
        eq(s.esicCoverage.period, period),
      ),
    );
  const coverageByEmployee = Object.fromEntries(
    coverageRows.map((c) => [c.employeeId, c.covered]),
  );

  /*
   * Whether the Acts reach this establishment at all.
   *
   * Twenty for provident fund, ten for ESI — the thresholds the Acts
   * themselves carry. On "auto" the declared headcount decides; a
   * company that registered voluntarily, or holds an exemption, says so
   * instead. Nothing here excuses a person the Act does reach: this is
   * the establishment's own answer, asked once.
   */
  const headcount = company.declaredHeadcount;
  const coverageFor = (
    setting: string,
    threshold: number,
  ): boolean | undefined => {
    if (setting === "covered") return true;
    if (setting === "not_covered") return false;
    /* Auto, and nobody has said how many people work here: the product
       cannot decide, so it leaves the charge as it always was rather
       than quietly stopping a deduction. */
    if (headcount === null || headcount === undefined) return undefined;
    return headcount >= threshold;
  };
  const epfEstablishmentCovered = coverageFor(company.epfCoverage, EPF_HEADCOUNT_THRESHOLD);
  const esicEstablishmentCovered = coverageFor(company.esicCoverage, ESIC_HEADCOUNT_THRESHOLD);

  const companyConfig: CompanyConfig = {
    prorationBasis: company.prorationBasis as ProrationBasis,
    standardDays: company.standardDays,
    weeklyOffWorkTreatment: company.weeklyOffWorkTreatment,
    roundingMode: company.roundingMode as RoundingMode,
    roundComponents: company.roundComponents,
    roundGross: company.roundGross,
    roundNet: company.roundNet,
    epfOnActualBasic: company.epfOnActualBasic,
    // Placeholder — every employee gets their own resolved structure below.
    // This is only the base spread into configByDepartment before that.
    structure: structureCtx.fallback,
  };

  /*
   * Department overrides — a department can run different proration or
   * rounding conventions from the rest of the company (a factory floor
   * on working days while HQ runs calendar days is the real case). Only
   * the conventions are ever overridden; the statutory engine, the
   * component structure and everything else stays company-wide.
   */
  const deptOverrideRows = await db
    .select()
    .from(s.departmentPayrollOverrides)
    .where(eq(s.departmentPayrollOverrides.companyId, args.companyId));
  const companyConventions = {
    prorationBasis: companyConfig.prorationBasis,
    standardDays: companyConfig.standardDays,
    roundingMode: companyConfig.roundingMode,
    roundComponents: companyConfig.roundComponents ?? false,
    roundGross: companyConfig.roundGross ?? false,
    roundNet: companyConfig.roundNet ?? true,
  };
  const configByDepartment = new Map<string, CompanyConfig>(
    deptOverrideRows.map((row) => {
      const override: DepartmentOverride = {
        prorationBasis: (row.prorationBasis as ProrationBasis) ?? undefined,
        standardDays: row.standardDays ?? undefined,
        roundingMode: (row.roundingMode as RoundingMode) ?? undefined,
        roundComponents: row.roundComponents ?? undefined,
        roundGross: row.roundGross ?? undefined,
        roundNet: row.roundNet ?? undefined,
      };
      const resolved = resolveDepartmentConventions(companyConventions, override);
      return [row.departmentId, { ...companyConfig, ...resolved }];
    }),
  );

  /*
   * Projected TDS per employee — PRD §3.9. Imported dynamically because
   * the tax loader reads this module's loadStructure(); a static import
   * either way would close the cycle. By the time a run is previewed both
   * modules are fully initialised.
   */
  /* Every worksheet in a fixed number of queries rather than seven per
     employee. Measured before the change: 3.6s per employee against a
     hosted database, so a hundred people was several minutes — and
     running them in parallel did not help, because the queries inside
     one worksheet are a sequential chain the driver does not pipeline.
     Fewer queries was the fix, not overlapping them. */
  const { loadWorksheetsFor } = await import("../tax/load");
  const worksheets = await loadWorksheetsFor(rowsSalary.map(({ emp }) => emp.id));
  const tdsByEmployee = new Map<string, { paise: number; basis: string }>();
  /*
   * Independent of the TDS map above: a rebate under section 87A can
   * zero the final figure while taxable income still exceeds the
   * exemption limit, which is the actual test Punjab's PSDT asks — so
   * this reads `taxBeforeRebatePaise`, not whether anything was
   * deducted. See `incomeTaxPayee` on EmployeeInput.
   */
  const incomeTaxPayeeByEmployee = new Map<string, boolean>();
  for (const [employeeId, worksheet] of worksheets) {
    if (worksheet.projection.monthlyTdsPaise > 0) {
      tdsByEmployee.set(employeeId, {
        paise: worksheet.projection.monthlyTdsPaise,
        basis: worksheet.projection.basis,
      });
    }
    incomeTaxPayeeByEmployee.set(employeeId, worksheet.annual.tax.taxBeforeRebatePaise > 0);
  }

  /* Live loans and the scheme floor for each — PRD §3.10. The engine
     plans the recovery itself, because it is the only place that knows
     what statutory deductions have already taken. */
  const loanRows = await db
    .select({ loan: s.loans, scheme: s.loanSchemes })
    .from(s.loans)
    .leftJoin(s.loanSchemes, eq(s.loans.schemeId, s.loanSchemes.id))
    .where(
      and(
        inArray(
          s.loans.employeeId,
          rows.map(({ emp }) => emp.id),
        ),
        inArray(s.loans.status, ["active", "on_hold"]),
      ),
    );

  const loansByEmployee = new Map<string, RecoverableLoan[]>();
  const floorByEmployee = new Map<string, number>();

  for (const { loan, scheme } of loanRows) {
    // Recovery has not started for a loan disbursed but not yet due.
    if (
      loan.firstRecoveryYear !== null &&
      loan.firstRecoveryMonth !== null &&
      args.year * 12 + args.month <
        loan.firstRecoveryYear * 12 + loan.firstRecoveryMonth
    ) {
      continue;
    }

    const list = loansByEmployee.get(loan.employeeId) ?? [];
    list.push({
      loanId: loan.id,
      label: loan.scheme,
      outstandingPaise: loan.outstandingPaise,
      instalmentPaise: loan.instalmentPaise,
      arrearsPaise: loan.arrearsPaise,
      status: loan.status,
      startedOn: loan.startedOn,
    });
    loansByEmployee.set(loan.employeeId, list);

    // Where schemes differ, the strictest floor protects the employee.
    floorByEmployee.set(
      loan.employeeId,
      Math.max(
        floorByEmployee.get(loan.employeeId) ?? 0,
        scheme?.minNetPayPaise ?? 0,
      ),
    );
  }

  /* One-off incentives and ad-hoc deductions for this period only — not a
     recurring pay component, not a recoverable loan. */
  const adjustmentRows = await db
    .select({
      adj: s.payrollAdjustments,
      esicTreatment: s.variablePayTypes.esicTreatment,
    })
    .from(s.payrollAdjustments)
    .leftJoin(s.variablePayTypes, eq(s.variablePayTypes.id, s.payrollAdjustments.typeId))
    .where(
      and(
        eq(s.payrollAdjustments.periodYear, args.year),
        eq(s.payrollAdjustments.periodMonth, args.month),
        inArray(
          s.payrollAdjustments.employeeId,
          rows.map(({ emp }) => emp.id),
        ),
      ),
    );
  const adjustmentsByEmployee = new Map<string, EmployeeInput["oneOffLines"]>();
  for (const { adj, esicTreatment } of adjustmentRows) {
    const list = adjustmentsByEmployee.get(adj.employeeId) ?? [];
    list!.push({
      code: adj.code,
      label: adj.label,
      kind: adj.kind,
      category: adj.category,
      esicTreatment,
      amountPaise: adj.amountPaise,
      reason: adj.reason ?? undefined,
    });
    adjustmentsByEmployee.set(adj.employeeId, list);
  }

  const departmentByEmployee = new Map(rowsSalary.map((r) => [r.emp.id, r.emp.departmentId]));
  const structureIdByEmployee = new Map(rowsSalary.map((r) => [r.emp.id, r.salary.structureId]));
  /* Who was promised a net in hand rather than a gross. Their gross is a
     derived figure, re-solved below against this period's rates. */
  const agreedGrossByEmployee = new Map(
    rowsSalary.map((r) => [r.emp.id, r.salary.monthlyGrossPaise]),
  );
  const lockedTakeHomeByEmployee = new Map(
    rowsSalary
      .filter((r) => r.salary.payMode === "take_home" && (r.salary.targetTakeHomePaise ?? 0) > 0)
      .map((r) => [r.emp.id, r.salary.targetTakeHomePaise!]),
  );

  /* The professionals, computed on their own terms and merged in. */
  const { loadTdsRateConfig, loadFyToDate } = await import("./professional-load");
  const { computeProfessionalPay } = await import("./professional");
  const professionalResults: EmployeePayResult[] = [];
  if (professionalRows.length > 0) {
    const tdsRates = await loadTdsRateConfig(asOf);
    const fyStart = args.month >= 4 ? args.year : args.year - 1;
    const fyToDate = await loadFyToDate({
      companyId: args.companyId,
      employeeIds: professionalRows.map((r) => r.emp.id),
      financialYear: fyStart,
    });
    for (const { emp, salary } of professionalRows) {
      const ytd = fyToDate.get(emp.id) ?? { paidPaise: 0, tdsPaise: 0 };
      professionalResults.push(
        computeProfessionalPay({
          payee: {
            id: emp.id,
            name: `${emp.firstName} ${emp.lastName}`,
            empCode: emp.empCode,
            agreedMonthlyPaise: salary.monthlyGrossPaise,
            agreedIs: emp.feeIsNetOfTds ? "net_of_tds" : "gross",
            /* Nothing is assumed about the nature of the payment: without
               it there is no rate, and the payslip says so. */
            nature: emp.tdsNature ?? "194J_professional",
            hasPan: Boolean(emp.pan),
            dateOfJoining: emp.dateOfJoining,
            dateOfExit: emp.dateOfExit,
            fyPaidBeforePaise: ytd.paidPaise,
            fyTdsBeforePaise: ytd.tdsPaise,
            oneOffLines: adjustmentsByEmployee.get(emp.id),
          },
          rates: tdsRates,
          year: args.year,
          month: args.month,
        }),
      );
      if (!emp.tdsNature) {
        professionalResults[professionalResults.length - 1].warnings.push(
          "No TDS section is set for this payee. Set one on their record — 194J for professional fees, 194C for contract work.",
        );
      }
    }
  }

  const results = rowsSalary
    .map(({ emp, branch, salary }): EmployeeInput => {
      const gross = salary.monthlyGrossPaise;
      return {
        id: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        empCode: emp.empCode,
        gender: emp.gender,
        stateCode: branch.stateCode,
        lwfCategory:
          emp.lwfCategory ?? (emp.gradeId ? lwfByGrade.get(emp.gradeId) ?? null : null),
        establishmentHeadcount: emp.branchId
          ? headcountByBranch.get(emp.branchId) ?? 0
          : null,
        esicImplementedArea: branch.esicImplementedArea,
        monthlyGrossPaise: gross,
        dateOfJoining: emp.dateOfJoining,
        dateOfExit: emp.dateOfExit,
        lopDays: lopByEmployee[emp.id] ?? 0,
        offDaysWorked: offDaysByEmployee[emp.id] ?? 0,
        /* A UAN is proof of membership: somebody who joined within the
           wage ceiling stays a member after a raise takes them over it
           (EPF Scheme para 26). Reading the joining-time flag alone
           stopped their PF the month the raise landed. */
        hadPriorPfMembership: emp.hadPriorPfMembership || Boolean(emp.uan?.trim()),
        pfOptedIn: emp.pfOptedIn,
        dateOfBirth: emp.dateOfBirth,
        employerNpsBps: emp.employerNpsBps,
        pfApplicability: emp.pfApplicability,
        esicApplicability: emp.esicApplicability,
        ptApplicability: emp.ptApplicability,
        tdsApplicability: emp.tdsApplicability,
        /*
         * The person's own answer wins over the establishment's, in both
         * directions, because a company of a dozen routinely holds both
         * kinds of people: somebody carrying PF membership from a
         * previous job alongside somebody who has never been a member
         * and is not being enrolled.
         *
         * "yes" covers this person even where the establishment is
         * outside the Act — voluntary coverage, which is a real thing a
         * company does for one employee and not another. "no" takes them
         * out, and the run says so in its findings rather than letting
         * it pass unremarked: it is a claim about the law, and it is the
         * employer's to make and to answer for.
         */
        epfEstablishmentCovered:
          emp.pfApplicability === "yes"
            ? true
            : emp.pfApplicability === "no"
              ? false
              : epfEstablishmentCovered,
        esicEstablishmentCovered:
          emp.esicApplicability === "yes"
            ? true
            : emp.esicApplicability === "no"
              ? false
              : esicEstablishmentCovered,
        vpfPercent: emp.vpfPercent,
        // Read the stored decision for this contribution period. Falling back
        // to current wages only covers an employee with no record yet (a new
        // joiner mid-period), which is the correct default for them.
        esicCoveredAtPeriodStart:
          coverageByEmployee[emp.id] ??
          gross <= statutory.esic.wageThresholdPaise,
        ptYtdPaise: 0,
        monthlyTdsPaise: tdsByEmployee.get(emp.id)?.paise ?? 0,
        tdsBasis: tdsByEmployee.get(emp.id)?.basis,
        incomeTaxPayee: incomeTaxPayeeByEmployee.get(emp.id) ?? false,
        loans: loansByEmployee.get(emp.id),
        minNetPayPaise: floorByEmployee.get(emp.id) ?? 0,
        oneOffLines: adjustmentsByEmployee.get(emp.id),
      };
    })
    .map((employee) => {
      const deptId = departmentByEmployee.get(employee.id);
      const baseConfig = (deptId && configByDepartment.get(deptId)) || companyConfig;
      const resolved = resolveEmployeeStructure(structureCtx, {
        employeeStructureId: structureIdByEmployee.get(employee.id) ?? null,
        employeeDepartmentId: deptId ?? null,
      });
      const company: CompanyConfig = { ...baseConfig, structure: resolved.components };

      /* A fixed net in hand is a promise about the bottom line, so the
         gross has to move when the deductions under it move — a PF ceiling
         revision, a PT slab step, the higher February PT some states
         charge. Solving once at joining and storing the gross keeps the
         gross still and lets the net drift, which is backwards. */
      const lockedTakeHome = lockedTakeHomeByEmployee.get(employee.id);
      /* Basic, HRA and the rest stay at what was agreed; the balance
         component carries the month's difference. Both the solve and the
         engine below have to see these, or the engine re-derives what the
         solve just pinned. */
      const anchors = lockedTakeHome
        ? anchorsFrom(
            resolved.components,
            agreedGrossByEmployee.get(employee.id) ?? employee.monthlyGrossPaise,
          )
        : undefined;
      const forRun = lockedTakeHome
        ? {
            ...employee,
            componentAnchors: anchors,
            monthlyGrossPaise: grossForTargetTakeHome({
              targetMonthlyTakeHomePaise: lockedTakeHome,
              components: resolved.components,
              anchors,
              employer: {
                epfCeilingPaise: statutory.epf.wageCeilingPaise,
                epfEmployerBps: statutory.epf.employerBps,
                epfOnActualBasic: company.epfOnActualBasic,
                esicThresholdPaise: statutory.esic.wageThresholdPaise,
                esicEmployerBps: statutory.esic.employerBps,
                gratuityAccrualBps: statutory.gratuity.accrualBps,
                pfOptedIn: employee.pfOptedIn,
                hadPriorPfMembership: employee.hadPriorPfMembership,
                employerNpsBps: employee.employerNpsBps ?? 0,
              },
              stateCode: employee.stateCode,
              gender: employee.gender,
              month: args.month,
              pfOptedIn: employee.pfOptedIn,
              hadPriorPfMembership: employee.hadPriorPfMembership,
              /* The solver aims at the net that will actually arrive, so
                 it has to know which charges this establishment owes. */
              epfEstablishmentCovered: employee.epfEstablishmentCovered,
              esicEstablishmentCovered: employee.esicEstablishmentCovered,
              statutory,
            }).monthlyGrossPaise,
          }
        : employee;

      return computeEmployeePay({
        employee: forRun,
        company,
        statutory,
        year: args.year,
        month: args.month,
      });
    })
    .concat(professionalResults)
    .sort((a, b) => b.grossPaise - a.grossPaise);

  /* Everybody the join dropped. Read separately rather than made into a
     left join: the engine wants a salary, and giving it a null one to
     carry through every calculation trades a visible gap for a silent
     zero. */
  const paidIds = new Set(rows.map((r) => r.emp.id));
  const shouldBePaid = await db
    .select({
      id: s.employees.id,
      empCode: s.employees.empCode,
      firstName: s.employees.firstName,
      lastName: s.employees.lastName,
    })
    .from(s.employees)
    .where(
      and(
        eq(s.employees.companyId, args.companyId),
        eq(s.employees.status, "active"),
        lte(s.employees.dateOfJoining, asOf),
      ),
    );

  const excluded = shouldBePaid
    .filter((e) => !paidIds.has(e.id))
    .map((e) => ({
      employeeId: e.id,
      empCode: e.empCode,
      name: `${e.firstName} ${e.lastName}`,
      reason: "No salary on record as at this period — set one before running payroll.",
    }));

  return { company, results, totals: summariseRun(results), asOf, excluded };
}

export async function listCompanies() {
  return db.select().from(s.companies).orderBy(asc(s.companies.name));
}

export type RunDetailLine = {
  code: string;
  label: string;
  kind: "earning" | "deduction" | "employer_contribution" | "info";
  amountPaise: number;
  basis: string | null;
  sequence: number;
};

export type RunDetailEmployee = {
  employeeId: string;
  empCode: string;
  name: string;
  paidDays: number;
  totalDays: number;
  lopDays: number;
  grossPaise: number;
  deductionsPaise: number;
  employerCostPaise: number;
  netPaise: number;
  lines: RunDetailLine[];
};

export type RunVersionSummary = {
  id: string;
  version: number;
  status: string;
  supersedesVersion: number | null;
  preparedBy: string | null;
  approvedBy: string | null;
  calculatedAt: string | null;
  approvedAt: string | null;
  reopenReason: string | null;
};

export type RunDetail = {
  run: typeof s.payrollRuns.$inferSelect;
  company: typeof s.companies.$inferSelect;
  employees: RunDetailEmployee[];
  totals: {
    headcount: number;
    grossPaise: number;
    deductionsPaise: number;
    employerCostPaise: number;
    netPaise: number;
  };
  versionChain: RunVersionSummary[];
};

/**
 * Every run row for a period, in version order. Not a recursive
 * supersedesVersion walk — reopening can be invoked on any approved run,
 * not just the latest, so a strict linear-chain assumption isn't safe.
 * Listing every version in order (each annotated with what it supersedes)
 * is correct whether or not branching actually happens in practice.
 */
async function loadVersionChain(
  companyId: string,
  year: number,
  month: number,
): Promise<RunVersionSummary[]> {
  const rows = await db
    .select()
    .from(s.payrollRuns)
    .where(
      and(
        eq(s.payrollRuns.companyId, companyId),
        eq(s.payrollRuns.periodYear, year),
        eq(s.payrollRuns.periodMonth, month),
      ),
    )
    .orderBy(asc(s.payrollRuns.version));

  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    status: r.status,
    supersedesVersion: r.supersedesVersion,
    preparedBy: r.preparedBy,
    approvedBy: r.approvedBy,
    calculatedAt: r.calculatedAt,
    approvedAt: r.approvedAt,
    reopenReason: r.reopenReason,
  }));
}

/**
 * The saved snapshot of one specific run version — not a live recompute.
 * Powers the run detail page, so a reviewer sees exactly what was
 * calculated (and possibly approved), even if attendance or config has
 * since changed.
 */
export async function loadRunDetail(runId: string): Promise<RunDetail | null> {
  const [run] = await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.id, runId)).limit(1);
  if (!run) return null;

  const [company] = await db.select().from(s.companies).where(eq(s.companies.id, run.companyId)).limit(1);
  if (!company) return null;

  const [summaries, lines, emps, versionChain] = await Promise.all([
    db.select().from(s.payrollEmployeeSummaries).where(eq(s.payrollEmployeeSummaries.runId, runId)),
    db
      .select()
      .from(s.payrollLines)
      .where(eq(s.payrollLines.runId, runId))
      .orderBy(asc(s.payrollLines.sequence)),
    db
      .select({
        id: s.employees.id,
        empCode: s.employees.empCode,
        firstName: s.employees.firstName,
        lastName: s.employees.lastName,
      })
      .from(s.employees),
    loadVersionChain(run.companyId, run.periodYear, run.periodMonth),
  ]);

  const empById = new Map(emps.map((e) => [e.id, e]));
  const linesByEmp = new Map<string, RunDetailLine[]>();
  for (const l of lines) {
    const list = linesByEmp.get(l.employeeId) ?? [];
    list.push({ code: l.code, label: l.label, kind: l.kind, amountPaise: l.amountPaise, basis: l.basis, sequence: l.sequence });
    linesByEmp.set(l.employeeId, list);
  }

  const employees: RunDetailEmployee[] = summaries
    .map((sm) => {
      const e = empById.get(sm.employeeId);
      return {
        employeeId: sm.employeeId,
        empCode: e?.empCode ?? "",
        name: e ? `${e.firstName} ${e.lastName}` : "Unknown",
        paidDays: sm.paidDays,
        totalDays: sm.totalDays,
        lopDays: sm.lopDays,
        grossPaise: sm.grossPaise,
        deductionsPaise: sm.deductionsPaise,
        employerCostPaise: sm.employerCostPaise,
        netPaise: sm.netPaise,
        lines: linesByEmp.get(sm.employeeId) ?? [],
      };
    })
    .sort((a, b) => b.grossPaise - a.grossPaise);

  const totals = employees.reduce(
    (acc, e) => ({
      headcount: acc.headcount + 1,
      grossPaise: acc.grossPaise + e.grossPaise,
      deductionsPaise: acc.deductionsPaise + e.deductionsPaise,
      employerCostPaise: acc.employerCostPaise + e.employerCostPaise,
      netPaise: acc.netPaise + e.netPaise,
    }),
    { headcount: 0, grossPaise: 0, deductionsPaise: 0, employerCostPaise: 0, netPaise: 0 },
  );

  return { run, company, employees, totals, versionChain };
}

/* ==================================================================
   Figures of record — what a period actually paid
   ================================================================== */

/**
 * The subset of a pay result that a payslip or register needs. Narrower
 * than EmployeePayResult on purpose: a stored run keeps its lines and
 * totals, not the transient scaffolding the engine used to derive them.
 */
export type PayFigures = {
  employeeId: string;
  name: string;
  empCode: string;
  paidDays: number;
  totalDays: number;
  lopDays: number;
  lines: PayLine[];
  grossPaise: number;
  deductionsPaise: number;
  employerCostPaise: number;
  netPaise: number;
  warnings: string[];
};

export type PeriodFigures = {
  company: {
    id: string;
    name: string;
    /* Taken from the run where there is one: a run records the basis it
       was calculated on, which is the basis that period was actually paid
       on even if the company setting has changed since. */
    prorationBasis: string;
    roundingMode: string;
  };
  results: PayFigures[];
  totals: RunTotals;
  /** When these figures were fixed; for a preview, today. */
  asOf: string;
  /**
   * "run" — read back from a calculated run: these are the figures of
   * record, the ones the bank file paid and the returns reported.
   * "preview" — nothing has been calculated for this period yet, so this
   * is a projection off today's inputs and will move if they move.
   */
  source: "run" | "preview";
  run: {
    id: string;
    version: number;
    status: string;
    calculatedAt: string | null;
  } | null;
};

/**
 * The figures for a period, preferring what was actually calculated.
 *
 * Payslips and the register used to recompute from live master data every
 * time they were opened. That silently rewrote history: correcting
 * attendance, or adding an incentive, after a run was calculated moved
 * the payslip while the bank file and the statutory returns — which read
 * the stored run — did not. The employee's payslip and the money that
 * reached their account disagreed.
 *
 * So a calculated run wins. Preview is only for a period nobody has run
 * yet, and the caller is told which it got so it can say so on screen.
 */
export async function loadPeriodFigures(args: {
  companyId: string;
  year: number;
  month: number;
}): Promise<PeriodFigures | null> {
  const [company] = await db
    .select()
    .from(s.companies)
    .where(eq(s.companies.id, args.companyId))
    .limit(1);
  if (!company) return null;

  const [run] = await db
    .select()
    .from(s.payrollRuns)
    .where(
      and(
        eq(s.payrollRuns.companyId, args.companyId),
        eq(s.payrollRuns.periodYear, args.year),
        eq(s.payrollRuns.periodMonth, args.month),
      ),
    )
    .orderBy(desc(s.payrollRuns.version))
    .limit(1);

  if (!run) {
    const preview = await previewRun(args);
    if (!preview) return null;
    return {
      company: {
        id: company.id,
        name: company.name,
        prorationBasis: company.prorationBasis,
        roundingMode: company.roundingMode,
      },
      results: preview.results,
      totals: preview.totals,
      asOf: preview.asOf,
      source: "preview",
      run: null,
    };
  }

  // Two bulk reads for the whole run — never one query per employee.
  const [summaries, lines, emps] = await Promise.all([
    db
      .select()
      .from(s.payrollEmployeeSummaries)
      .where(eq(s.payrollEmployeeSummaries.runId, run.id)),
    db
      .select()
      .from(s.payrollLines)
      .where(eq(s.payrollLines.runId, run.id))
      .orderBy(asc(s.payrollLines.sequence)),
    db
      .select({
        id: s.employees.id,
        empCode: s.employees.empCode,
        firstName: s.employees.firstName,
        lastName: s.employees.lastName,
      })
      .from(s.employees)
      .where(eq(s.employees.companyId, args.companyId)),
  ]);

  const empById = new Map(emps.map((e) => [e.id, e]));
  const linesByEmployee = new Map<string, PayLine[]>();
  for (const l of lines) {
    const list = linesByEmployee.get(l.employeeId) ?? [];
    list.push({
      code: l.code,
      label: l.label,
      kind: l.kind,
      category: l.category ?? undefined,
      amountPaise: l.amountPaise,
      basis: l.basis ?? "",
    });
    linesByEmployee.set(l.employeeId, list);
  }

  const results: PayFigures[] = summaries
    .map((sm) => {
      const e = empById.get(sm.employeeId);
      return {
        employeeId: sm.employeeId,
        name: e ? `${e.firstName} ${e.lastName}` : "Unknown",
        empCode: e?.empCode ?? "",
        paidDays: sm.paidDays,
        totalDays: sm.totalDays,
        lopDays: sm.lopDays,
        lines: linesByEmployee.get(sm.employeeId) ?? [],
        grossPaise: sm.grossPaise,
        deductionsPaise: sm.deductionsPaise,
        employerCostPaise: sm.employerCostPaise,
        netPaise: sm.netPaise,
        // Findings belong to the calculation, not to the stored figures.
        warnings: [],
      };
    })
    .sort((a, b) => b.grossPaise - a.grossPaise);

  return {
    company: {
      id: company.id,
      name: company.name,
      prorationBasis: run.prorationBasis,
      roundingMode: company.roundingMode,
    },
    results,
    totals: summariseRun(results),
    asOf: run.calculatedAt ?? run.createdAt,
    source: "run",
    run: {
      id: run.id,
      version: run.version,
      status: run.status,
      calculatedAt: run.calculatedAt,
    },
  };
}

/**
 * The proration and rounding conventions in force for one employee.
 *
 * `previewRun` resolves these for a whole company at once, which is the
 * right shape for a payroll run and the wrong one for a single
 * settlement. A leaver's final month has to be divided by the same
 * number their last payslip used — a settlement that quietly assumes a
 * thirty-day month pays 31/30 of a salary to someone who leaves on the
 * 31st of May, and 28/30 to someone who works the whole of February.
 */
export async function loadConventions(
  companyId: string,
  departmentId: string | null,
): Promise<PayrollConventions> {
  const [company] = await db
    .select({
      prorationBasis: s.companies.prorationBasis,
      standardDays: s.companies.standardDays,
      roundingMode: s.companies.roundingMode,
      roundComponents: s.companies.roundComponents,
      roundGross: s.companies.roundGross,
      roundNet: s.companies.roundNet,
    })
    .from(s.companies)
    .where(eq(s.companies.id, companyId))
    .limit(1);

  const base: PayrollConventions = {
    prorationBasis: (company?.prorationBasis as ProrationBasis) ?? "calendar_days",
    standardDays: company?.standardDays ?? 26,
    roundingMode: (company?.roundingMode as RoundingMode) ?? "nearest_rupee",
    roundComponents: company?.roundComponents ?? false,
    roundGross: company?.roundGross ?? false,
    roundNet: company?.roundNet ?? true,
  };

  if (!departmentId) return base;

  const [override] = await db
    .select()
    .from(s.departmentPayrollOverrides)
    .where(
      and(
        eq(s.departmentPayrollOverrides.companyId, companyId),
        eq(s.departmentPayrollOverrides.departmentId, departmentId),
      ),
    )
    .limit(1);

  return resolveDepartmentConventions(base, {
    prorationBasis: (override?.prorationBasis as ProrationBasis) ?? undefined,
    standardDays: override?.standardDays ?? undefined,
    roundingMode: (override?.roundingMode as RoundingMode) ?? undefined,
    roundComponents: override?.roundComponents ?? undefined,
    roundGross: override?.roundGross ?? undefined,
    roundNet: override?.roundNet ?? undefined,
  });
}
