import { anchorsFrom, grossForTargetTakeHome, type ComponentSpec } from "./compensation";
import type { StatutoryConfig } from "./engine";
import { coverageFor, pfMembership } from "./coverage";
import type { Paise } from "./money";

/**
 * The monthly gross a salary actually pays this month.
 *
 * For a salary agreed as a gross, CTC or annual figure, that is the gross
 * on record. For one held at a take-home, the stored gross is only what
 * the net worked back to on the day it was saved — against whatever PF,
 * ESI and PT were assumed then. The run re-solves it every month against
 * this person's real deductions, so every screen that shows it must too:
 * a payslip that printed the stored ₹20,367 as the rate while paying a
 * ₹19,000 gross to someone with no PF was describing a salary nobody has.
 */
export function effectiveMonthlyGross(args: {
  salary: { payMode: string | null; targetTakeHomePaise: number | null; monthlyGrossPaise: Paise };
  components: ComponentSpec[];
  statutory: StatutoryConfig;
  company: { epfOnActualBasic: boolean; epfCoverage: string; esicCoverage: string; declaredHeadcount: number | null };
  employee: {
    pfOptedIn: boolean;
    hadPriorPfMembership: boolean;
    uan?: string | null;
    pfApplicability?: string | null;
    esicApplicability?: string | null;
    employmentType?: string | null;
    gender?: "female" | "male" | "other" | null;
    employerNpsBps?: number | null;
    esicDisabilityEligible?: boolean;
  };
  stateCode: string;
  month: number;
}): { grossPaise: Paise; anchors?: Map<string, Paise> } {
  const { salary } = args;
  const statutory = args.employee.esicDisabilityEligible ? { ...args.statutory,
    esic: { ...args.statutory.esic, wageThresholdPaise: args.statutory.esic.disabilityWageThresholdPaise ?? 2500000 } } : args.statutory;
  if (salary.payMode !== "take_home" || !salary.targetTakeHomePaise) {
    return { grossPaise: salary.monthlyGrossPaise };
  }
  const anchors = anchorsFrom(args.components, salary.monthlyGrossPaise);
  const member = pfMembership({
    hadPriorPfMembership: args.employee.hadPriorPfMembership,
    uan: args.employee.uan,
    pfOptedIn: args.employee.pfOptedIn,
  });
  const solved = grossForTargetTakeHome({
    targetMonthlyTakeHomePaise: salary.targetTakeHomePaise,
    components: args.components,
    anchors,
    employer: {
      epfCeilingPaise: statutory.epf.wageCeilingPaise,
      epfEmployerBps: statutory.epf.employerBps,
      epfCoverageCeilingPaise: statutory.epf.coverageCeilingPaise,
      epfOnActualBasic: args.company.epfOnActualBasic,
      esicThresholdPaise: statutory.esic.wageThresholdPaise,
      esicEmployerBps: statutory.esic.employerBps,
      gratuityAccrualBps: statutory.gratuity.accrualBps,
      epfEdliBps: statutory.epf.edliBps,
      epfEdliCeilingPaise: statutory.epf.edliCeilingPaise,
      epfAdminBps: statutory.epf.adminBps,
      pfOptedIn: member.pfOptedIn,
      hadPriorPfMembership: member.hadPriorPfMembership,
      employerNpsBps: args.employee.employerNpsBps ?? 0,
    },
    stateCode: args.stateCode,
    gender: args.employee.gender ?? null,
    month: args.month,
    pfOptedIn: member.pfOptedIn,
    hadPriorPfMembership: member.hadPriorPfMembership,
    ...coverageFor(args.company, args.employee),
    statutory,
  });
  return { grossPaise: solved.monthlyGrossPaise, anchors };
}
