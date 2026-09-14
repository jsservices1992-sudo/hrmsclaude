import type { Paise } from "../payroll/money";

/**
 * EPF electronic challan-cum-return — PRD §3.12, FR-STAT-2.
 *
 * The ECR is a delimited text file the EPFO portal ingests. Every field
 * is in whole rupees, not paise: the portal rejects decimals, so the
 * rounding done here is part of the format, not a display choice.
 *
 * UNVERIFIED. The field order, delimiter and charge rates below are set
 * from the ECR 2.0 layout as understood at the time of writing and have
 * not been validated against a live EPFO upload. Treat a generated file
 * as a draft for review until a real submission has been accepted.
 */

export const ECR_DELIMITER = "#~#";
export const ECR_VERSION = "ecr-2.0.draft.1";
export const ECR_VERIFIED = false;

/** Rates and floors that govern the challan, all configuration. */
export type EpfChargeParams = {
  /** A/c 2 — administrative charges, basis points of EPF wages. */
  adminChargeBps: number;
  /** A/c 2 has a monthly floor regardless of the wage bill. */
  adminChargeMinPaise: Paise;
  /** A/c 21 — EDLI, basis points of EDLI wages. */
  edliBps: number;
  edliMinPaise: Paise;
  /** A/c 22 — EDLI administrative charges. Waived since 2015. */
  edliAdminBps: number;
  /** EDLI and EPS wages are both capped at the statutory ceiling. */
  wageCeilingPaise: Paise;
};

export const EPF_CHARGES_2026: EpfChargeParams = {
  adminChargeBps: 50,
  adminChargeMinPaise: 50000, // ₹500
  edliBps: 50,
  edliMinPaise: 20000, // ₹200
  edliAdminBps: 0,
  wageCeilingPaise: 1_500_000,
};

/* ==================================================================
   Member lines
   ================================================================== */

export type EcrMemberInput = {
  uan: string | null;
  memberName: string;
  empCode: string;
  grossWagesPaise: Paise;
  epfWagesPaise: Paise;
  /** Employee share actually deducted. */
  employeeContributionPaise: Paise;
  /** Total employer share, before the pension split. */
  employerContributionPaise: Paise;
  /** Days in the month with no wages — loss of pay, or an unpaid gap. */
  nonContributoryDays: number;
  refundOfAdvancesPaise: Paise;
  /**
   * A member who first joined the pension scheme on or after 1 September
   * 2014 on wages above the ceiling never enters EPS: the whole employer
   * share goes to provident fund instead.
   */
  eligibleForPension: boolean;
  /** The ceiling does not apply to an international worker. */
  isInternationalWorker: boolean;
  /** Set for a leaver, so the portal closes the membership. */
  dateOfExit: string | null;
  reasonForLeaving: string | null;
};

export type EcrLine = {
  uan: string;
  memberName: string;
  empCode: string;
  grossWagesRupees: number;
  epfWagesRupees: number;
  epsWagesRupees: number;
  edliWagesRupees: number;
  epfContributionRupees: number;
  epsContributionRupees: number;
  /** Employer share less the pension component. */
  epfEpsDiffRupees: number;
  ncpDays: number;
  refundOfAdvancesRupees: number;
  warnings: string[];
};

function toRupees(paise: Paise): number {
  return Math.round(paise / 100);
}

export function buildEcrLine(
  member: EcrMemberInput,
  params: EpfChargeParams,
  epsBps: number,
): EcrLine {
  const warnings: string[] = [];

  if (!member.uan) {
    warnings.push(
      `${member.empCode} has no UAN, so this member cannot be filed — the portal rejects the whole file, not just the row`,
    );
  } else if (!/^\d{12}$/.test(member.uan)) {
    warnings.push(`${member.empCode} has a UAN that is not 12 digits`);
  }

  const ceiling = member.isInternationalWorker
    ? Infinity
    : params.wageCeilingPaise;

  // Pension and EDLI wages are capped even where provident fund is not.
  const epsWagesPaise = member.eligibleForPension
    ? Math.min(member.epfWagesPaise, ceiling)
    : 0;
  const edliWagesPaise = Math.min(member.epfWagesPaise, ceiling);

  const epsContributionPaise = member.eligibleForPension
    ? Math.round((epsWagesPaise * epsBps) / 10000)
    : 0;

  // Both columns are filed in whole rupees, so the difference must be
  // derived from the *rounded* pension figure. Rounding the paise-level
  // difference instead lets the two columns sum to one rupee more than
  // the employer actually paid, which the portal rejects.
  const employerRupees = toRupees(member.employerContributionPaise);
  const epsRupees = toRupees(epsContributionPaise);
  const diffRupees = employerRupees - epsRupees;

  if (diffRupees < 0) {
    warnings.push(
      `${member.empCode}: the pension share exceeds the total employer share, which cannot be right`,
    );
  }

  if (member.nonContributoryDays < 0 || member.nonContributoryDays > 31) {
    warnings.push(
      `${member.empCode}: non-contributory days of ${member.nonContributoryDays} is not a possible number`,
    );
  }

  if (member.dateOfExit && !member.reasonForLeaving) {
    warnings.push(
      `${member.empCode} has an exit date but no reason for leaving; the portal requires both`,
    );
  }

  return {
    uan: member.uan ?? "",
    memberName: member.memberName.toUpperCase(),
    empCode: member.empCode,
    grossWagesRupees: toRupees(member.grossWagesPaise),
    epfWagesRupees: toRupees(member.epfWagesPaise),
    epsWagesRupees: toRupees(epsWagesPaise),
    edliWagesRupees: toRupees(edliWagesPaise),
    epfContributionRupees: toRupees(member.employeeContributionPaise),
    epsContributionRupees: epsRupees,
    epfEpsDiffRupees: Math.max(0, diffRupees),
    ncpDays: member.nonContributoryDays,
    refundOfAdvancesRupees: toRupees(member.refundOfAdvancesPaise),
    warnings,
  };
}

/** One physical line of the ECR file, in the portal's field order. */
export function formatEcrLine(line: EcrLine): string {
  return [
    line.uan,
    line.memberName,
    line.grossWagesRupees,
    line.epfWagesRupees,
    line.epsWagesRupees,
    line.edliWagesRupees,
    line.epfContributionRupees,
    line.epsContributionRupees,
    line.epfEpsDiffRupees,
    line.ncpDays,
    line.refundOfAdvancesRupees,
  ].join(ECR_DELIMITER);
}

export function formatEcrFile(lines: EcrLine[]): string {
  // The portal expects a trailing newline; a file without one is a common
  // cause of a rejected upload.
  return lines.map(formatEcrLine).join("\n") + "\n";
}

/* ==================================================================
   Challan
   ================================================================== */

export type ChallanAccount = {
  account: string;
  label: string;
  amountPaise: Paise;
  basis: string;
};

export type Challan = {
  accounts: ChallanAccount[];
  totalPaise: Paise;
  memberCount: number;
  totalEpfWagesPaise: Paise;
  totalEpsWagesPaise: Paise;
  totalEdliWagesPaise: Paise;
};

/**
 * The account-wise remittance. Charges are computed on the totals, not
 * per member, because the minimums apply to the establishment.
 */
export function computeChallan(
  lines: EcrLine[],
  params: EpfChargeParams,
): Challan {
  const R = (rupees: number) => rupees * 100;

  const totalEpfWages = lines.reduce((a, l) => a + R(l.epfWagesRupees), 0);
  const totalEpsWages = lines.reduce((a, l) => a + R(l.epsWagesRupees), 0);
  const totalEdliWages = lines.reduce((a, l) => a + R(l.edliWagesRupees), 0);

  const employeeShare = lines.reduce(
    (a, l) => a + R(l.epfContributionRupees),
    0,
  );
  const employerPf = lines.reduce((a, l) => a + R(l.epfEpsDiffRupees), 0);
  const pension = lines.reduce((a, l) => a + R(l.epsContributionRupees), 0);

  const admin = Math.max(
    params.adminChargeMinPaise,
    Math.round((totalEpfWages * params.adminChargeBps) / 10000),
  );
  const edli = Math.max(
    params.edliMinPaise,
    Math.round((totalEdliWages * params.edliBps) / 10000),
  );
  const edliAdmin = Math.round((totalEdliWages * params.edliAdminBps) / 10000);

  const accounts: ChallanAccount[] = [
    {
      account: "A/c 1",
      label: "Provident fund — employee and employer",
      amountPaise: employeeShare + employerPf,
      basis: `Employee ₹${(employeeShare / 100).toFixed(0)} plus employer ₹${(employerPf / 100).toFixed(0)} after the pension diversion`,
    },
    {
      account: "A/c 2",
      label: "Administrative charges",
      amountPaise: admin,
      basis:
        admin === params.adminChargeMinPaise
          ? `Minimum of ₹${(params.adminChargeMinPaise / 100).toFixed(0)} applied — ${(params.adminChargeBps / 100).toFixed(2)}% of wages was lower`
          : `${(params.adminChargeBps / 100).toFixed(2)}% of EPF wages`,
    },
    {
      account: "A/c 10",
      label: "Pension scheme",
      amountPaise: pension,
      basis: "Employer share diverted to the pension scheme",
    },
    {
      account: "A/c 21",
      label: "Deposit-linked insurance",
      amountPaise: edli,
      basis:
        edli === params.edliMinPaise
          ? `Minimum of ₹${(params.edliMinPaise / 100).toFixed(0)} applied`
          : `${(params.edliBps / 100).toFixed(2)}% of EDLI wages`,
    },
    {
      account: "A/c 22",
      label: "Insurance administrative charges",
      amountPaise: edliAdmin,
      basis:
        params.edliAdminBps === 0
          ? "Waived"
          : `${(params.edliAdminBps / 100).toFixed(2)}% of EDLI wages`,
    },
  ];

  return {
    accounts,
    totalPaise: accounts.reduce((a, x) => a + x.amountPaise, 0),
    memberCount: lines.length,
    totalEpfWagesPaise: totalEpfWages,
    totalEpsWagesPaise: totalEpsWages,
    totalEdliWagesPaise: totalEdliWages,
  };
}

/* ==================================================================
   Reconciliation
   ================================================================== */

export type Reconciliation = {
  matches: boolean;
  differences: {
    label: string;
    registerPaise: Paise;
    returnPaise: Paise;
    differencePaise: Paise;
    /** Rounding to whole rupees explains small gaps; large ones do not. */
    explainedByRounding: boolean;
  }[];
  warnings: string[];
};

/**
 * The return must agree with the payroll register it came from. Rounding
 * to whole rupees means a few rupees of drift across a large workforce is
 * expected; anything beyond that is a defect and must not be filed.
 */
export function reconcileWithRegister(args: {
  lines: EcrLine[];
  challan: Challan;
  register: {
    employeeContributionPaise: Paise;
    employerContributionPaise: Paise;
    pensionPaise: Paise;
    epfWagesPaise: Paise;
  };
}): Reconciliation {
  const R = (rupees: number) => rupees * 100;
  const warnings: string[] = [];

  const returnEmployee = args.lines.reduce(
    (a, l) => a + R(l.epfContributionRupees),
    0,
  );
  const returnPension = args.lines.reduce(
    (a, l) => a + R(l.epsContributionRupees),
    0,
  );
  const returnEmployer =
    args.lines.reduce((a, l) => a + R(l.epfEpsDiffRupees), 0) + returnPension;

  // One rupee per member is the most rounding can account for.
  const tolerance = args.lines.length * 100;

  const rows = [
    {
      label: "Employee contribution",
      registerPaise: args.register.employeeContributionPaise,
      returnPaise: returnEmployee,
    },
    {
      label: "Employer contribution",
      registerPaise: args.register.employerContributionPaise,
      returnPaise: returnEmployer,
    },
    {
      label: "Pension scheme",
      registerPaise: args.register.pensionPaise,
      returnPaise: returnPension,
    },
    {
      label: "EPF wages",
      registerPaise: args.register.epfWagesPaise,
      returnPaise: args.challan.totalEpfWagesPaise,
    },
  ].map((row) => {
    const difference = row.returnPaise - row.registerPaise;
    return {
      ...row,
      differencePaise: difference,
      explainedByRounding: Math.abs(difference) <= tolerance,
    };
  });

  for (const row of rows) {
    if (!row.explainedByRounding) {
      warnings.push(
        `${row.label} differs from the register by ₹${(Math.abs(row.differencePaise) / 100).toFixed(2)}, which rounding cannot explain. Do not file this.`,
      );
    }
  }

  return {
    matches: rows.every((r) => r.explainedByRounding),
    differences: rows,
    warnings,
  };
}

/** Members the portal will reject outright, gathered before upload. */
export function blockingIssues(lines: EcrLine[]): string[] {
  const issues: string[] = [];

  const noUan = lines.filter((l) => !l.uan);
  if (noUan.length > 0) {
    issues.push(
      `${noUan.length} member(s) have no UAN: ${noUan.map((l) => l.empCode).join(", ")}. The portal rejects the entire file, so these must be resolved before upload.`,
    );
  }

  const badUan = lines.filter((l) => l.uan && !/^\d{12}$/.test(l.uan));
  if (badUan.length > 0) {
    issues.push(
      `${badUan.length} member(s) have a malformed UAN: ${badUan.map((l) => l.empCode).join(", ")}.`,
    );
  }

  const negative = lines.filter(
    (l) => l.epfContributionRupees < 0 || l.epfEpsDiffRupees < 0,
  );
  if (negative.length > 0) {
    issues.push(
      `${negative.length} member(s) have a negative contribution, which the portal will not accept.`,
    );
  }

  return issues;
}
