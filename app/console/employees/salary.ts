"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  getSessionUser,
  canMutate,
  canAccessCompany,
} from "@/lib/auth/session";
import { recordAudit, loadSodPolicies } from "@/lib/audit/log";
import { checkSalaryApproval } from "@/lib/audit/controls";
import {
  loadStructureResolutionContext,
  resolveEmployeeStructure,
  loadStatutoryConfig,
} from "@/lib/payroll/load";
import {
  buildFromGross,
  buildFromTargetCtc,
  buildFromTargetTakeHome,
  computeArrears,
  evaluateStructure,
  type CtcBreakdown,
  type EmployerCostParams,
  type TakeHomeParams,
} from "@/lib/payroll/compensation";
import { computeProfessionalTax } from "@/lib/payroll/statutory";

export type SalaryState = {
  error?: string;
  ok?: string;
  ctc?: CtcBreakdown;
  structureId?: string | null;
};

/**
 * Salary revision at the employee level — the UI half of PRD §3.7 that
 * the engine has always had and nothing could reach.
 *
 * Revisions are effective-dated and never destructive: the current row is
 * closed off rather than edited, so a historic run still reproduces the
 * figure it used (FR-AUD-2).
 */
export async function reviseSalary(
  _prev: SalaryState,
  fd: FormData,
): Promise<SalaryState> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authorised." };
  if (!canMutate(user)) {
    return { error: "Only payroll may change what someone is paid." };
  }

  const employeeId = String(fd.get("employeeId") ?? "");

  const [employee] = await db
    .select()
    .from(s.employees)
    .where(eq(s.employees.id, employeeId))
    .limit(1);
  if (!employee) return { error: "Employee not found." };
  if (!canAccessCompany(user, employee.companyId)) {
    return { error: "Not authorised." };
  }

  /*
   * Segregation of duties — FR-AUD-4. One person creating a payee and
   * setting their pay is the classic payroll fraud, so the rule is
   * checked here and a blocked attempt is logged.
   */
  const decision = checkSalaryApproval({
    approver: user.email,
    employeeCreatedBy: employee.createdBy,
    policies: await loadSodPolicies(employee.companyId),
  });

  if (!decision.allowed) {
    await recordAudit({
      user,
      action: decision.logAs ?? "salary.approve.denied",
      entity: "employee_salary",
      entityId: employeeId,
      reason: `${decision.rule}: ${decision.reason}`,
    });
    return { error: decision.reason };
  }

  const mode = String(fd.get("mode") ?? "gross");
  const amountRupees = Number(fd.get("amount") ?? 0);
  const effectiveFrom = String(fd.get("effectiveFrom") ?? "").trim();
  const revisionType = String(fd.get("revisionType") ?? "annual");
  const reason = String(fd.get("reason") ?? "").trim() || null;
  // A submitted empty selection means "no explicit pin" — the employee
  // falls through to their department override or the company default at
  // compute time (NOT "pin to whatever the default happens to be right
  // now"). A field that isn't present at all (an older form) carries the
  // existing pin forward unchanged, same as before this field existed.
  const structureIdRaw = fd.has("structureId") ? String(fd.get("structureId") ?? "").trim() : undefined;

  if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
    return { error: "Enter the new amount in rupees." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    return { error: "Enter the effective date as YYYY-MM-DD." };
  }
  if (
    !["initial", "annual", "promotion", "confirmation", "correction", "market"].includes(
      revisionType,
    )
  ) {
    return { error: "Choose a revision type." };
  }

  const [current] = await db
    .select()
    .from(s.employeeSalaries)
    .where(
      and(
        eq(s.employeeSalaries.employeeId, employeeId),
        isNull(s.employeeSalaries.effectiveTo),
      ),
    )
    .orderBy(desc(s.employeeSalaries.effectiveFrom))
    .limit(1);

  if (current && effectiveFrom <= current.effectiveFrom) {
    return {
      error: `The current salary is effective from ${current.effectiveFrom}. A revision must start after that — backdating means editing history rather than adding to it.`,
    };
  }

  const structureCtx = await loadStructureResolutionContext(employee.companyId);
  const resolution = resolveEmployeeStructure(structureCtx, {
    employeeStructureId: current?.structureId ?? null,
    employeeDepartmentId: employee.departmentId,
  });
  const structure = resolution.components;
  const amountPaise = Math.round(amountRupees * 100);

  // The same statutory rates payroll itself runs on, as at the date this
  // revision takes effect — so the CTC quoted here is the CTC the runs
  // will actually cost.
  const statutory = await loadStatutoryConfig(effectiveFrom);
  const [companyConfig] = await db
    .select({ epfOnActualBasic: s.companies.epfOnActualBasic })
    .from(s.companies)
    .where(eq(s.companies.id, employee.companyId))
    .limit(1);

  const employerParams: EmployerCostParams = {
    epfCeilingPaise: statutory.epf.wageCeilingPaise,
    epfEmployerBps: statutory.epf.employerBps,
    epfOnActualBasic: companyConfig?.epfOnActualBasic ?? false,
    esicThresholdPaise: statutory.esic.wageThresholdPaise,
    esicEmployerBps: statutory.esic.employerBps,
    // 15 days' wages a year over 26 working days, spread monthly.
    gratuityAccrualBps: 481,
  };

  // From a target CTC or take-home, work back to the gross that produces it.
  let monthlyGrossPaise = amountPaise;
  let derivation = "Monthly gross as entered";

  if (mode === "ctc") {
    const built = buildFromTargetCtc({
      targetAnnualCtcPaise: amountPaise,
      components: structure,
      employer: employerParams,
    });
    monthlyGrossPaise = built.monthlyGrossPaise;
    derivation = `Derived from a target CTC of ₹${amountRupees.toLocaleString("en-IN")} a year`;
  } else if (mode === "annual_gross") {
    monthlyGrossPaise = Math.round(amountPaise / 12);
    derivation = "Annual gross divided across twelve months";
  } else if (mode === "take_home") {
    const [branch] = employee.branchId
      ? await db
          .select({ stateCode: s.branches.stateCode })
          .from(s.branches)
          .where(eq(s.branches.id, employee.branchId))
          .limit(1)
      : [];
    const stateCode = branch?.stateCode ?? "";
    const revisionMonth = Number(effectiveFrom.slice(5, 7));

    /* Professional tax is a step function of the PT base, which itself
       depends on the gross being solved for, so the search is run twice:
       once with PT taken at the target take-home, then again with PT
       recomputed from the gross that produced. The slabs are coarse
       enough that the second pass lands on the right step. */
    const ptFor = (ptBasePaise: number) =>
      computeProfessionalTax({
        stateCode,
        ptBasePaise,
        month: revisionMonth,
        gender: employee.gender,
        slabs: statutory.ptSlabsByState[stateCode] ?? [],
        applicable: statutory.ptApplicableByState[stateCode] ?? false,
      }).amountPaise;

    const takeHomeParamsFor = (professionalTaxPaise: number): TakeHomeParams => ({
      epfCeilingPaise: statutory.epf.wageCeilingPaise,
      epfEmployeeBps: statutory.epf.employeeBps,
      epfOnActualBasic: employerParams.epfOnActualBasic,
      esicThresholdPaise: statutory.esic.wageThresholdPaise,
      esicEmployeeBps: statutory.esic.employeeBps,
      professionalTaxPaise,
    });

    const firstPass = buildFromTargetTakeHome({
      targetMonthlyTakeHomePaise: amountPaise,
      components: structure,
      employer: employerParams,
      takeHome: takeHomeParamsFor(ptFor(amountPaise)),
    });
    const settled = buildFromTargetTakeHome({
      targetMonthlyTakeHomePaise: amountPaise,
      components: structure,
      employer: employerParams,
      takeHome: takeHomeParamsFor(
        ptFor(evaluateStructure(structure, firstPass.monthlyGrossPaise).ptBasePaise),
      ),
    });

    monthlyGrossPaise = settled.monthlyGrossPaise;
    derivation =
      `Derived from a target take-home of ₹${amountRupees.toLocaleString("en-IN")} a month` +
      ` (lands at ₹${(settled.takeHomePaise / 100).toLocaleString("en-IN")} after PF, ESIC and professional tax;` +
      ` income tax is deducted separately once declarations are in)`;
  }

  const evaluated = buildFromGross({
    monthlyGrossPaise,
    components: structure,
    employer: employerParams,
  });
  if (evaluated.warnings.length > 0) {
    // A structure that cannot express this gross would silently produce a
    // wrong break-up, so it is refused rather than stored.
    return {
      error: `The salary structure cannot express this amount: ${evaluated.warnings.join("; ")}`,
    };
  }

  const now = new Date().toISOString();
  const newId = randomUUID();

  /* Arrears are owed only for months that can no longer be recalculated.
     A period still open picks the new rate up the next time it is run, so
     booking an arrear for it as well pays the increase twice — which is
     exactly what happened before this filter: a revision backdated into
     an open September produced both a recalculated September at the new
     rate and a full arrear on top. Only approved and beyond are closed. */
  const today = now.slice(0, 10);
  const LOCKED = ["approved", "finalised", "disbursed", "closed"];
  const paidPeriods =
    current && effectiveFrom < today
      ? (
          await db
            .select({
              year: s.payrollRuns.periodYear,
              month: s.payrollRuns.periodMonth,
              gross: s.payrollEmployeeSummaries.grossPaise,
              status: s.payrollRuns.status,
            })
            .from(s.payrollEmployeeSummaries)
            .innerJoin(
              s.payrollRuns,
              eq(s.payrollEmployeeSummaries.runId, s.payrollRuns.id),
            )
            .where(eq(s.payrollEmployeeSummaries.employeeId, employeeId))
        )
          .filter((r) => LOCKED.includes(r.status))
          .map((r) => ({
            period: `${r.year}-${String(r.month).padStart(2, "0")}`,
            paidGrossPaise: r.gross,
          }))
      : [];

  const arrears =
    paidPeriods.length > 0
      ? computeArrears({
          revision: {
            effectiveFrom,
            monthlyGrossPaise,
            reason: reason ?? revisionType,
          },
          paidPeriods,
        })
      : { lines: [], totalPaise: 0 };

  /* Where the arrears will actually be paid.
     Backdating a revision over months already run leaves a shortfall the
     employee is owed. Until now that figure was computed, announced to
     the user — "will appear in the next payroll" — and then dropped, so
     nobody was ever paid it. It is written as a one-off earning against
     the next period that is still open, which is the same pipeline
     overtime and bonus travel on, so it reaches the register, the payslip
     and the bank file without a second mechanism. */
  let arrearPeriod: { year: number; month: number } | null = null;
  if (arrears.totalPaise !== 0) {
    const now = new Date();
    const candidates = [
      { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 },
      // Next month, if this one is already signed off.
      now.getUTCMonth() + 1 === 12
        ? { year: now.getUTCFullYear() + 1, month: 1 }
        : { year: now.getUTCFullYear(), month: now.getUTCMonth() + 2 },
    ];
    const runsForCandidates = await db
      .select({
        year: s.payrollRuns.periodYear,
        month: s.payrollRuns.periodMonth,
        status: s.payrollRuns.status,
      })
      .from(s.payrollRuns)
      .where(eq(s.payrollRuns.companyId, employee.companyId));
    const locked = new Set(
      runsForCandidates
        .filter((r) => ["approved", "finalised", "disbursed", "closed"].includes(r.status))
        .map((r) => `${r.year}-${r.month}`),
    );
    arrearPeriod = candidates.find((c) => !locked.has(`${c.year}-${c.month}`)) ?? null;
  }

  /* Arrears travel on a pay type like every other line, so the register
     and the reports can group them instead of meeting an untyped row.
     The system owns this one — nobody picks it from the entry forms — so
     it is created on first use rather than being something to remember
     to configure. */
  let arrearTypeId: string | null = null;
  if (arrearPeriod && arrears.totalPaise !== 0) {
    const [existingType] = await db
      .select({ id: s.variablePayTypes.id })
      .from(s.variablePayTypes)
      .where(
        and(
          eq(s.variablePayTypes.companyId, employee.companyId),
          eq(s.variablePayTypes.code, "ARREAR"),
        ),
      )
      .limit(1);

    if (existingType) {
      arrearTypeId = existingType.id;
    } else {
      arrearTypeId = randomUUID();
      await db.insert(s.variablePayTypes).values({
        id: arrearTypeId,
        companyId: employee.companyId,
        code: "ARREAR",
        label: "Arrears",
        category: "arrear",
        defaultAmountPaise: null,
        active: true,
        systemManaged: true,
        createdAt: now,
      });
    }
  }

  const arrearId = randomUUID();
  const arrearLabel =
    arrears.lines.length > 0
      ? `Arrears ${arrears.lines[0].period}${arrears.lines.length > 1 ? `–${arrears.lines[arrears.lines.length - 1].period}` : ""}`
      : "Arrears";

  await db.transaction(async (tx) => {
    if (current) {
      // Close the old row rather than overwrite it.
      const dayBefore = new Date(Date.parse(effectiveFrom + "T00:00:00Z") - 86_400_000)
        .toISOString()
        .slice(0, 10);
      await tx.update(s.employeeSalaries)
        .set({ effectiveTo: dayBefore })
        .where(eq(s.employeeSalaries.id, current.id))
        .run();
    }

    await tx.insert(s.employeeSalaries)
      .values({
        id: newId,
        employeeId,
        monthlyGrossPaise,
        structureId:
          structureIdRaw === undefined
            ? (current?.structureId ?? null)
            : structureIdRaw === ""
              ? null
              : structureIdRaw,
        // In CTC mode the figure asked for is the figure recorded; otherwise
        // it is the real cost to company — gross plus employer PF, ESIC and
        // gratuity accrual — rather than merely annualised gross.
        annualCtcPaise: mode === "ctc" ? amountPaise : evaluated.annualCtcPaise,
        effectiveFrom,
        effectiveTo: null,
        reason,
        revisionType: revisionType as never,
        arrearsPaise: 0,
        createdBy: user.email,
        createdAt: now,
      })
      .run();

    if (arrearPeriod && arrears.totalPaise !== 0) {
      await tx.insert(s.payrollAdjustments)
        .values({
          id: arrearId,
          employeeId,
          periodYear: arrearPeriod.year,
          periodMonth: arrearPeriod.month,
          // A downward revision produces a negative difference, which is
          // owed back rather than owed out.
          kind: arrears.totalPaise > 0 ? "earning" : "deduction",
          category: "arrear",
          typeId: arrearTypeId,
          code: "ARREAR",
          label: arrearLabel,
          amountPaise: Math.abs(arrears.totalPaise),
          hours: null,
          ratePaisePerHour: null,
          reason: `Salary revised to ₹${(monthlyGrossPaise / 100).toLocaleString("en-IN")} from ${effectiveFrom}; ${arrears.lines.length} month(s) already run at the old rate`,
          createdBy: user.email,
          createdAt: now,
        })
        .run();
    }
  });

  await recordAudit({
    user,
    action: "salary.revised",
    entity: "employee_salary",
    entityId: employeeId,
    before: current ? { monthlyGrossPaise: current.monthlyGrossPaise } : null,
    after: { monthlyGrossPaise, effectiveFrom, revisionType },
    reason,
  });

  revalidatePath(`/console/employees/${employeeId}`);

  const change = current
    ? monthlyGrossPaise - current.monthlyGrossPaise
    : monthlyGrossPaise;
  const pct =
    current && current.monthlyGrossPaise > 0
      ? ((change / current.monthlyGrossPaise) * 100).toFixed(1)
      : null;

  return {
    ok: [
      `Revised to ₹${(monthlyGrossPaise / 100).toLocaleString("en-IN")} a month from ${effectiveFrom}`,
      pct ? `(${change >= 0 ? "+" : ""}${pct}%)` : "",
      `· ${derivation}.`,
      arrears.totalPaise !== 0 && arrearPeriod
        ? `₹${(Math.abs(arrears.totalPaise) / 100).toFixed(2)} of arrears ${arrears.totalPaise > 0 ? "is due" : "is recoverable"} for ${arrears.lines.length} month(s) already run — booked into ${arrearPeriod.year}-${String(arrearPeriod.month).padStart(2, "0")} payroll.`
        : arrears.totalPaise !== 0
          ? `₹${(Math.abs(arrears.totalPaise) / 100).toFixed(2)} of arrears could not be booked: every candidate period is already approved. Reopen one, or add it as variable pay.`
          : "",
    ]
      .filter(Boolean)
      .join(" "),
    ctc: evaluated,
    structureId: resolution.structureId,
  };
}

/**
 * Per-employee payroll overrides. Company settings are the default;
 * these are the exceptions, and each is stored with the reason it exists.
 */
export async function setPayrollOverrides(
  _prev: SalaryState,
  fd: FormData,
): Promise<SalaryState> {
  const user = await getSessionUser();
  if (!user || !canMutate(user)) {
    return { error: "Only payroll may change these." };
  }

  const employeeId = String(fd.get("employeeId") ?? "");
  const [employee] = await db
    .select()
    .from(s.employees)
    .where(eq(s.employees.id, employeeId))
    .limit(1);
  if (!employee) return { error: "Employee not found." };
  if (!canAccessCompany(user, employee.companyId)) {
    return { error: "Not authorised." };
  }

  const pfOptedIn = fd.get("pfOptedIn") === "on";
  const vpfPercentRaw = Number(fd.get("vpfPercent") ?? 0);
  const taxRegime = String(fd.get("taxRegime") ?? "");

  if (!Number.isFinite(vpfPercentRaw) || vpfPercentRaw < 0 || vpfPercentRaw > 88) {
    return {
      error:
        "Voluntary PF is a percentage of PF wages between 0 and 88 — the statutory maximum alongside the mandatory 12%.",
    };
  }
  if (taxRegime !== "old" && taxRegime !== "new") {
    return { error: "Choose a tax regime." };
  }

  // The excluded-employee rule: someone with no prior membership above
  // the ceiling may opt out, but nobody else may.
  if (!pfOptedIn && employee.hadPriorPfMembership) {
    return {
      error:
        "This employee has prior PF membership, so provident fund is compulsory and cannot be opted out of.",
    };
  }

  const before = {
    pfOptedIn: employee.pfOptedIn,
    vpfPercent: employee.vpfPercent,
    taxRegime: employee.taxRegime,
  };

  await db
    .update(s.employees)
    .set({ pfOptedIn, vpfPercent: vpfPercentRaw, taxRegime })
    .where(eq(s.employees.id, employeeId));

  await recordAudit({
    user,
    action: "employee.payroll_settings_changed",
    entity: "employee",
    entityId: employeeId,
    before,
    after: { pfOptedIn, vpfPercent: vpfPercentRaw, taxRegime },
  });

  revalidatePath(`/console/employees/${employeeId}`);
  return { ok: "Saved. The next payroll run picks these up." };
}
