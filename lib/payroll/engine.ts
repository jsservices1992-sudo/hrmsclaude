import { roundToRupee, type Paise, type RoundingMode } from "./money";
import {
  planRecovery,
  type RecoverableLoan,
  type RecoveryPlan,
} from "../loans/engine";
import { applyRounding } from "./settings";
import {
  evaluateStructure,
  type ComponentSpec,
} from "./compensation";
import {
  computeProration,
  paidDaysForPeriod,
  prorate,
  type ProrationBasis,
} from "./proration";
import {
  computeEpf,
  computeEsic,
  computeLwf,
  computeProfessionalTax,
  type EpfParams,
  type EsicParams,
  type LwfRate,
  type PtSlab,
} from "./statutory";

export type ComponentDef = ComponentSpec;

/**
 * Fallback only, for a company with no configured structure. Real
 * structures come from the database — see loadStructure().
 */
export const DEFAULT_STRUCTURE: ComponentSpec[] = [
  { code: "BASIC", label: "Basic", kind: "earning", calcMethod: "percent_of_gross", percentValue: 50, taxable: true, epfBase: true, esicBase: true, ptBase: true, bonusBase: true, gratuityBase: true, prorates: true, sequence: 0 },
  { code: "HRA", label: "House rent allowance", kind: "earning", calcMethod: "percent_of_basic", percentValue: 40, taxable: true, epfBase: false, esicBase: true, ptBase: true, bonusBase: false, gratuityBase: false, prorates: true, sequence: 1 },
  { code: "CONV", label: "Conveyance", kind: "earning", calcMethod: "fixed", percentValue: 0, fixedPaise: 160000, taxable: true, epfBase: false, esicBase: true, ptBase: true, bonusBase: false, gratuityBase: false, prorates: true, sequence: 2 },
  { code: "SPL", label: "Special allowance", kind: "earning", calcMethod: "balance", percentValue: 0, taxable: true, epfBase: false, esicBase: true, ptBase: true, bonusBase: false, gratuityBase: false, prorates: true, sequence: 3 },
];

export type EmployeeInput = {
  id: string;
  name: string;
  empCode: string;
  gender: "female" | "male" | "other";
  stateCode: string;
  esicImplementedArea: boolean;
  monthlyGrossPaise: Paise;
  dateOfJoining: string;
  dateOfExit?: string | null;
  lopDays: number;
  hadPriorPfMembership: boolean;
  pfOptedIn: boolean;
  vpfPercent: number;
  /** Covered at the start of the current ESIC contribution period. */
  esicCoveredAtPeriodStart: boolean;
  /** PT already deducted this financial year. */
  ptYtdPaise: Paise;
  /**
   * Monthly TDS from the tax projection — PRD §3.9, FR-TAX-7. The engine
   * does not compute income tax: it takes the projected figure so that a
   * single worksheet stays the one authority for the year's tax, and the
   * payslip cannot silently disagree with it.
   */
  monthlyTdsPaise?: Paise;
  /** Shown on the payslip so the deduction can be explained. */
  tdsBasis?: string;
  /**
   * Live loans to recover this month — PRD §3.10. Recovery runs last,
   * against what is left after statutory deductions, and stops at the
   * floor below. Anything not recovered is reported as a shortfall for
   * the caller to book as arrears; the engine itself stays pure.
   */
  loans?: RecoverableLoan[];
  /** Net pay recovery must never breach. */
  minNetPayPaise?: Paise;
  /**
   * One-off items for this period only — an incentive or an ad-hoc
   * deduction, neither a recurring pay component nor a recoverable loan.
   * Applied before loan recovery, so an incentive raises the amount
   * available for recovery and a deduction lowers it, same as any other
   * earning/deduction would.
   */
  oneOffLines?: {
    code: string;
    label: string;
    kind: "earning" | "deduction";
    amountPaise: Paise;
    /** Lets the register column the line without guessing from its code. */
    category?: PayLineCategory;
    reason?: string;
  }[];
};

export type CompanyConfig = {
  prorationBasis: ProrationBasis;
  standardDays: number;
  roundingMode: RoundingMode;
  /** Levels rounding is applied at — FR-SET-4. Net only, by default. */
  roundComponents?: boolean;
  roundGross?: boolean;
  roundNet?: boolean;
  epfOnActualBasic: boolean;
  structure: ComponentDef[];
};

export type StatutoryConfig = {
  epf: EpfParams;
  esic: EsicParams;
  ptSlabsByState: Record<string, PtSlab[]>;
  ptApplicableByState: Record<string, boolean>;
  lwfByState: Record<string, LwfRate | null>;
  lwfApplicableByState: Record<string, boolean>;
};

export type PayLineCategory = "ot" | "bonus" | "incentive" | "arrear" | "deduction" | "other";

export type PayLine = {
  code: string;
  label: string;
  kind: "earning" | "deduction" | "employer_contribution" | "info";
  /** Set on variable-pay lines; absent on structure and statutory lines. */
  category?: PayLineCategory;
  amountPaise: Paise;
  /** Derivation shown to the user — the explainability requirement. */
  basis: string;
};

export type EmployeePayResult = {
  employeeId: string;
  name: string;
  empCode: string;
  paidDays: number;
  totalDays: number;
  lopDays: number;
  lines: PayLine[];
  grossPaise: Paise;
  deductionsPaise: Paise;
  employerCostPaise: Paise;
  netPaise: Paise;
  esicCoveredNextPeriod: boolean;
  ptDeductedPaise: Paise;
  /** Present when the employee had loans to recover — PRD §3.10. */
  recovery: RecoveryPlan | null;
  warnings: string[];
};

export function computeEmployeePay(args: {
  employee: EmployeeInput;
  company: CompanyConfig;
  statutory: StatutoryConfig;
  year: number;
  month: number;
}): EmployeePayResult {
  const { employee: e, company: c, statutory: s, year, month } = args;
  const warnings: string[] = [];

  const paidDays = paidDaysForPeriod({
    year,
    month,
    basis: c.prorationBasis,
    standardDays: c.standardDays,
    dateOfJoining: e.dateOfJoining,
    dateOfExit: e.dateOfExit,
    lopDays: e.lopDays,
  });

  const proration = computeProration({
    basis: c.prorationBasis,
    year,
    month,
    paidDays,
    standardDays: c.standardDays,
  });

  // Evaluate the structure at full monthly gross, then prorate.
  const evaluated = evaluateStructure(c.structure, e.monthlyGrossPaise);
  for (const w of evaluated.warnings) warnings.push(w);

  const lines: PayLine[] = [];

  // Prorate first, then apply the rounding policy across the whole set, so
  // the components still sum exactly to the stated gross.
  const proratedAmounts = c.structure.map((def) => {
    const full =
      evaluated.components.find((x) => x.code === def.code)?.amountPaise ?? 0;
    return def.prorates ? prorate(full, proration) : full;
  });

  const rounding = applyRounding({
    components: proratedAmounts,
    deductions: 0,
    policy: {
      mode: c.roundingMode,
      components: c.roundComponents ?? false,
      gross: c.roundGross ?? false,
      net: false,
    },
  });

  let gross = 0;
  let epfBase = 0;
  let esicBase = 0;
  let ptBase = 0;

  c.structure.forEach((def, i) => {
    const amount = rounding.components[i];
    gross += amount;
    if (def.epfBase) epfBase += amount;
    if (def.esicBase) esicBase += amount;
    if (def.ptBase) ptBase += amount;

    lines.push({
      code: def.code,
      label: def.label,
      kind: "earning",
      amountPaise: amount,
      basis: (() => {
        const src =
          evaluated.components.find((x) => x.code === def.code)?.basis ?? "";
        return def.prorates
          ? `${src}, prorated ${proration.basisLabel}`
          : `${src}, not prorated`;
      })(),
    });
  });

  /* ---- EPF ---- */
  const epf = computeEpf({
    pfWagePaise: epfBase,
    params: s.epf,
    onActualBasic: c.epfOnActualBasic,
    hadPriorMembership: e.hadPriorPfMembership,
    optedIn: e.pfOptedIn,
    vpfPercent: e.vpfPercent,
  });

  if (epf.applicable) {
    // The wage the contribution was computed on. Recorded as its own line
    // because the ECR files it as a column, and a stored run has to be
    // able to produce the return without recomputing the whole month.
    lines.push({
      code: "EPF_WAGES",
      label: "PF wage considered",
      kind: "info",
      amountPaise: epf.pfWageConsidered,
      basis: epf.reason,
    });
    lines.push({
      code: "EPF_EE",
      label: "Provident fund — employee",
      kind: "deduction",
      amountPaise: epf.employeePaise,
      basis: `12% of PF wage ₹${(epf.pfWageConsidered / 100).toFixed(0)} — ${epf.reason}`,
    });
    if (epf.vpfPaise > 0) {
      lines.push({
        code: "VPF",
        label: "Voluntary provident fund",
        kind: "deduction",
        amountPaise: epf.vpfPaise,
        basis: `${e.vpfPercent}% of PF wage, voluntary`,
      });
    }
    lines.push({
      code: "EPF_ER",
      label: "Provident fund — employer",
      kind: "employer_contribution",
      amountPaise: epf.employerPfPaise,
      basis: "Employer share after pension diversion",
    });
    lines.push({
      code: "EPS_ER",
      label: "Pension scheme — employer",
      kind: "employer_contribution",
      amountPaise: epf.employerEpsPaise,
      basis: "8.33% of pension wage, capped at the pension ceiling",
    });
  } else {
    warnings.push(epf.reason);
  }

  /* ---- ESIC ---- */
  const esic = computeEsic({
    grossPaise: esicBase,
    month,
    params: s.esic,
    implementedArea: e.esicImplementedArea,
    coveredAtPeriodStart: e.esicCoveredAtPeriodStart,
  });

  if (esic.applicable) {
    lines.push({
      code: "ESIC_EE",
      label: "ESIC — employee",
      kind: "deduction",
      amountPaise: esic.employeePaise,
      basis: `0.75% of ₹${(esicBase / 100).toFixed(0)} — ${esic.reason}`,
    });
    lines.push({
      code: "ESIC_ER",
      label: "ESIC — employer",
      kind: "employer_contribution",
      amountPaise: esic.employerPaise,
      basis: `3.25% of ₹${(esicBase / 100).toFixed(0)}`,
    });
  }

  /* ---- Professional tax ---- */
  const pt = computeProfessionalTax({
    stateCode: e.stateCode,
    ptBasePaise: ptBase,
    month,
    gender: e.gender,
    slabs: s.ptSlabsByState[e.stateCode] ?? [],
    ytdDeductedPaise: e.ptYtdPaise,
    applicable: s.ptApplicableByState[e.stateCode] ?? false,
  });

  if (pt.amountPaise > 0) {
    lines.push({
      code: "PT",
      label: "Professional tax",
      kind: "deduction",
      amountPaise: pt.amountPaise,
      basis: `${e.stateCode} — ${pt.reason}`,
    });
  } else if (
    (s.ptApplicableByState[e.stateCode] ?? false) &&
    (s.ptSlabsByState[e.stateCode] ?? []).length === 0
  ) {
    warnings.push(`${e.stateCode} levies PT but no slab is configured`);
  }

  /* ---- LWF ---- */
  const lwf = computeLwf({
    stateCode: e.stateCode,
    month,
    applicable: s.lwfApplicableByState[e.stateCode] ?? false,
    rate: s.lwfByState[e.stateCode] ?? null,
  });

  if (lwf.employeePaise > 0) {
    lines.push({
      code: "LWF_EE",
      label: "Labour welfare fund — employee",
      kind: "deduction",
      amountPaise: lwf.employeePaise,
      basis: `${e.stateCode} — ${lwf.reason}`,
    });
    lines.push({
      code: "LWF_ER",
      label: "Labour welfare fund — employer",
      kind: "employer_contribution",
      amountPaise: lwf.employerPaise,
      basis: `${e.stateCode} — ${lwf.reason}`,
    });
  }

  /* ---- Income tax ---- */
  if ((e.monthlyTdsPaise ?? 0) > 0) {
    lines.push({
      code: "TDS",
      label: "Income tax (TDS)",
      kind: "deduction",
      amountPaise: e.monthlyTdsPaise!,
      basis: e.tdsBasis ?? "Projected annual tax spread over the remaining months",
    });
  }

  /* ---- One-off adjustments (incentive/deduction) ----
     Applied before loan recovery so an incentive is available to recover
     against and a deduction reduces it, same as any other earning or
     deduction. An earning one-off must also raise `gross` explicitly —
     unlike `deductions`/`employerCost` below, `gross` is a local
     accumulator built once above, not re-derived from `lines`. */
  for (const adj of e.oneOffLines ?? []) {
    if (adj.kind === "earning") gross += adj.amountPaise;
    lines.push({
      code: adj.code,
      label: adj.label,
      kind: adj.kind,
      category: adj.category,
      amountPaise: adj.amountPaise,
      basis: adj.reason ?? (adj.kind === "earning" ? "One-off incentive" : "One-off deduction"),
    });
  }

  /* ---- Loan recovery ----
     Deliberately last. Recovery can only take what statutory deductions
     leave, so it has to know the net that precedes it. */
  let recovery: RecoveryPlan | null = null;

  if (e.loans && e.loans.length > 0) {
    const beforeRecovery =
      lines
        .filter((l) => l.kind === "earning")
        .reduce((a, l) => a + l.amountPaise, 0) -
      lines
        .filter((l) => l.kind === "deduction")
        .reduce((a, l) => a + l.amountPaise, 0);

    recovery = planRecovery({
      loans: e.loans,
      netBeforeRecoveryPaise: beforeRecovery,
      minNetPayPaise: e.minNetPayPaise ?? 0,
    });

    for (const line of recovery.lines) {
      // The full loan id travels on the code, because approving the run
      // has to book the recovery against the loan it came from.
      if (line.recoveredPaise > 0) {
        lines.push({
          code: `LOAN:${line.loanId}`,
          label: line.label,
          kind: "deduction",
          amountPaise: line.recoveredPaise,
          basis: line.note,
        });
      }
      // A shortfall is carried as an informational line rather than only a
      // warning, so it survives onto the stored run and the payslip.
      if (line.shortfallPaise > 0) {
        lines.push({
          code: `LOAN_ARREAR:${line.loanId}`,
          label: `${line.label} — carried forward`,
          kind: "info",
          amountPaise: line.shortfallPaise,
          basis: line.note,
        });
      }
    }

    for (const w of recovery.warnings) warnings.push(w);
  }

  let deductions = lines
    .filter((l) => l.kind === "deduction")
    .reduce((a, l) => a + l.amountPaise, 0);
  const employerCost = lines
    .filter((l) => l.kind === "employer_contribution")
    .reduce((a, l) => a + l.amountPaise, 0);

  const net =
    (c.roundNet ?? true)
      ? roundToRupee(gross - deductions, c.roundingMode)
      : gross - deductions;

  /* Rounding the net to the rupee leaves a few paise that belong to
     nobody: gross less deductions no longer equals net, so a register
     built by summing columns does not add up — the run was out by ₹1.33
     across 32 people. The residue is booked as its own line so the
     payslip explains the difference and the register reconciles to zero
     exactly. Net itself is untouched: it is the figure being paid. */
  const residue = gross - deductions - net;
  if (residue !== 0) {
    /* Always a deduction, negative when the rounding went the
       employee's way. Booking a round-up as an earning instead — which
       is what this did — adds it to gross, so somebody on ₹12,000 whose
       net rounded up by 43 paise had a payslip headed ₹12,000.43. The
       gross is their salary and nothing about rounding the net may
       change it; the residue belongs on the side of the payslip that
       explains the difference between the two. */
    lines.push({
      code: "ROUND_OFF",
      label: "Rounding adjustment",
      kind: "deduction",
      amountPaise: residue,
      basis:
        residue > 0
          ? "Net rounded down to the nearest rupee"
          : "Net rounded up to the nearest rupee",
    });
    deductions += residue;
  }

  if (net < 0) warnings.push("Negative net pay — blocks finalisation");
  if (paidDays === 0) warnings.push("Zero paid days in this period");

  return {
    employeeId: e.id,
    name: e.name,
    empCode: e.empCode,
    paidDays: Number(paidDays.toFixed(2)),
    totalDays: proration.divisor,
    lopDays: e.lopDays,
    lines,
    grossPaise: gross,
    deductionsPaise: deductions,
    employerCostPaise: employerCost,
    netPaise: net,
    esicCoveredNextPeriod: esic.coveredForNextPeriod,
    recovery,
    ptDeductedPaise: pt.amountPaise,
    warnings,
  };
}

export type RunTotals = {
  headcount: number;
  grossPaise: Paise;
  deductionsPaise: Paise;
  employerCostPaise: Paise;
  netPaise: Paise;
  byCode: Record<string, Paise>;
  warnings: { employee: string; message: string }[];
};

/** The fields totalling needs — a stored run carries all of them too. */
export type SummarisableResult = Pick<
  EmployeePayResult,
  "name" | "lines" | "grossPaise" | "deductionsPaise" | "employerCostPaise" | "netPaise" | "warnings"
>;

export function summariseRun(results: SummarisableResult[]): RunTotals {
  const byCode: Record<string, Paise> = {};
  const warnings: { employee: string; message: string }[] = [];

  for (const r of results) {
    for (const l of r.lines) {
      byCode[l.code] = (byCode[l.code] ?? 0) + l.amountPaise;
    }
    for (const w of r.warnings) warnings.push({ employee: r.name, message: w });
  }

  return {
    headcount: results.length,
    grossPaise: results.reduce((a, r) => a + r.grossPaise, 0),
    deductionsPaise: results.reduce((a, r) => a + r.deductionsPaise, 0),
    employerCostPaise: results.reduce((a, r) => a + r.employerCostPaise, 0),
    netPaise: results.reduce((a, r) => a + r.netPaise, 0),
    byCode,
    warnings,
  };
}
