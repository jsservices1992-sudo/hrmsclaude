import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  buildFromGross,
  buildFromTargetCtc,
  evaluateStructure,
  grossForTargetTakeHome,
  takeHomeFor,
  type CtcBreakdown,
  type ComponentSpec,
  type EmployerCostParams,
  type TakeHomeParams,
} from "./compensation";
import { loadStatutoryConfig, loadStructureResolutionContext, resolveEmployeeStructure } from "./load";

/**
 * How a pay figure was entered. Everything is normalised to a monthly
 * gross, because that is the one number payroll actually runs on.
 */
import { type PayMode, PAY_MODES, isPayMode } from "./pay-mode";
export { type PayMode, PAY_MODES, isPayMode };

export type ResolvedPay = {
  /** How the amount was entered, so a salary record can keep the promise. */
  mode: PayMode;
  /** The figure as entered, in the mode above. */
  enteredAmountPaise: number;
  monthlyGrossPaise: number;
  /** The whole gross-to-CTC build-up for the resolved gross. */
  breakdown: CtcBreakdown;
  /** Net in hand after PF, ESIC and PT — before income tax. */
  takeHomePaise: number;
  /**
   * What was taken off to get there, so a screen can show the working
   * rather than a number the employee has to take on trust.
   */
  employeeDeductions: { epfPaise: number; esicPaise: number; ptPaise: number };
  structureId: string | null;
  components: ComponentSpec[];
  /** Plain-English account of how the gross was arrived at. */
  derivation: string;
  warnings: string[];
};

/**
 * The two columns a salary record keeps so it can honour how the pay was
 * agreed. Only take-home needs the amount: every other mode is already
 * fully described by the gross that was stored.
 */
export function payAgreementColumns(pay: ResolvedPay) {
  return {
    payMode: pay.mode,
    targetTakeHomePaise: pay.mode === "take_home" ? pay.enteredAmountPaise : null,
  };
}

/**
 * Turns an amount entered in any mode into the monthly gross it implies,
 * and the full cost build-up on top of it.
 *
 * This is the single place that conversion knows how to do. Onboarding
 * conversion and employee salary revision both route through it, so an
 * offer of "₹24L CTC" means exactly the same thing in both — they used to
 * disagree, and the joiner path silently treated CTC as gross.
 */
export async function resolvePay(args: {
  companyId: string;
  /** Pins a specific structure; otherwise resolved from the department. */
  structureId?: string | null;
  departmentId?: string | null;
  mode: PayMode;
  amountPaise: number;
  /** Statutory rates are read as at this date. */
  asOf: string;
  /** Needed only to price professional tax when solving from take-home. */
  branchId?: string | null;
  gender?: "female" | "male" | "other" | null;
}): Promise<ResolvedPay> {
  const structureCtx = await loadStructureResolutionContext(args.companyId);
  const resolution = resolveEmployeeStructure(structureCtx, {
    employeeStructureId: args.structureId ?? null,
    employeeDepartmentId: args.departmentId ?? null,
  });
  const components = resolution.components;

  const statutory = await loadStatutoryConfig(args.asOf, args.companyId);
  const [companyConfig] = await db
    .select({ epfOnActualBasic: s.companies.epfOnActualBasic })
    .from(s.companies)
    .where(eq(s.companies.id, args.companyId))
    .limit(1);

  const employer: EmployerCostParams = {
    epfCeilingPaise: statutory.epf.wageCeilingPaise,
    epfEmployerBps: statutory.epf.employerBps,
    epfOnActualBasic: companyConfig?.epfOnActualBasic ?? false,
    esicThresholdPaise: statutory.esic.wageThresholdPaise,
    esicEmployerBps: statutory.esic.employerBps,
    gratuityAccrualBps: statutory.gratuity.accrualBps,
  };

  const rupees = (args.amountPaise / 100).toLocaleString("en-IN");
  let monthlyGrossPaise = args.amountPaise;
  let derivation = "Monthly gross as entered";
  let takeHomeParams: TakeHomeParams | null = null;

  if (args.mode === "annual_gross") {
    monthlyGrossPaise = Math.round(args.amountPaise / 12);
    derivation = "Annual gross divided across twelve months";
  } else if (args.mode === "ctc") {
    monthlyGrossPaise = buildFromTargetCtc({
      targetAnnualCtcPaise: args.amountPaise,
      components,
      employer,
    }).monthlyGrossPaise;
    derivation = `Worked back from a target CTC of ₹${rupees} a year, allowing for employer PF, ESIC and gratuity accrual`;
  } else if (args.mode === "take_home") {
    const [branch] = args.branchId
      ? await db
          .select({ stateCode: s.branches.stateCode })
          .from(s.branches)
          .where(eq(s.branches.id, args.branchId))
          .limit(1)
      : [];
    const solved = grossForTargetTakeHome({
      targetMonthlyTakeHomePaise: args.amountPaise,
      components,
      employer,
      stateCode: branch?.stateCode ?? "",
      gender: args.gender ?? null,
      month: Number(args.asOf.slice(5, 7)),
      statutory,
    });
    monthlyGrossPaise = solved.monthlyGrossPaise;
    takeHomeParams = solved.takeHome;
    derivation =
      `Worked back from a target take-home of ₹${rupees} a month` +
      ` (after PF, ESIC and professional tax; income tax is deducted separately once declarations are in).` +
      ` This net is held: every run re-solves the gross against that period's rates, so the amount in hand does not drift`;
  }

  const breakdown = buildFromGross({ monthlyGrossPaise, components, employer });

  // Take-home for display, priced the same way whichever mode was used.
  const evaluation = evaluateStructure(components, monthlyGrossPaise);
  const { takeHome, epf, esic, pt } = takeHomeFor(
    evaluation,
    takeHomeParams ?? {
      epfCeilingPaise: statutory.epf.wageCeilingPaise,
      epfEmployeeBps: statutory.epf.employeeBps,
      epfOnActualBasic: employer.epfOnActualBasic,
      esicThresholdPaise: statutory.esic.wageThresholdPaise,
      esicEmployeeBps: statutory.esic.employeeBps,
      professionalTaxPaise: 0,
    },
  );

  return {
    mode: args.mode,
    enteredAmountPaise: args.amountPaise,
    monthlyGrossPaise,
    breakdown,
    takeHomePaise: takeHome,
    employeeDeductions: { epfPaise: epf, esicPaise: esic, ptPaise: pt },
    structureId: resolution.structureId,
    components,
    derivation,
    warnings: breakdown.warnings,
  };
}
