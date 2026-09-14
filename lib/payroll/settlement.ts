import { roundToRupee, type Paise, type RoundingMode } from "./money";
import {
  computeGratuity,
  computeLeaveEncashment,
  type GratuityResult,
  type LeaveEncashmentResult,
} from "./gratuity";
import {
  computeNotice,
  resolveNoticeDays,
  valueNotice,
  type ExitType,
  type NoticeResult,
  type NoticeSettlement,
} from "../exit/notice";

export type SettlementLine = {
  code: string;
  label: string;
  kind: "payable" | "recovery" | "info";
  amountPaise: Paise;
  basis: string;
  /** Portion exempt from tax, where the component carries an exemption. */
  exemptPaise?: Paise;
};

export type SettlementInput = {
  employeeId: string;
  name: string;
  exitType: ExitType;
  dateOfJoining: string;
  lastWorkingDay: string;
  resignationDate: string;

  /** Salary for days worked in the final month, already prorated. */
  finalMonthSalaryPaise: Paise;
  finalMonthBasis: string;
  /** Statutory deductions on the final month's salary. */
  finalMonthDeductionsPaise: Paise;

  /** Monthly basic + DA, used for gratuity and per-day valuations. */
  monthlyBasicPaise: Paise;
  /** Per-day value used for notice and leave, on the company's basis. */
  perDayPaise: Paise;

  leaveBalanceDays: number;

  noticeRequiredDays?: number | null;
  noticeGradeDays?: number | null;
  noticeEmploymentTypeDays?: number | null;
  companyDefaultNoticeDays: number;
  leaveDaysDuringNotice?: number;
  leaveExtendsNotice: boolean;
  noticeWaived: boolean;
  employerPaysNoticeInLieu?: boolean;

  /** Outstanding loan principal and interest at the last working day. */
  loanOutstandingPaise: Paise;
  /** Assets not returned, valued per the clearance process. */
  assetRecoveryPaise: Paise;
  /** Approved but unpaid reimbursements. */
  reimbursementsPaise: Paise;
  /** Variable pay or incentive due up to the last working day. */
  variablePayPaise: Paise;
  /** Ad-hoc adjustments added by HR, each with its own reason. */
  adjustments?: { label: string; amountPaise: Paise; recovery: boolean; reason: string }[];

  gratuityForfeited?: boolean;
  gratuityForfeitureReason?: string;

  roundingMode?: RoundingMode;
};

export type SettlementResult = {
  employeeId: string;
  name: string;
  exitType: ExitType;
  lines: SettlementLine[];
  notice: NoticeResult;
  noticeSettlement: NoticeSettlement;
  gratuity: GratuityResult;
  leaveEncashment: LeaveEncashmentResult;
  payablesPaise: Paise;
  recoveriesPaise: Paise;
  /** Positive = pay the employee. Negative = the employee owes the company. */
  netPaise: Paise;
  /** True when recoveries exceed payables — a demand, not a payment. */
  isRecoverable: boolean;
  taxableAdditionPaise: Paise;
  exemptTotalPaise: Paise;
  warnings: string[];
};

export function computeSettlement(input: SettlementInput): SettlementResult {
  const lines: SettlementLine[] = [];
  const warnings: string[] = [];

  /* ---- notice ---- */
  const notice = resolveNoticeDays({
    employeeOverrideDays: input.noticeRequiredDays,
    gradeDays: input.noticeGradeDays,
    employmentTypeDays: input.noticeEmploymentTypeDays,
    companyDefaultDays: input.companyDefaultNoticeDays,
  });

  const noticeResult = computeNotice({
    resignationDate: input.resignationDate,
    agreedLastWorkingDay: input.lastWorkingDay,
    requiredDays: notice.days,
    source: notice.source,
    leaveDaysDuringNotice: input.leaveDaysDuringNotice,
    leaveExtendsNotice: input.leaveExtendsNotice,
  });

  const noticeSettlement = valueNotice({
    shortfallDays: noticeResult.shortfallDays,
    perDayPaise: input.perDayPaise,
    exitType: input.exitType,
    waived: input.noticeWaived,
    employerPaysInLieu: input.employerPaysNoticeInLieu,
  });

  /* ---- payables ---- */

  lines.push({
    code: "FINAL_SALARY",
    label: "Salary to last working day",
    kind: "payable",
    amountPaise: input.finalMonthSalaryPaise,
    basis: input.finalMonthBasis,
  });

  const leave = computeLeaveEncashment({
    balanceDays: input.leaveBalanceDays,
    perDayPaise: input.perDayPaise,
    exitType: input.exitType,
    isSeparation: true,
  });

  if (leave.grossPaise > 0) {
    lines.push({
      code: "LEAVE_ENCASH",
      label: "Leave encashment",
      kind: "payable",
      amountPaise: leave.grossPaise,
      basis: `${leave.days} days — ${leave.reason}`,
      exemptPaise: leave.exemptPaise,
    });
  }

  const gratuity = computeGratuity({
    dateOfJoining: input.dateOfJoining,
    lastWorkingDay: input.lastWorkingDay,
    lastDrawnWagePaise: input.monthlyBasicPaise,
    exitType: input.exitType,
    forfeited: input.gratuityForfeited,
    forfeitureReason: input.gratuityForfeitureReason,
  });

  if (gratuity.eligible && gratuity.cappedPaise > 0) {
    lines.push({
      code: "GRATUITY",
      label: "Gratuity",
      kind: "payable",
      amountPaise: gratuity.cappedPaise,
      basis: gratuity.reason,
      exemptPaise: gratuity.exemptPaise,
    });
  } else if (!gratuity.eligible) {
    warnings.push(`Gratuity not payable — ${gratuity.reason}`);
  }

  if (input.variablePayPaise > 0) {
    lines.push({
      code: "VARIABLE",
      label: "Variable pay due",
      kind: "payable",
      amountPaise: input.variablePayPaise,
      basis: "Accrued to last working day",
    });
  }

  if (input.reimbursementsPaise > 0) {
    lines.push({
      code: "REIMBURSE",
      label: "Approved reimbursements",
      kind: "payable",
      amountPaise: input.reimbursementsPaise,
      basis: "Approved but unpaid at exit",
    });
  }

  if (noticeSettlement.kind === "payout") {
    lines.push({
      code: "NOTICE_PAY",
      label: "Notice pay in lieu",
      kind: "payable",
      amountPaise: noticeSettlement.amountPaise,
      basis: noticeSettlement.note,
    });
  }

  /* ---- recoveries ---- */

  if (input.finalMonthDeductionsPaise > 0) {
    lines.push({
      code: "STAT_DEDUCT",
      label: "Statutory deductions on final salary",
      kind: "recovery",
      amountPaise: input.finalMonthDeductionsPaise,
      basis: "PF, ESIC, PT and LWF on the final month",
    });
  }

  if (noticeSettlement.kind === "recovery") {
    lines.push({
      code: "NOTICE_REC",
      label: "Notice period shortfall",
      kind: "recovery",
      amountPaise: noticeSettlement.amountPaise,
      basis: noticeSettlement.note,
    });
  } else if (noticeSettlement.kind === "waived") {
    lines.push({
      code: "NOTICE_WAIVED",
      label: "Notice shortfall waived",
      kind: "info",
      amountPaise: 0,
      basis: noticeSettlement.note,
    });
  }

  if (input.loanOutstandingPaise > 0) {
    lines.push({
      code: "LOAN_REC",
      label: "Loan and advance recovery",
      kind: "recovery",
      amountPaise: input.loanOutstandingPaise,
      basis: "Outstanding principal and interest at last working day",
    });
  }

  if (input.assetRecoveryPaise > 0) {
    lines.push({
      code: "ASSET_REC",
      label: "Unreturned asset recovery",
      kind: "recovery",
      amountPaise: input.assetRecoveryPaise,
      basis: "Valued at clearance",
    });
  }

  for (const adj of input.adjustments ?? []) {
    lines.push({
      code: "ADJ",
      label: adj.label,
      kind: adj.recovery ? "recovery" : "payable",
      amountPaise: adj.amountPaise,
      basis: `Manual adjustment — ${adj.reason}`,
    });
  }

  /* ---- totals ---- */

  const payables = lines
    .filter((l) => l.kind === "payable")
    .reduce((a, l) => a + l.amountPaise, 0);
  const recoveries = lines
    .filter((l) => l.kind === "recovery")
    .reduce((a, l) => a + l.amountPaise, 0);

  const net = roundToRupee(payables - recoveries, input.roundingMode ?? "nearest");

  const exemptTotal = lines.reduce((a, l) => a + (l.exemptPaise ?? 0), 0);

  // Notice recovered from the employee reduces taxable salary; notice paid
  // by the employer is taxable in their hands.
  const noticeTaxAdjustment =
    noticeSettlement.kind === "recovery"
      ? -noticeSettlement.amountPaise
      : noticeSettlement.kind === "payout"
        ? noticeSettlement.amountPaise
        : 0;

  const taxableAddition =
    payables - exemptTotal - input.finalMonthSalaryPaise + noticeTaxAdjustment;

  if (net < 0) {
    warnings.push(
      "Recoveries exceed payables — this settles as a demand on the employee, not a payment",
    );
  }
  if (gratuity.eligible && gratuity.grossPaise > gratuity.cappedPaise) {
    warnings.push("Gratuity capped at the statutory ceiling");
  }
  if (noticeSettlement.kind === "waived") {
    warnings.push("Notice shortfall waived — requires an authorised approver");
  }

  return {
    employeeId: input.employeeId,
    name: input.name,
    exitType: input.exitType,
    lines,
    notice: noticeResult,
    noticeSettlement,
    gratuity,
    leaveEncashment: leave,
    payablesPaise: payables,
    recoveriesPaise: recoveries,
    netPaise: net,
    isRecoverable: net < 0,
    taxableAdditionPaise: Math.max(0, taxableAddition),
    exemptTotalPaise: exemptTotal,
    warnings,
  };
}
