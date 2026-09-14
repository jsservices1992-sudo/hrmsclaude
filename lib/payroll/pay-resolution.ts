import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  buildFromGross,
  buildFromTargetCtc,
  buildFromTargetTakeHome,
  evaluateStructure,
  takeHomeFor,
  type CtcBreakdown,
  type ComponentSpec,
  type EmployerCostParams,
  type TakeHomeParams,
} from "./compensation";
import { computeProfessionalTax } from "./statutory";
import { loadStatutoryConfig, loadStructureResolutionContext, resolveEmployeeStructure } from "./load";

/**
 * How a pay figure was entered. Everything is normalised to a monthly
 * gross, because that is the one number payroll actually runs on.
 */
export type PayMode = "gross" | "annual_gross" | "ctc" | "take_home";

export const PAY_MODES: PayMode[] = ["gross", "annual_gross", "ctc", "take_home"];

export function isPayMode(v: string): v is PayMode {
  return (PAY_MODES as string[]).includes(v);
}

/**
 * 15 days' wages a year over 26 working days, spread monthly — the
 * standard gratuity accrual.
 */
const GRATUITY_ACCRUAL_BPS = 481;

export type ResolvedPay = {
  monthlyGrossPaise: number;
  /** The whole gross-to-CTC build-up for the resolved gross. */
  breakdown: CtcBreakdown;
  /** Net in hand after PF, ESIC and PT — before income tax. */
  takeHomePaise: number;
  structureId: string | null;
  components: ComponentSpec[];
  /** Plain-English account of how the gross was arrived at. */
  derivation: string;
  warnings: string[];
};

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

  const statutory = await loadStatutoryConfig(args.asOf);
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
    gratuityAccrualBps: GRATUITY_ACCRUAL_BPS,
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
    const stateCode = branch?.stateCode ?? "";
    const month = Number(args.asOf.slice(5, 7));

    const ptFor = (ptBasePaise: number) =>
      computeProfessionalTax({
        stateCode,
        ptBasePaise,
        month,
        gender: args.gender ?? "other",
        slabs: statutory.ptSlabsByState[stateCode] ?? [],
        applicable: statutory.ptApplicableByState[stateCode] ?? false,
      }).amountPaise;

    const paramsFor = (professionalTaxPaise: number): TakeHomeParams => ({
      epfCeilingPaise: statutory.epf.wageCeilingPaise,
      epfEmployeeBps: statutory.epf.employeeBps,
      epfOnActualBasic: employer.epfOnActualBasic,
      esicThresholdPaise: statutory.esic.wageThresholdPaise,
      esicEmployeeBps: statutory.esic.employeeBps,
      professionalTaxPaise,
    });

    /* Professional tax is a step function of the PT base, which itself
       depends on the gross being solved for. So the search runs twice:
       once with PT taken at the target take-home, then again with PT
       recomputed from the gross that produced. The slabs are coarse
       enough that the second pass lands on the right step. */
    const firstPass = buildFromTargetTakeHome({
      targetMonthlyTakeHomePaise: args.amountPaise,
      components,
      employer,
      takeHome: paramsFor(ptFor(args.amountPaise)),
    });
    takeHomeParams = paramsFor(
      ptFor(evaluateStructure(components, firstPass.monthlyGrossPaise).ptBasePaise),
    );
    const settled = buildFromTargetTakeHome({
      targetMonthlyTakeHomePaise: args.amountPaise,
      components,
      employer,
      takeHome: takeHomeParams,
    });
    monthlyGrossPaise = settled.monthlyGrossPaise;
    derivation =
      `Worked back from a target take-home of ₹${rupees} a month` +
      ` (after PF, ESIC and professional tax; income tax is deducted separately once declarations are in)`;
  }

  const breakdown = buildFromGross({ monthlyGrossPaise, components, employer });

  // Take-home for display, priced the same way whichever mode was used.
  const evaluation = evaluateStructure(components, monthlyGrossPaise);
  const { takeHome } = takeHomeFor(
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
    monthlyGrossPaise,
    breakdown,
    takeHomePaise: takeHome,
    structureId: resolution.structureId,
    components,
    derivation,
    warnings: breakdown.warnings,
  };
}
