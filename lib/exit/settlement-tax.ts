import type { Paise } from "../payroll/money";
import type { Regime, RegimeConfig } from "../tax/engine";
import { computeAnnualTax, computeSlabTax } from "../tax/engine";

/**
 * Tax on separation — PRD §3.16, FR-PAY-19.
 *
 * The PRD calls this "the most common defect in Indian settlement
 * processing", and the reason is that a settlement is a *final* part-year
 * computation, not a continuation of the monthly projection. Each
 * component has its own exemption with its own limbs, and applying the
 * monthly logic to a settlement quietly over- or under-deducts.
 *
 * UNVERIFIED, like the rest of the FY 2026-27 tax set. Every ceiling here
 * needs checking against the current Act before anyone files on it.
 */

export type SeparationExemptionLimits = {
  /** Section 10(10) — gratuity. */
  gratuityCeilingPaise: Paise;
  /** Section 10(10AA) — leave encashment on retirement or resignation. */
  leaveEncashmentCeilingPaise: Paise;
  /** Days of leave per completed year admissible for the exemption. */
  leaveDaysPerYear: number;
  /** Months of average salary that cap the leave exemption. */
  leaveMonthsCap: number;
  /** Section 10(10B) — retrenchment compensation. */
  retrenchmentCeilingPaise: Paise;
  /** Section 10(10C) — voluntary retirement. */
  vrsCeilingPaise: Paise;
};

export const SEPARATION_LIMITS_2026: SeparationExemptionLimits = {
  gratuityCeilingPaise: 20_00_000_00,
  leaveEncashmentCeilingPaise: 25_00_000_00,
  leaveDaysPerYear: 30,
  leaveMonthsCap: 10,
  retrenchmentCeilingPaise: 5_00_000_00,
  vrsCeilingPaise: 5_00_000_00,
};

export type ExemptionWorking = {
  label: string;
  amountPaise: Paise;
};

export type ExemptionResult = {
  section: string;
  component: string;
  receivedPaise: Paise;
  exemptPaise: Paise;
  taxablePaise: Paise;
  workings: ExemptionWorking[];
  basis: string;
  warnings: string[];
};

/* ==================================================================
   Gratuity — section 10(10)
   ================================================================== */

export function exemptGratuity(args: {
  receivedPaise: Paise;
  /** Last drawn basic plus dearness allowance, monthly. */
  monthlyBasicPaise: Paise;
  completedYears: number;
  /** Covered by the Payment of Gratuity Act — the common case. */
  coveredByAct: boolean;
  /** Average of the last ten months, for the non-covered computation. */
  averageMonthlyBasicPaise?: Paise;
  limits: SeparationExemptionLimits;
  regime: Regime;
}): ExemptionResult {
  const warnings: string[] = [];

  if (args.receivedPaise <= 0) {
    return {
      section: "10(10)",
      component: "Gratuity",
      receivedPaise: 0,
      exemptPaise: 0,
      taxablePaise: 0,
      workings: [],
      basis: "No gratuity payable",
      warnings: [],
    };
  }

  // The gratuity exemption survives the new regime — unlike most of
  // Chapter VI-A, it is a section 10 exemption on the receipt itself.
  const statutory = args.coveredByAct
    ? Math.round((args.monthlyBasicPaise * 15 * args.completedYears) / 26)
    : Math.round(
        ((args.averageMonthlyBasicPaise ?? args.monthlyBasicPaise) *
          args.completedYears) /
          2,
      );

  const workings: ExemptionWorking[] = [
    { label: "Gratuity actually received", amountPaise: args.receivedPaise },
    {
      label: args.coveredByAct
        ? `15/26 of last drawn wages for ${args.completedYears} completed year(s)`
        : `Half a month's average salary for ${args.completedYears} completed year(s)`,
      amountPaise: statutory,
    },
    { label: "Statutory ceiling", amountPaise: args.limits.gratuityCeilingPaise },
  ];

  const exempt = Math.max(0, Math.min(...workings.map((w) => w.amountPaise)));

  if (!args.coveredByAct && !args.averageMonthlyBasicPaise) {
    warnings.push(
      "This employee is outside the Payment of Gratuity Act, where the exemption uses the average salary of the last ten months. Last drawn wages have been used instead, which may overstate the exemption.",
    );
  }

  return {
    section: "10(10)",
    component: "Gratuity",
    receivedPaise: args.receivedPaise,
    exemptPaise: exempt,
    taxablePaise: Math.max(0, args.receivedPaise - exempt),
    workings,
    basis: "Least of the three limbs",
    warnings,
  };
}

/* ==================================================================
   Leave encashment — section 10(10AA)
   ================================================================== */

export function exemptLeaveEncashment(args: {
  receivedPaise: Paise;
  /** Average monthly salary of the last ten months. */
  averageMonthlySalaryPaise: Paise;
  completedYears: number;
  /** Leave actually encashed, in days. */
  encashedDays: number;
  /** A government employee's encashment is wholly exempt. */
  isGovernmentEmployee: boolean;
  /** Exemption already used at an earlier employer, in this lifetime. */
  previouslyExemptPaise?: Paise;
  limits: SeparationExemptionLimits;
}): ExemptionResult {
  const warnings: string[] = [];

  if (args.receivedPaise <= 0) {
    return {
      section: "10(10AA)",
      component: "Leave encashment",
      receivedPaise: 0,
      exemptPaise: 0,
      taxablePaise: 0,
      workings: [],
      basis: "No leave encashed",
      warnings: [],
    };
  }

  if (args.isGovernmentEmployee) {
    return {
      section: "10(10AA)",
      component: "Leave encashment",
      receivedPaise: args.receivedPaise,
      exemptPaise: args.receivedPaise,
      taxablePaise: 0,
      workings: [
        { label: "Wholly exempt for a government employee", amountPaise: args.receivedPaise },
      ],
      basis: "Section 10(10AA)(i)",
      warnings: [],
    };
  }

  const perDay = Math.round(args.averageMonthlySalaryPaise / 30);

  // The admissible limb: 30 days a year of service, less leave already
  // taken — capped here at what was actually encashed.
  const admissibleDays = Math.min(
    args.encashedDays,
    args.completedYears * args.limits.leaveDaysPerYear,
  );

  const workings: ExemptionWorking[] = [
    { label: "Amount actually received", amountPaise: args.receivedPaise },
    {
      label: `${args.limits.leaveMonthsCap} months' average salary`,
      amountPaise: args.averageMonthlySalaryPaise * args.limits.leaveMonthsCap,
    },
    {
      label: `${admissibleDays} day(s) at ${args.limits.leaveDaysPerYear} a year of service`,
      amountPaise: admissibleDays * perDay,
    },
    {
      label: "Lifetime ceiling",
      amountPaise: Math.max(
        0,
        args.limits.leaveEncashmentCeilingPaise - (args.previouslyExemptPaise ?? 0),
      ),
    },
  ];

  const exempt = Math.max(0, Math.min(...workings.map((w) => w.amountPaise)));

  if ((args.previouslyExemptPaise ?? 0) > 0) {
    warnings.push(
      `₹${((args.previouslyExemptPaise ?? 0) / 100).toFixed(0)} of the lifetime exemption has already been used at an earlier employer, which reduces what is available here.`,
    );
  }

  if (args.encashedDays > args.completedYears * args.limits.leaveDaysPerYear) {
    warnings.push(
      `${args.encashedDays} days are being encashed but only ${args.completedYears * args.limits.leaveDaysPerYear} qualify for the exemption at ${args.limits.leaveDaysPerYear} days a year of service. The balance is taxable.`,
    );
  }

  return {
    section: "10(10AA)",
    component: "Leave encashment",
    receivedPaise: args.receivedPaise,
    exemptPaise: exempt,
    taxablePaise: Math.max(0, args.receivedPaise - exempt),
    workings,
    basis: "Least of the four limbs",
    warnings,
  };
}

/* ==================================================================
   Retrenchment and voluntary retirement
   ================================================================== */

export function exemptSeparationCompensation(args: {
  receivedPaise: Paise;
  kind: "retrenchment" | "vrs" | "none";
  /** 15 days' average pay per completed year, under the ID Act. */
  averageDailyPaise?: Paise;
  completedYears?: number;
  limits: SeparationExemptionLimits;
}): ExemptionResult {
  if (args.kind === "none" || args.receivedPaise <= 0) {
    return {
      section: "—",
      component: "Separation compensation",
      receivedPaise: args.receivedPaise,
      exemptPaise: 0,
      taxablePaise: Math.max(0, args.receivedPaise),
      workings: [],
      basis: "No retrenchment or voluntary retirement compensation",
      warnings: [],
    };
  }

  if (args.kind === "vrs") {
    const exempt = Math.min(args.receivedPaise, args.limits.vrsCeilingPaise);
    return {
      section: "10(10C)",
      component: "Voluntary retirement compensation",
      receivedPaise: args.receivedPaise,
      exemptPaise: exempt,
      taxablePaise: args.receivedPaise - exempt,
      workings: [
        { label: "Amount received", amountPaise: args.receivedPaise },
        { label: "Statutory ceiling", amountPaise: args.limits.vrsCeilingPaise },
      ],
      basis: "Exempt up to the ceiling, once in a lifetime",
      warnings: [
        "The section 10(10C) exemption may be claimed only once in a lifetime and requires the scheme to meet the prescribed conditions. Confirm both before relying on it.",
      ],
    };
  }

  // Retrenchment: the statutory limb is 15 days' average pay a year.
  const statutory =
    args.averageDailyPaise && args.completedYears
      ? args.averageDailyPaise * 15 * args.completedYears
      : 0;

  const workings: ExemptionWorking[] = [
    { label: "Amount received", amountPaise: args.receivedPaise },
    { label: "Statutory ceiling", amountPaise: args.limits.retrenchmentCeilingPaise },
  ];
  if (statutory > 0) {
    workings.push({
      label: `15 days' average pay for ${args.completedYears} year(s) under the Industrial Disputes Act`,
      amountPaise: statutory,
    });
  }

  const exempt = Math.max(0, Math.min(...workings.map((w) => w.amountPaise)));

  return {
    section: "10(10B)",
    component: "Retrenchment compensation",
    receivedPaise: args.receivedPaise,
    exemptPaise: exempt,
    taxablePaise: Math.max(0, args.receivedPaise - exempt),
    workings,
    basis: "Least of the limbs",
    warnings: [],
  };
}

/* ==================================================================
   Notice pay — the direction matters
   ================================================================== */

export type NoticeTaxTreatment = {
  /** Paid by the employer for notice not served — taxable salary. */
  paidByEmployerPaise: Paise;
  /** Recovered from the employee for short notice. */
  recoveredFromEmployeePaise: Paise;
  /** Whether the recovery is treated as reducing taxable salary. */
  reducesTaxableSalary: boolean;
  taxableEffectPaise: Paise;
  basis: string;
  warnings: string[];
};

/**
 * Notice pay runs in both directions and they are not symmetrical.
 *
 * Paid by the employer, it is profits in lieu of salary and plainly
 * taxable. Recovered from the employee, whether it reduces taxable salary
 * is genuinely contested — tribunals have held it does, the department
 * has often held it does not, and employers differ. It is therefore a
 * setting with a stated default rather than a silent assumption.
 */
export function treatNoticePay(args: {
  paidByEmployerPaise: Paise;
  recoveredFromEmployeePaise: Paise;
  reducesTaxableSalary: boolean;
}): NoticeTaxTreatment {
  const warnings: string[] = [];

  if (args.recoveredFromEmployeePaise > 0) {
    warnings.push(
      args.reducesTaxableSalary
        ? "Notice pay recovered is being treated as reducing taxable salary. Tribunals have supported this, but the department has taken the opposite view and it can be questioned on assessment."
        : "Notice pay recovered is not reducing taxable salary, so the employee is taxed on salary they did not keep. Several tribunal decisions say otherwise — this is a policy choice, and the employee may claim it in their own return.",
    );
  }

  const effect =
    args.paidByEmployerPaise -
    (args.reducesTaxableSalary ? args.recoveredFromEmployeePaise : 0);

  return {
    paidByEmployerPaise: args.paidByEmployerPaise,
    recoveredFromEmployeePaise: args.recoveredFromEmployeePaise,
    reducesTaxableSalary: args.reducesTaxableSalary,
    taxableEffectPaise: effect,
    basis:
      args.paidByEmployerPaise > 0
        ? "Notice pay paid by the employer is taxable as profits in lieu of salary"
        : args.reducesTaxableSalary
          ? "Notice recovery reduces taxable salary"
          : "Notice recovery does not reduce taxable salary",
    warnings,
  };
}

/* ==================================================================
   The final computation
   ================================================================== */

export type SeparationTaxInput = {
  regime: Regime;
  config: RegimeConfig;
  limits: SeparationExemptionLimits;

  /** Salary already paid this financial year, to the last working day. */
  salaryToDatePaise: Paise;
  /** Exempt allowances already allowed against that salary. */
  exemptAllowancesToDatePaise: Paise;
  /** Chapter VI-A deductions verified for the year. */
  chapterViAPaise: Paise;
  professionalTaxPaidPaise: Paise;
  /** TDS already deducted this year by this employer. */
  tdsDeductedToDatePaise: Paise;
  previousEmployerSalaryPaise: Paise;
  previousEmployerTdsPaise: Paise;

  gratuity: ExemptionResult;
  leaveEncashment: ExemptionResult;
  separationCompensation: ExemptionResult;
  notice: NoticeTaxTreatment;
  /** Other settlement payables that are plainly taxable. */
  otherTaxablePaise: Paise;
};

export type SeparationTaxResult = {
  /** Every settlement component with its exempt and taxable split. */
  components: ExemptionResult[];
  totalSettlementPaise: Paise;
  totalExemptPaise: Paise;
  totalTaxablePaise: Paise;
  taxableIncomePaise: Paise;
  annualTaxPaise: Paise;
  alreadyDeductedPaise: Paise;
  /** Tax still to deduct from the settlement. Negative means a refund. */
  tdsOnSettlementPaise: Paise;
  isRefund: boolean;
  warnings: string[];
  basis: string;
};

export function computeSeparationTax(
  input: SeparationTaxInput,
): SeparationTaxResult {
  const warnings: string[] = [];

  const components = [
    input.gratuity,
    input.leaveEncashment,
    input.separationCompensation,
  ].filter((c) => c.receivedPaise > 0);

  for (const c of components) warnings.push(...c.warnings);
  warnings.push(...input.notice.warnings);

  const totalSettlement =
    components.reduce((a, c) => a + c.receivedPaise, 0) +
    input.notice.paidByEmployerPaise +
    input.otherTaxablePaise;

  const totalExempt = components.reduce((a, c) => a + c.exemptPaise, 0);

  const totalTaxable =
    components.reduce((a, c) => a + c.taxablePaise, 0) +
    input.notice.taxableEffectPaise +
    input.otherTaxablePaise;

  /*
   * The whole point of FR-PAY-19: this is a final computation for the
   * part year, so the year's salary and the settlement are taxed together
   * and the tax already deducted is credited once — not a twelfth of an
   * annual projection applied to a final month.
   */
  const annual = computeAnnualTax({
    grossSalaryPaise: input.salaryToDatePaise + totalTaxable,
    exemptAllowancesPaise: input.exemptAllowancesToDatePaise,
    perquisitesPaise: 0,
    previousEmployerSalaryPaise: input.previousEmployerSalaryPaise,
    previousEmployerTdsPaise: input.previousEmployerTdsPaise,
    professionalTaxPaidPaise: input.professionalTaxPaidPaise,
    deductions: {
      lines: [],
      totalAllowedPaise: input.config.allowsChapterViA ? input.chapterViAPaise : 0,
      disallowedPaise: 0,
    },
    config: input.config,
  });

  const stillToDeduct =
    annual.netTaxPayablePaise - input.tdsDeductedToDatePaise;

  if (stillToDeduct < 0) {
    warnings.push(
      `More tax has been deducted this year than the final computation requires. ₹${(Math.abs(stillToDeduct) / 100).toFixed(2)} is a refund, and it must be paid with the settlement rather than left for the employee to claim.`,
    );
  }

  if (totalTaxable > 0 && input.tdsDeductedToDatePaise === 0) {
    warnings.push(
      "No tax has been deducted this year, so the whole liability falls on this settlement. Check the employee was actually below the threshold rather than simply never projected.",
    );
  }

  return {
    components,
    totalSettlementPaise: totalSettlement,
    totalExemptPaise: totalExempt,
    totalTaxablePaise: totalTaxable,
    taxableIncomePaise: annual.taxableIncomePaise,
    annualTaxPaise: annual.netTaxPayablePaise,
    alreadyDeductedPaise: input.tdsDeductedToDatePaise,
    tdsOnSettlementPaise: stillToDeduct,
    isRefund: stillToDeduct < 0,
    warnings,
    basis: `Final computation for the part year on ₹${(annual.taxableIncomePaise / 100).toLocaleString("en-IN")} of taxable income, less ₹${(input.tdsDeductedToDatePaise / 100).toLocaleString("en-IN")} already deducted`,
  };
}

/** Marginal rate at the settlement, for explaining the deduction. */
export function marginalRateBps(
  taxableIncomePaise: Paise,
  config: RegimeConfig,
): number {
  const band = config.slabs.find(
    (s) =>
      taxableIncomePaise > s.fromPaise &&
      (s.toPaise === null || taxableIncomePaise <= s.toPaise),
  );
  return band?.rateBps ?? 0;
}

/* ==================================================================
   Ageing and the settlement SLA — FR-PAY-21
   ================================================================== */

export type SettlementAgeing = {
  daysSinceLastWorkingDay: number;
  slaDays: number;
  daysRemaining: number;
  /** Gratuity carries its own statutory expectation. */
  gratuityDueWithinDays: number;
  status: "not_due" | "due_soon" | "overdue" | "gratuity_overdue";
  note: string;
};

/**
 * The PRD asks for ageing as a work queue rather than a report, which
 * means the status has to be decided here rather than left to a reader
 * comparing two dates.
 */
export function assessAgeing(args: {
  lastWorkingDay: string;
  today: string;
  slaDays: number;
  /** Gratuity is expected within 30 days of it becoming payable. */
  gratuityDueWithinDays?: number;
  gratuityPayable: boolean;
  settled: boolean;
}): SettlementAgeing {
  const gratuityDays = args.gratuityDueWithinDays ?? 30;
  const elapsed = Math.round(
    (Date.parse(args.today + "T00:00:00Z") -
      Date.parse(args.lastWorkingDay + "T00:00:00Z")) /
      86_400_000,
  );
  const remaining = args.slaDays - elapsed;

  if (args.settled) {
    return {
      daysSinceLastWorkingDay: elapsed,
      slaDays: args.slaDays,
      daysRemaining: remaining,
      gratuityDueWithinDays: gratuityDays,
      status: "not_due",
      note: "Settled",
    };
  }

  // Gratuity has its own clock and it runs faster than most SLAs.
  if (args.gratuityPayable && elapsed > gratuityDays) {
    return {
      daysSinceLastWorkingDay: elapsed,
      slaDays: args.slaDays,
      daysRemaining: remaining,
      gratuityDueWithinDays: gratuityDays,
      status: "gratuity_overdue",
      note: `${elapsed} days since the last working day. Gratuity is expected within ${gratuityDays} days of becoming payable, and interest runs on a delay beyond that.`,
    };
  }

  if (elapsed > args.slaDays) {
    return {
      daysSinceLastWorkingDay: elapsed,
      slaDays: args.slaDays,
      daysRemaining: remaining,
      gratuityDueWithinDays: gratuityDays,
      status: "overdue",
      note: `${elapsed - args.slaDays} day(s) past the ${args.slaDays}-day settlement commitment.`,
    };
  }

  if (remaining <= 7) {
    return {
      daysSinceLastWorkingDay: elapsed,
      slaDays: args.slaDays,
      daysRemaining: remaining,
      gratuityDueWithinDays: gratuityDays,
      status: "due_soon",
      note: `${remaining} day(s) left of the ${args.slaDays}-day commitment.`,
    };
  }

  return {
    daysSinceLastWorkingDay: elapsed,
    slaDays: args.slaDays,
    daysRemaining: remaining,
    gratuityDueWithinDays: gratuityDays,
    status: "not_due",
    note: `${remaining} day(s) left of the ${args.slaDays}-day commitment.`,
  };
}

/* ==================================================================
   Negative settlement — FR-PAY-20
   ================================================================== */

export type RecoveryPosting = {
  amountPaise: Paise;
  at: string;
  method: string;
  reference: string | null;
};

export type ReceivableState = {
  originalPaise: Paise;
  recoveredPaise: Paise;
  writtenOffPaise: Paise;
  outstandingPaise: Paise;
  settled: boolean;
  status: "outstanding" | "part_recovered" | "recovered" | "written_off";
  warnings: string[];
};

/**
 * A settlement that resolves against the employee is a demand, not a
 * payment. The PRD is explicit that it must never silently round to
 * zero: the balance is tracked as a receivable until it is recovered or
 * deliberately written off.
 */
export function assessReceivable(args: {
  originalPaise: Paise;
  recoveries: RecoveryPosting[];
  writtenOffPaise: Paise;
}): ReceivableState {
  const warnings: string[] = [];

  const recovered = args.recoveries.reduce((a, r) => a + r.amountPaise, 0);
  const outstanding = Math.max(
    0,
    args.originalPaise - recovered - args.writtenOffPaise,
  );

  if (recovered + args.writtenOffPaise > args.originalPaise) {
    warnings.push(
      `Recoveries and write-offs total ₹${((recovered + args.writtenOffPaise) / 100).toFixed(2)} against an original demand of ₹${(args.originalPaise / 100).toFixed(2)}. More has been collected than was owed.`,
    );
  }

  const status: ReceivableState["status"] =
    args.writtenOffPaise > 0 && outstanding === 0
      ? "written_off"
      : outstanding === 0
        ? "recovered"
        : recovered > 0
          ? "part_recovered"
          : "outstanding";

  return {
    originalPaise: args.originalPaise,
    recoveredPaise: recovered,
    writtenOffPaise: args.writtenOffPaise,
    outstandingPaise: outstanding,
    settled: outstanding === 0,
    status,
    warnings,
  };
}

export { computeSlabTax };
