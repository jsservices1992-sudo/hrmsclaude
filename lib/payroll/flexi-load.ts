import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  validateDeclaration,
  settleYearEnd,
  compareRegimes,
  type FlexiPlan,
  type FlexiHead,
  type Allocation,
  type TaxRegime,
} from "./flexi";

function toHead(h: typeof s.flexiHeads.$inferSelect): FlexiHead {
  return {
    code: h.code,
    label: h.label,
    exemptionBasis: h.exemptionBasis,
    annualCapPaise: h.annualCapPaise,
    statutoryAnnualCapPaise: h.statutoryAnnualCapPaise,
    minAnnualPaise: h.minAnnualPaise,
    availableInNewRegime: h.availableInNewRegime,
    requiresProof: h.requiresProof,
    sequence: h.sequence,
  };
}

export async function loadPlan(companyId: string, financialYear = 2026) {
  const [plan] = await db
    .select()
    .from(s.flexiPlans)
    .where(
      and(
        eq(s.flexiPlans.companyId, companyId),
        eq(s.flexiPlans.financialYear, financialYear),
        eq(s.flexiPlans.active, true),
      ),
    )
    .limit(1);
  if (!plan) return null;

  const heads = await db
    .select()
    .from(s.flexiHeads)
    .where(eq(s.flexiHeads.planId, plan.id))
    .orderBy(asc(s.flexiHeads.sequence));

  const spec: FlexiPlan = {
    code: plan.code,
    name: plan.name,
    totalAllocablePaise: plan.totalAllocablePaise,
    heads: heads.map(toHead),
  };

  return { row: plan, heads, spec };
}

export type EmployeeFlexi = {
  employeeId: string;
  name: string;
  empCode: string;
  regime: TaxRegime;
  allocations: Allocation[];
  declaredPaise: number;
  approvedPaise: number;
  /** What the year would settle at if nothing more were claimed. */
  exemptPaise: number;
  taxablePaise: number;
  losesUnderNewRegime: boolean;
};

/** Everyone in the company who has declared, with their settlement position. */
export async function loadCompanyFlexi(companyId: string, financialYear = 2026) {
  const plan = await loadPlan(companyId, financialYear);
  if (!plan) return { plan: null, employees: [] as EmployeeFlexi[] };

  const headById = new Map(plan.heads.map((h) => [h.id, h]));

  const decls = await db
    .select({ d: s.flexiDeclarations, emp: s.employees })
    .from(s.flexiDeclarations)
    .innerJoin(s.employees, eq(s.flexiDeclarations.employeeId, s.employees.id))
    .where(eq(s.flexiDeclarations.planId, plan.row.id));

  const claims = await db
    .select()
    .from(s.flexiClaims)
    .where(eq(s.flexiClaims.planId, plan.row.id));

  const byEmployee = new Map<string, typeof decls>();
  for (const d of decls) {
    const list = byEmployee.get(d.emp.id) ?? [];
    list.push(d);
    byEmployee.set(d.emp.id, list);
  }

  const employees: EmployeeFlexi[] = [];

  for (const [employeeId, rows] of byEmployee) {
    const emp = rows[0].emp;
    const regime = emp.taxRegime as TaxRegime;

    const allocations: Allocation[] = rows.map((r) => ({
      headCode: headById.get(r.d.headId)?.code ?? "",
      annualPaise: r.d.annualPaise,
    }));

    const approvedByHead = new Map<string, number>();
    for (const c of claims.filter(
      (c) => c.employeeId === employeeId && c.status !== "rejected",
    )) {
      const code = headById.get(c.headId)?.code ?? "";
      approvedByHead.set(code, (approvedByHead.get(code) ?? 0) + c.approvedPaise);
    }

    const settlement = settleYearEnd({
      plan: plan.spec,
      declarations: allocations,
      approved: [...approvedByHead].map(([headCode, paise]) => ({ headCode, paise })),
      regime,
    });

    const comparison = compareRegimes({ plan: plan.spec, allocations });

    employees.push({
      employeeId,
      name: `${emp.firstName} ${emp.lastName}`,
      empCode: emp.empCode,
      regime,
      allocations,
      declaredPaise: allocations.reduce((a, x) => a + x.annualPaise, 0),
      approvedPaise: [...approvedByHead.values()].reduce((a, x) => a + x, 0),
      exemptPaise: settlement.totalExemptPaise,
      taxablePaise: settlement.totalTaxablePaise,
      losesUnderNewRegime: regime === "new" && comparison.differencePaise > 0,
    });
  }

  employees.sort((a, b) => b.declaredPaise - a.declaredPaise);
  return { plan, employees };
}

/** One employee's declaration, validated against the live plan. */
export async function loadEmployeeFlexi(employeeId: string, financialYear = 2026) {
  const [emp] = await db
    .select()
    .from(s.employees)
    .where(eq(s.employees.id, employeeId))
    .limit(1);
  if (!emp) return null;

  const plan = await loadPlan(emp.companyId, financialYear);
  if (!plan) return null;

  const headById = new Map(plan.heads.map((h) => [h.id, h]));

  const decls = await db
    .select()
    .from(s.flexiDeclarations)
    .where(
      and(
        eq(s.flexiDeclarations.employeeId, employeeId),
        eq(s.flexiDeclarations.planId, plan.row.id),
      ),
    );

  const claims = await db
    .select()
    .from(s.flexiClaims)
    .where(
      and(
        eq(s.flexiClaims.employeeId, employeeId),
        eq(s.flexiClaims.planId, plan.row.id),
      ),
    )
    .orderBy(asc(s.flexiClaims.createdAt));

  const allocations: Allocation[] = decls.map((d) => ({
    headCode: headById.get(d.headId)?.code ?? "",
    annualPaise: d.annualPaise,
  }));

  const regime = emp.taxRegime as TaxRegime;
  const validation = validateDeclaration({
    plan: plan.spec,
    allocations,
    regime,
  });

  const approvedByHead = new Map<string, number>();
  for (const c of claims.filter((c) => c.status !== "rejected")) {
    const code = headById.get(c.headId)?.code ?? "";
    approvedByHead.set(code, (approvedByHead.get(code) ?? 0) + c.approvedPaise);
  }

  const settlement = settleYearEnd({
    plan: plan.spec,
    declarations: allocations,
    approved: [...approvedByHead].map(([headCode, paise]) => ({ headCode, paise })),
    regime,
  });

  return {
    employee: emp,
    plan,
    regime,
    allocations,
    validation,
    settlement,
    comparison: compareRegimes({ plan: plan.spec, allocations }),
    claims: claims.map((c) => ({
      row: c,
      headCode: headById.get(c.headId)?.code ?? "",
      headLabel: headById.get(c.headId)?.label ?? "",
    })),
    approvedByHead,
  };
}

export async function listPendingClaims(companyIds: string[]) {
  if (companyIds.length === 0) return [];
  return db
    .select({ claim: s.flexiClaims, emp: s.employees, head: s.flexiHeads })
    .from(s.flexiClaims)
    .innerJoin(s.employees, eq(s.flexiClaims.employeeId, s.employees.id))
    .innerJoin(s.flexiHeads, eq(s.flexiClaims.headId, s.flexiHeads.id))
    .where(
      and(
        inArray(s.employees.companyId, companyIds),
        eq(s.flexiClaims.status, "pending"),
      ),
    );
}
