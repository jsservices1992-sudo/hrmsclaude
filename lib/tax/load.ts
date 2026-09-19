import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { CURRENT_FY, monthsInQuarter, monthsRemainingInFy } from "./fy";
import { buildForm16PartB } from "./form16";
import { db } from "@/db";
import * as s from "@/db/schema";
import { loadStructure } from "../payroll/load";
import { evaluateStructure } from "../payroll/compensation";
import {
  computeAnnualTax,
  computeDeductions,
  computeHraExemption,
  computeSlabTax,
  projectMonthlyTds,
  closeProofWindow,
  validatePan,
  type AnnualComputation,
  type DeductionClaims,
  type DeductionResult,
  type HraResult,
  type ProjectionResult,
  type Regime,
} from "./engine";
import {
  regimeConfig,
  ageAsOfFinancialYearEnd,
  DEDUCTION_LIMITS_2026,
  LANDLORD_PAN_THRESHOLD_PAISE,
  NO_PAN_RATE_BPS,
  isMetroCity,
  TAX_CONFIG_VERSION,
  TAX_CONFIG_VERIFIED,
  TAX_CONFIG_VERIFICATION,
} from "./config";
import { hasTaxConfig } from "./config";
import { summarisePerquisites, type PerquisiteLine } from "./perquisites";

export {
  CURRENT_FY,
  fyMonthIndex,
  monthsRemainingInFy,
  fyLabel,
  quarterOf,
} from "./fy";

/**
 * `receivesHra` and the 80GG rent figure are not stored on the
 * declaration row — they are derived by the caller from the same salary
 * structure and rent the employee already declared, since a person either
 * receives HRA or claims 80GG on the same rent, never both.
 */
function claimsFrom(
  d: typeof s.taxDeclarations.$inferSelect,
  args: { receivesHra: boolean },
): DeductionClaims {
  return {
    section80cPaise: d.section80cPaise,
    section80ccd1bPaise: d.section80ccd1bPaise,
    // Employer NPS is not declared by the employee; it comes from payroll.
    section80ccd2Paise: 0,
    section80dSelfPaise: d.section80dSelfPaise,
    section80dParentsPaise: d.section80dParentsPaise,
    selfOrFamilyIsSenior: d.selfOrFamilyIsSenior,
    parentsAreSenior: d.parentsAreSenior,
    section80ePaise: d.section80ePaise,
    section80gPaise: d.section80gPaise,
    savingsInterestPaise: d.savingsInterestPaise,
    taxpayerIsSenior: d.taxpayerIsSenior,
    homeLoanInterestPaise: d.homeLoanInterestPaise,
    isSelfOccupied: d.isSelfOccupied,
    dependentDisability: d.dependentDisability,
    selfDisability: d.selfDisability,
    section80ddbPaise: d.section80ddbPaise,
    ddbPersonIsSenior: d.ddbPersonIsSenior,
    section80eebPaise: d.section80eebPaise,
    section80ggcPaise: d.section80ggcPaise,
    receivesHra: args.receivesHra,
    section80ggRentPaise: args.receivesHra ? 0 : d.annualRentPaise,
  };
}

export type TaxWorksheet = {
  employee: typeof s.employees.$inferSelect;
  declaration: typeof s.taxDeclarations.$inferSelect | null;
  regime: Regime;
  configVersion: string;
  configVerified: boolean;
  annualGrossPaise: number;
  annualBasicPaise: number;
  annualHraPaise: number;
  hra: HraResult | null;
  perquisites: { lines: PerquisiteLine[]; totalPaise: number };
  deductions: DeductionResult;
  annual: AnnualComputation;
  projection: ProjectionResult;
  tdsToDatePaise: number;
  proofs: (typeof s.taxProofs.$inferSelect)[];
  /** What the projection becomes if nothing further is substantiated. */
  ifNothingProved: ReturnType<typeof closeProofWindow> | null;
  pan: ReturnType<typeof validatePan>;
  warnings: string[];
};

/**
 * Everything one worksheet needs, already loaded.
 *
 * Splitting the loading from the computing is what lets a payroll run
 * ask for a hundred of these without issuing seven hundred queries. The
 * arithmetic below has one home either way: `loadWorksheet` is the same
 * path as the batch, asked for a single employee.
 */
type WorksheetInputs = {
  emp: typeof s.employees.$inferSelect;
  decl: typeof s.taxDeclarations.$inferSelect | null;
  salary: typeof s.employeeSalaries.$inferSelect | null;
  structure: Awaited<ReturnType<typeof loadStructure>>;
  flexiApprovedPaise: number;
  perqRows: (typeof s.taxPerquisites.$inferSelect)[];
  ledger: (typeof s.tdsLedger.$inferSelect)[];
  proofs: (typeof s.taxProofs.$inferSelect)[];
};

function composeWorksheet(
  input: WorksheetInputs,
  financialYear: number,
  overrideRegime?: Regime,
): TaxWorksheet {
  const { emp, decl, salary, structure, flexiApprovedPaise, perqRows, ledger, proofs } = input;

  const regime: Regime = overrideRegime ?? ((decl?.regime ?? emp.taxRegime) as Regime);
  const config = regimeConfig(regime, financialYear, ageAsOfFinancialYearEnd(emp.dateOfBirth, financialYear));
  const warnings: string[] = [];

  /* ---- salary ---- */
  const monthlyGross = salary?.monthlyGrossPaise ?? 0;
  if (!salary) {
    warnings.push("No salary is on record, so the projection is nil");
  }

  const evaluated = evaluateStructure(structure, monthlyGross);
  const monthlyBasic = evaluated.epfBasePaise;
  const monthlyHra =
    evaluated.components.find((c) => c.code === "HRA")?.amountPaise ?? 0;

  const annualGross = monthlyGross * 12;
  const annualBasic = monthlyBasic * 12;
  const annualHra = monthlyHra * 12;

  /* ---- HRA exemption ---- */
  let hra: HraResult | null = null;
  if (annualHra > 0) {
    hra = computeHraExemption({
      salaryPaise: annualBasic,
      hraReceivedPaise: annualHra,
      rentPaidPaise: decl?.annualRentPaise ?? 0,
      isMetro: isMetroCity(decl?.rentCity ?? emp.city),
      regime,
      landlordPan: decl?.landlordPan ?? null,
      panRequiredAbovePaise: LANDLORD_PAN_THRESHOLD_PAISE,
    });
    warnings.push(...hra.warnings);
  }

  const flexiExempt = flexiApprovedPaise;

  const perquisites = summarisePerquisites(
    perqRows.map((p) => ({
      code: p.code,
      label: p.label,
      valuePaise: p.valuePaise,
      basis: p.basis,
    })),
  );

  /* ---- deductions ---- */
  const deductions = decl
    ? computeDeductions({
        claims: claimsFrom(decl, { receivesHra: annualHra > 0 }),
        limits: DEDUCTION_LIMITS_2026,
        regime,
        allowsChapterViA: config.allowsChapterViA,
        grossSalaryPaise: annualGross,
      })
    : { lines: [], totalAllowedPaise: 0, disallowedPaise: 0 };

  /* ---- annual ---- */
  const exemptAllowances = (hra?.exemptPaise ?? 0) + flexiExempt;

  const annual = computeAnnualTax({
    grossSalaryPaise: annualGross,
    exemptAllowancesPaise: exemptAllowances,
    perquisitesPaise: perquisites.totalPaise,
    previousEmployerSalaryPaise: decl?.previousSalaryPaise ?? 0,
    previousEmployerTdsPaise: decl?.previousTdsPaise ?? 0,
    // Professional tax is not modelled per state here; the payroll run is
    // authoritative and feeds this once the year has months behind it.
    professionalTaxPaidPaise: 0,
    deductions,
    config,
  });

  const tdsToDate = ledger.reduce((a, r) => a + r.tdsPaise, 0);

  // Months left is a calendar fact, not a count of payroll runs. If runs
  // are behind, the year's tax still has to come out of the months that
  // are actually left — which is precisely what produces the spike.
  const today = new Date();
  const byCalendar = monthsRemainingInFy(today.getUTCMonth() + 1);
  const monthsRemaining = Math.max(1, Math.min(byCalendar, 12 - ledger.length));

  const pan = validatePan(emp.pan);
  if (!pan.valid) warnings.push(pan.reason);
  else if (!pan.isIndividual) warnings.push(pan.reason);

  const projection = projectMonthlyTds({
    annual,
    tdsDeductedToDatePaise: tdsToDate,
    monthsRemaining,
    voluntaryMonthlyPaise: decl?.voluntaryMonthlyPaise ?? 0,
    hasValidPan: pan.valid,
    higherRateBps: NO_PAN_RATE_BPS,
  });
  warnings.push(...projection.warnings);

  /* ---- what happens if the proofs never arrive ---- */
  let ifNothingProved: ReturnType<typeof closeProofWindow> | null = null;
  if (decl && deductions.totalAllowedPaise > 0) {
    const verifiedBySection: Record<string, number> = {};
    for (const p of proofs) {
      verifiedBySection[p.section] =
        (verifiedBySection[p.section] ?? 0) + p.verifiedPaise;
    }
    ifNothingProved = closeProofWindow({
      declared: deductions,
      verifiedBySection,
      annualBefore: annual,
      config,
      monthsRemaining,
    });
  }

  if (!TAX_CONFIG_VERIFIED) {
    warnings.push(
      `Tax configuration ${TAX_CONFIG_VERSION} has not been verified against the Finance Act`,
    );
  }

  return {
    employee: emp,
    declaration: decl ?? null,
    regime,
    configVersion: TAX_CONFIG_VERSION,
    configVerified: TAX_CONFIG_VERIFIED,
    annualGrossPaise: annualGross,
    annualBasicPaise: annualBasic,
    annualHraPaise: annualHra,
    hra,
    perquisites,
    deductions,
    annual,
    projection,
    tdsToDatePaise: tdsToDate,
    proofs,
    ifNothingProved,
    pan,
    warnings,
  };
}

/**
 * Worksheets for many employees, in a fixed number of queries.
 *
 * A payroll run needs one number out of each of these, and asking for
 * them one at a time issued about seven round trips per employee — seven
 * hundred for a hundred people, which is minutes against a hosted
 * database and grows with headcount. The same seven queries answer for
 * everybody at once.
 */
export async function loadWorksheetsFor(
  employeeIds: string[],
  financialYear = CURRENT_FY,
  overrideRegime?: Regime,
): Promise<Map<string, TaxWorksheet>> {
  const out = new Map<string, TaxWorksheet>();
  if (employeeIds.length === 0 || !hasTaxConfig(financialYear)) return out;

  const [emps, decls, salaries, flexi, perqs, ledgers] = await Promise.all([
    db.select().from(s.employees).where(inArray(s.employees.id, employeeIds)),
    db
      .select()
      .from(s.taxDeclarations)
      .where(
        and(
          inArray(s.taxDeclarations.employeeId, employeeIds),
          eq(s.taxDeclarations.financialYear, financialYear),
        ),
      ),
    db
      .select()
      .from(s.employeeSalaries)
      .where(inArray(s.employeeSalaries.employeeId, employeeIds))
      .orderBy(asc(s.employeeSalaries.effectiveFrom)),
    db
      .select({ employeeId: s.flexiClaims.employeeId, approved: s.flexiClaims.approvedPaise })
      .from(s.flexiClaims)
      .where(
        and(
          inArray(s.flexiClaims.employeeId, employeeIds),
          inArray(s.flexiClaims.status, ["approved", "partial"]),
        ),
      ),
    db
      .select()
      .from(s.taxPerquisites)
      .where(
        and(
          inArray(s.taxPerquisites.employeeId, employeeIds),
          eq(s.taxPerquisites.financialYear, financialYear),
        ),
      ),
    db
      .select()
      .from(s.tdsLedger)
      .where(
        and(
          inArray(s.tdsLedger.employeeId, employeeIds),
          eq(s.tdsLedger.financialYear, financialYear),
        ),
      ),
  ]);

  const declByEmployee = new Map(decls.map((d) => [d.employeeId, d]));

  /* Proofs hang off the declaration, so they are only worth a query when
     somebody has declared something. */
  const declIds = decls.map((d) => d.id);
  const proofs = declIds.length
    ? await db.select().from(s.taxProofs).where(inArray(s.taxProofs.declarationId, declIds))
    : [];
  const proofsByDecl = new Map<string, (typeof proofs)[number][]>();
  for (const p of proofs) {
    const list = proofsByDecl.get(p.declarationId) ?? [];
    list.push(p);
    proofsByDecl.set(p.declarationId, list);
  }

  /* The earliest salary row, matching what the single-employee version
     took: the first of an ascending order. */
  const salaryByEmployee = new Map<string, (typeof salaries)[number]>();
  for (const row of salaries) {
    if (!salaryByEmployee.has(row.employeeId)) salaryByEmployee.set(row.employeeId, row);
  }

  const flexiByEmployee = new Map<string, number>();
  for (const f of flexi) {
    flexiByEmployee.set(f.employeeId, (flexiByEmployee.get(f.employeeId) ?? 0) + f.approved);
  }

  const perqByEmployee = new Map<string, (typeof perqs)[number][]>();
  for (const p of perqs) {
    const list = perqByEmployee.get(p.employeeId) ?? [];
    list.push(p);
    perqByEmployee.set(p.employeeId, list);
  }

  const ledgerByEmployee = new Map<string, (typeof ledgers)[number][]>();
  for (const l of ledgers) {
    const list = ledgerByEmployee.get(l.employeeId) ?? [];
    list.push(l);
    ledgerByEmployee.set(l.employeeId, list);
  }

  /* One structure query per company, not per employee. */
  const structures = new Map<string, Awaited<ReturnType<typeof loadStructure>>>();
  for (const companyId of new Set(emps.map((e) => e.companyId))) {
    structures.set(companyId, await loadStructure(companyId));
  }

  for (const emp of emps) {
    const decl = declByEmployee.get(emp.id) ?? null;
    out.set(
      emp.id,
      composeWorksheet(
        {
          emp,
          decl,
          salary: salaryByEmployee.get(emp.id) ?? null,
          structure: structures.get(emp.companyId)!,
          flexiApprovedPaise: flexiByEmployee.get(emp.id) ?? 0,
          perqRows: perqByEmployee.get(emp.id) ?? [],
          ledger: ledgerByEmployee.get(emp.id) ?? [],
          proofs: decl ? (proofsByDecl.get(decl.id) ?? []) : [],
        },
        financialYear,
        overrideRegime,
      ),
    );
  }

  return out;
}

/** One employee's complete tax position, computed from live payroll data. */
export async function loadWorksheet(
  employeeId: string,
  financialYear = CURRENT_FY,
  overrideRegime?: Regime,
): Promise<TaxWorksheet | null> {
  const all = await loadWorksheetsFor([employeeId], financialYear, overrideRegime);
  return all.get(employeeId) ?? null;
}

/**
 * The same worksheet under both regimes, so the employee sees the
 * comparison the PRD asks for rather than a single number.
 */
export async function compareForEmployee(
  employeeId: string,
  financialYear = CURRENT_FY,
) {
  const [oldW, newW] = await Promise.all([
    loadWorksheet(employeeId, financialYear, "old"),
    loadWorksheet(employeeId, financialYear, "new"),
  ]);
  if (!oldW || !newW) return null;

  const oldTax = oldW.annual.tax.totalTaxPaise;
  const newTax = newW.annual.tax.totalTaxPaise;
  const better: Regime = oldTax <= newTax ? "old" : "new";

  return {
    old: oldW,
    new: newW,
    betterRegime: better,
    savingPaise: Math.abs(oldTax - newTax),
  };
}

export type TaxRow = {
  employeeId: string;
  name: string;
  empCode: string;
  regime: Regime;
  status: string;
  taxableIncomePaise: number;
  annualTaxPaise: number;
  tdsToDatePaise: number;
  monthlyTdsPaise: number;
  atRiskPaise: number;
  panValid: boolean;
  proofsPending: number;
};

/** The company register: every employee's position in one pass. */
export async function loadCompanyTax(
  companyId: string,
  financialYear = CURRENT_FY,
): Promise<{ rows: TaxRow[]; configVersion: string; configVerified: boolean }> {
  const employees = await db
    .select()
    .from(s.employees)
    .where(
      and(
        eq(s.employees.companyId, companyId),
        eq(s.employees.status, "active"),
        /* Salary only. A consultant's fee is deducted under 194J or
           194C and reported in 26Q; there is no slab, no regime and no
           Form 16 for them, so a salary worksheet would be fiction. */
        eq(s.employees.paymentBasis, "salary"),
      ),
    )
    .orderBy(asc(s.employees.empCode));

  const rows: TaxRow[] = [];
  for (const emp of employees) {
    const w = await loadWorksheet(emp.id, financialYear);
    if (!w) continue;
    rows.push({
      employeeId: emp.id,
      name: `${emp.firstName} ${emp.lastName}`,
      empCode: emp.empCode,
      regime: w.regime,
      status: w.declaration?.status ?? "not started",
      taxableIncomePaise: w.annual.taxableIncomePaise,
      annualTaxPaise: w.annual.tax.totalTaxPaise,
      tdsToDatePaise: w.tdsToDatePaise,
      monthlyTdsPaise: w.projection.monthlyTdsPaise,
      atRiskPaise: w.ifNothingProved?.additionalTaxPaise ?? 0,
      panValid: w.pan.valid,
      proofsPending: w.proofs.filter((p) => p.status === "pending").length,
    });
  }

  rows.sort((a, b) => b.annualTaxPaise - a.annualTaxPaise);
  return {
    rows,
    configVersion: TAX_CONFIG_VERSION,
    configVerified: TAX_CONFIG_VERIFIED,
  };
}

/** The verification queue across a set of companies — FR-TAX-4. */
export async function listPendingProofs(companyIds: string[]) {
  if (companyIds.length === 0) return [];
  return db
    .select({
      proof: s.taxProofs,
      decl: s.taxDeclarations,
      emp: s.employees,
    })
    .from(s.taxProofs)
    .innerJoin(
      s.taxDeclarations,
      eq(s.taxProofs.declarationId, s.taxDeclarations.id),
    )
    .innerJoin(s.employees, eq(s.taxDeclarations.employeeId, s.employees.id))
    .where(
      and(
        inArray(s.employees.companyId, companyIds),
        eq(s.taxProofs.status, "pending"),
      ),
    )
    .orderBy(asc(s.employees.empCode));
}

/** Form 24Q quarterly summary — FR-TAX-8. */
export async function quarterlyReturn(
  companyId: string,
  financialYear: number,
  quarter: 1 | 2 | 3 | 4,
) {
  // Q1 is Apr-Jun, so FY month indices 1-3, and so on.
  const calendarMonths = monthsInQuarter(quarter);

  const employees = await db
    .select({ id: s.employees.id, empCode: s.employees.empCode, pan: s.employees.pan, firstName: s.employees.firstName, lastName: s.employees.lastName })
    .from(s.employees)
    .where(
      and(
        eq(s.employees.companyId, companyId),
        /* 24Q is the salary return. Non-salary TDS belongs in 26Q. */
        eq(s.employees.paymentBasis, "salary"),
      ),
    );

  const ids = employees.map((e) => e.id);
  if (ids.length === 0) return { lines: [], totalPaise: 0, calendarMonths };

  const ledger = await db
    .select()
    .from(s.tdsLedger)
    .where(
      and(
        inArray(s.tdsLedger.employeeId, ids),
        eq(s.tdsLedger.financialYear, financialYear),
        inArray(s.tdsLedger.month, calendarMonths),
      ),
    );

  const byEmployee = new Map<string, number>();
  for (const r of ledger) {
    byEmployee.set(r.employeeId, (byEmployee.get(r.employeeId) ?? 0) + r.tdsPaise);
  }

  const lines = employees
    .filter((e) => byEmployee.has(e.id))
    .map((e) => ({
      employeeId: e.id,
      empCode: e.empCode,
      name: `${e.firstName} ${e.lastName}`,
      pan: e.pan,
      panValid: validatePan(e.pan).valid,
      tdsPaise: byEmployee.get(e.id) ?? 0,
    }));

  return {
    lines,
    totalPaise: lines.reduce((a, l) => a + l.tdsPaise, 0),
    calendarMonths,
  };
}

/** Slab bands for the current regime, for the worksheet's rate table. */
export function slabTableFor(regime: Regime, taxableIncomePaise: number, ageAsOfFyEnd?: number | null) {
  return computeSlabTax(taxableIncomePaise, regimeConfig(regime, CURRENT_FY, ageAsOfFyEnd));
}

/**
 * One employee's Form 16 Part B for a financial year, with the
 * quarterly deduction summary from this system's own TDS ledger.
 *
 * Read through `loadWorksheet` so the figures are the same ones the
 * payslip and the projection use — a certificate that disagrees with
 * the payslips it summarises is worse than no certificate.
 */
export async function loadForm16(
  employeeId: string,
  financialYear = CURRENT_FY,
): Promise<{
  worksheet: TaxWorksheet;
  form: ReturnType<typeof buildForm16PartB>;
} | null> {
  const worksheet = await loadWorksheet(employeeId, financialYear);
  if (!worksheet) return null;

  const ledger = await db
    .select({ month: s.tdsLedger.month, tdsPaise: s.tdsLedger.tdsPaise })
    .from(s.tdsLedger)
    .where(
      and(
        eq(s.tdsLedger.employeeId, employeeId),
        eq(s.tdsLedger.financialYear, financialYear),
      ),
    );

  return {
    worksheet,
    form: buildForm16PartB({
      financialYear,
      regime: worksheet.regime,
      annual: worksheet.annual,
      deductions: worksheet.deductions,
      tdsByMonth: new Map(ledger.map((r) => [r.month, r.tdsPaise])),
      hraExemptPaise: worksheet.hra?.exemptPaise,
    }),
  };
}
