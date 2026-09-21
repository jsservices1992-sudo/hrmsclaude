import { roundToRupee, type Paise, type RoundingMode } from "./money";

/**
 * How a charge reaches one person: the statutory test, or an answer
 * somebody put on the record.
 *
 * "no" is a claim that the law does not reach this person — an
 * apprentice, somebody covered through another employer. It is honoured
 * only where the test agrees; where the charge is genuinely due it
 * stands, and the run says the switch was refused. A salary structure
 * that could switch off a statutory deduction is not a structure, it is
 * a way of underpaying the fund and telling nobody.
 */
export type Applicability = "auto" | "yes" | "no";
import {
  planRecovery,
  type RecoverableLoan,
  type RecoveryPlan,
} from "../loans/engine";
import { applyRounding } from "./settings";
import {
  defaultEsicTreatment,
  describeEsicWage,
  esicRuleFor,
  esicTreatmentForCategory,
  esicWage,
  type EsicTreatment,
  type EsicWageLine,
} from "./esic-wage";
import {
  evaluateStructure,
  type BonusParams,
  type ComponentSpec,
  type MinimumWageRule,
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
  /**
   * Whether the job is managerial or supervisory, for the welfare funds
   * that exclude those above a wage. Null means nobody has recorded it,
   * which is not an exclusion — the person contributes and the run
   * reports the gap.
   */
  lwfCategory?: "managerial" | "supervisory" | "other" | null;
  /**
   * People employed at this person's branch. Delhi does not apply the
   * welfare fund below five, and a company may run one branch over the
   * line and another under it, so the count is the establishment's
   * rather than the company's.
   */
  establishmentHeadcount?: number | null;
  esicImplementedArea: boolean;
  monthlyGrossPaise: Paise;
  dateOfJoining: string;
  dateOfExit?: string | null;
  lopDays: number;
  /**
   * Weekly-off and holiday days actually worked. Paid for only when the
   * company has chosen to pay for them; the day itself was already paid.
   */
  offDaysWorked?: number;
  hadPriorPfMembership: boolean;
  pfOptedIn: boolean;
  /**
   * Whether each charge reaches this person at all — FR-STAT-1.
   *
   * "auto" is the statutory test. "no" is honoured only where the test
   * itself finds nothing due: a switch on a record may not excuse a
   * deduction the law requires, so an attempt to turn one off where it
   * is genuinely owed leaves the deduction standing and says so on the
   * run. Undefined is "auto", so every existing caller is unchanged.
   */
  pfApplicability?: Applicability;
  esicApplicability?: Applicability;
  ptApplicability?: Applicability;
  tdsApplicability?: Applicability;
  /** Whether the establishment is covered by each Act at all. */
  epfEstablishmentCovered?: boolean;
  esicEstablishmentCovered?: boolean;
  /** Components held at their agreed amounts; the balance one absorbs. */
  componentAnchors?: Map<string, Paise>;
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
   * Whether this person's projected annual income tax, before the
   * section 87A rebate, is above zero — from the same tax worksheet
   * `monthlyTdsPaise` comes from, and independent of it: a rebate can
   * zero the final TDS while taxable income still exceeds the
   * exemption limit. Only a PT slab that names
   * `requiresIncomeTaxLiability` (Punjab) reads this; every other
   * state's PT is unaffected.
   */
  incomeTaxPayee?: boolean;
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
    /** How the ESI definition of wages treats it. Absent, read from the category. */
    esicTreatment?: EsicTreatment | null;
    reason?: string;
  }[];
};

export type CompanyConfig = {
  prorationBasis: ProrationBasis;
  standardDays: number;
  /** What is owed for work done on a weekly off or holiday. */
  weeklyOffWorkTreatment?: "ignore" | "extra_day" | "comp_off";
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
  /**
   * Rates that used to be constants in source. They are here so that a
   * change to one is a dated row like every other statutory figure —
   * which is also what keeps an old month recalculating at the rate that
   * was in force then, rather than at today's.
   */
  gratuity: { accrualBps: number };
  bonus: BonusParams;
  /** Employees an establishment must have before the Bonus Act applies. */
  bonusHeadcountThreshold: number;
  /** The share of pay that must be wages, in basis points. */
  wageCodeMinimumShareBps: number;
  /** State floors in force, for the check that a salary clears one. */
  minimumWages: MinimumWageRule[];
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
  /**
   * An employee by default. A professional is paid a fee under 194J,
   * 194C or 194H rather than a salary, and every statutory return filters
   * on this — they belong in 26Q, never in 24Q, the EPF ECR or the ESIC
   * return. See lib/payroll/professional.ts.
   */
  payeeClass?: "employee" | "professional";
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
  /* Where a salary is held at a net, the agreed components are pinned and
     only the balance one moves. Without this the engine re-derives Basic
     from the adjusted gross, and a rupee of labour welfare fund restates
     the PF wage on the payslip and the ECR. */
  const evaluated = evaluateStructure(
    c.structure,
    e.monthlyGrossPaise,
    e.componentAnchors,
  );
  for (const w of evaluated.warnings) warnings.push(w);

  const lines: PayLine[] = [];

  // Prorate first, then apply the rounding policy across the whole set, so
  // the components still sum exactly to the stated gross.
  const proratedAmounts = c.structure.map((def) => {
    const full =
      evaluated.components.find((x) => x.code === def.code)?.amountPaise ?? 0;
    return def.prorates ? prorate(full, proration) : full;
  });

  /*
   * The statutory bonus is settled on the wages actually earned, not by
   * prorating a figure that was already capped.
   *
   * A joiner who works 22 of 31 days still earns basic above the ₹7,000
   * ceiling, so their bonus is the full 8.33% of the ceiling — prorating
   * it applies the cap twice and pays short. Somebody whose earned basic
   * falls under the ceiling is owed 8.33% of what they earned, which is
   * more than the prorated capped figure. Both cases were reported as
   * outstanding every month, because the Act check reads the wages on
   * the run and this did not.
   */
  const bonusIndex = c.structure.findIndex(
    (def) => def.calcMethod === "statutory_bonus",
  );
  let employerBonusThisMonth = prorate(evaluated.employerBonusPaise, proration);
  if (bonusIndex >= 0) {
    const def = c.structure[bonusIndex];
    const earnedWage = c.structure.reduce(
      (a, x, i) => (x.kind === "earning" && x.bonusBase ? a + proratedAmounts[i] : a),
      0,
    );
    const ceiling = def.fixedPaise ?? 0;
    const considered = ceiling > 0 ? Math.min(earnedWage, ceiling) : earnedWage;
    const owed = Math.round((considered * def.percentValue) / 100);

    if (def.kind === "earning") {
      /* Inside gross, so the balance component gives up the difference
         and the month still totals the gross it was solved for. Without
         a balance component there is nowhere for it to come from, and
         moving it would change gross behind the employee's back. */
      const balanceIndex = c.structure.findIndex(
        (x) => x.kind === "earning" && x.calcMethod === "balance",
      );
      if (balanceIndex >= 0) {
        proratedAmounts[balanceIndex] -= owed - proratedAmounts[bonusIndex];
        proratedAmounts[bonusIndex] = owed;
      }
    } else {
      employerBonusThisMonth = owed;
    }
  }

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
  let ptBase = 0;
  /* Every earning this month with how the ESI definition of wages treats
     it. Collected rather than summed, because the Code's wage cannot be
     known until everything paid this month is in — overtime and
     incentives included — and the 50% test has been run over the lot. */
  const esicLines: EsicWageLine[] = [];

  c.structure.forEach((def, i) => {
    /* Only earnings make up gross and appear as earning lines. A
       component the company classified as an employer cost — the
       statutory bonus is the one that exists today — is paid for
       separately and would otherwise show as a ₹0.00 earning. */
    if (def.kind !== "earning") return;
    const amount = rounding.components[i];
    gross += amount;
    if (def.epfBase) epfBase += amount;
    if (def.ptBase) ptBase += amount;
    if (def.kind === "earning") {
      esicLines.push({
        code: def.code,
        amountPaise: amount,
        treatment: def.esicTreatment ?? defaultEsicTreatment(def.code, def.esicBase),
      });
    }

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
    establishmentCovered: e.epfEstablishmentCovered,
  });

  /* Switched off on this person's record rather than by the statutory
     test. Nothing is deducted — and the month says so, because who is
     inside a fund is a claim the employer answers for, and a silent
     exemption is indistinguishable from a mistake. */
  if (e.pfApplicability === "no" && epfBase > 0) {
    warnings.push(
      "Provident fund is switched off for this person, so nothing has been deducted or contributed for them this month.",
    );
  }
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

  /* ---- Professional tax ---- */
  const pt = computeProfessionalTax({
    stateCode: e.stateCode,
    ptBasePaise: ptBase,
    month,
    gender: e.gender,
    slabs: s.ptSlabsByState[e.stateCode] ?? [],
    ytdDeductedPaise: e.ptYtdPaise,
    applicable: s.ptApplicableByState[e.stateCode] ?? false,
    incomeTaxPayee: e.incomeTaxPayee,
  });
  /* Switched off on this person's record. Honoured, and said out loud:
     it is a claim about who the tax reaches, and the person who made it
     should meet it again when the month is reviewed. */
  const ptSwitchedOff = e.ptApplicability === "no" && pt.amountPaise > 0;
  if (ptSwitchedOff) {
    warnings.push(
      `Professional tax is switched off for this person, so ${e.stateCode}'s ${(pt.amountPaise / 100).toFixed(2)} has not been deducted. The state levies it on these wages.`,
    );
  }

  if (pt.amountPaise > 0 && !ptSwitchedOff) {
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
    /* "salary or wages or any remuneration" in the Haryana notification,
       which is the whole of what is paid rather than a statutory base. */
    monthlyWagePaise: ptBase,
    category: e.lwfCategory ?? null,
    establishmentHeadcount: e.establishmentHeadcount ?? null,
  });

  if (lwf.categoryUnknown) {
    warnings.push(
      `${e.stateCode} excludes managerial and supervisory staff above a wage, and this employee's job is not recorded. They are contributing meanwhile.`,
    );
  }

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

  /* ---- Statutory bonus, where the structure carries it as a cost ----
     Not paid with this month's salary: the Act's bonus is settled once a
     year. It is shown here because it is earned in this month and is part
     of what this employee costs, which is the same reason the employer's
     provident fund share is on the slip. */
  if (employerBonusThisMonth > 0) {
    const bonusComponent = c.structure.find(
      (x) => x.calcMethod === "statutory_bonus" && x.kind === "employer_contribution",
    );
    lines.push({
      // The company's own code for it, so the bonus checks can find this
      // line rather than matching on a name the engine invented.
      code: `${bonusComponent?.code ?? "BONUS"}_ER`,
      label: "Statutory bonus — employer",
      kind: "employer_contribution",
      amountPaise: employerBonusThisMonth,
      basis: "Accrued this month under the Payment of Bonus Act, payable annually",
    });
  }

  /* ---- Income tax ---- */
  const tdsSwitchedOff = e.tdsApplicability === "no" && (e.monthlyTdsPaise ?? 0) > 0;
  if (tdsSwitchedOff) {
    warnings.push(
      `Income tax is switched off for this person, so ${((e.monthlyTdsPaise ?? 0) / 100).toFixed(2)} of TDS has not been deducted. The projection says tax is due on their pay — an employer that under-deducts answers for it.`,
    );
  }

  if ((e.monthlyTdsPaise ?? 0) > 0 && !tdsSwitchedOff) {
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
  /* An extra day's wages for a day off that was worked, where the
     company pays for those. Priced on the same divisor the rest of the
     month uses, so a day is worth what a day is worth — and added as an
     earning rather than as extra paid days, because the day was already
     inside the month and already paid. Compensatory off is not money and
     is credited to leave when attendance is derived, not here. */
  const offDaysWorked = e.offDaysWorked ?? 0;
  if (c.weeklyOffWorkTreatment === "extra_day" && offDaysWorked > 0) {
    const perDay = proration.divisor > 0 ? e.monthlyGrossPaise / proration.divisor : 0;
    const amount = Math.round(perDay * offDaysWorked);
    if (amount > 0) {
      gross += amount;
      esicLines.push({ code: "OFF_DAY_WORK", amountPaise: amount, treatment: "included" });
      lines.push({
        code: "OFF_DAY_WORK",
        label: "Worked on a day off",
        kind: "earning",
        amountPaise: amount,
        basis: `${offDaysWorked} day(s) worked on a weekly off or holiday, at ${proration.divisor} days to the month`,
      });
    }
  }

  for (const adj of e.oneOffLines ?? []) {
    if (adj.kind === "earning") {
      gross += adj.amountPaise;
      esicLines.push({
        code: adj.code,
        amountPaise: adj.amountPaise,
        treatment: adj.esicTreatment ?? esicTreatmentForCategory(adj.category),
      });
    }
    lines.push({
      code: adj.code,
      label: adj.label,
      kind: adj.kind,
      category: adj.category,
      amountPaise: adj.amountPaise,
      basis: adj.reason ?? (adj.kind === "earning" ? "One-off incentive" : "One-off deduction"),
    });
  }

  /* ---- ESIC ----
     Last of the earnings-driven deductions, because it is the one that
     depends on all of them. It used to run straight after the salary
     components, so overtime, incentives and a day worked on an off were
     paid out and never had ESIC charged on them at all. */
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const periodEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const esiWage = esicWage(esicLines, esicRuleFor(periodEnd));

  const esic = computeEsic({
    coverageWagePaise: esiWage.coverageWagePaise,
    contributionWagePaise: esiWage.contributionWagePaise,
    paidDays,
    month,
    params: s.esic,
    implementedArea: e.esicImplementedArea,
    coveredAtPeriodStart: e.esicCoveredAtPeriodStart,
    establishmentCovered: e.esicEstablishmentCovered,
  });

  if (
    e.esicApplicability === "no" &&
    esiWage.coverageWagePaise <= s.esic.wageThresholdPaise
  ) {
    warnings.push(
      "ESI is switched off for this person, so nothing has been deducted or contributed for them this month, though their wages are inside the threshold.",
    );
  }

  if (esic.applicable) {
    const wageNote = describeEsicWage(esiWage);
    lines.push({
      code: "ESIC_EE",
      label: "ESIC — employee",
      kind: "deduction",
      amountPaise: esic.employeePaise,
      basis: `0.75% — ${wageNote} — ${esic.reason}`,
    });
    lines.push({
      code: "ESIC_ER",
      label: "ESIC — employer",
      kind: "employer_contribution",
      amountPaise: esic.employerPaise,
      basis: `3.25% — ${wageNote}`,
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
