import { and, eq, inArray, like, or } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { scopeCompanies, canSeeCompensation, type SessionUser } from "@/lib/auth/session";
import { listCompanies } from "@/lib/payroll/load";

export type SearchResultType =
  | "employee"
  | "asset"
  | "run"
  | "workflow"
  | "onboarding"
  | "exit"
  | "loan";

export type SearchResult = {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

const RESULTS_PER_TYPE = 5;

export async function globalSearch(user: SessionUser, rawQuery: string): Promise<SearchResult[]> {
  const q = rawQuery.trim();
  if (q.length < 2) return [];

  const companies = scopeCompanies(user, await listCompanies());
  const companyIds = companies.map((c) => c.id);
  if (!companyIds.length) return [];

  const like_ = `%${q}%`;
  const canComp = canSeeCompensation(user);

  const [employees, assets, joiners, exits, workflows, runs, loans] = await Promise.all([
    db
      .select({ id: s.employees.id, firstName: s.employees.firstName, lastName: s.employees.lastName, empCode: s.employees.empCode })
      .from(s.employees)
      .where(
        and(
          inArray(s.employees.companyId, companyIds),
          or(
            like(s.employees.firstName, like_),
            like(s.employees.lastName, like_),
            like(s.employees.empCode, like_),
          ),
        ),
      )
      .limit(RESULTS_PER_TYPE),

    db
      .select({ id: s.assets.id, assetTag: s.assets.assetTag, make: s.assets.make, model: s.assets.model, status: s.assets.status })
      .from(s.assets)
      .where(
        and(
          inArray(s.assets.companyId, companyIds),
          or(like(s.assets.assetTag, like_), like(s.assets.make, like_), like(s.assets.model, like_)),
        ),
      )
      .limit(RESULTS_PER_TYPE),

    db
      .select({ id: s.joiners.id, firstName: s.joiners.firstName, lastName: s.joiners.lastName, designation: s.joiners.designation })
      .from(s.joiners)
      .where(
        and(
          inArray(s.joiners.companyId, companyIds),
          or(like(s.joiners.firstName, like_), like(s.joiners.lastName, like_)),
        ),
      )
      .limit(RESULTS_PER_TYPE),

    db
      .select({
        id: s.exitCases.id,
        employeeId: s.exitCases.employeeId,
        status: s.exitCases.status,
        firstName: s.employees.firstName,
        lastName: s.employees.lastName,
      })
      .from(s.exitCases)
      .innerJoin(s.employees, eq(s.exitCases.employeeId, s.employees.id))
      .where(
        and(
          inArray(s.employees.companyId, companyIds),
          or(like(s.employees.firstName, like_), like(s.employees.lastName, like_)),
        ),
      )
      .limit(RESULTS_PER_TYPE),

    db
      .select({ id: s.workflowInstances.id, sourceEntity: s.workflowInstances.sourceEntity, status: s.workflowInstances.status })
      .from(s.workflowInstances)
      .where(and(inArray(s.workflowInstances.companyId, companyIds), like(s.workflowInstances.sourceEntity, like_)))
      .limit(RESULTS_PER_TYPE),

    canComp && /\d/.test(q)
      ? db
          .select({ id: s.payrollRuns.id, periodYear: s.payrollRuns.periodYear, periodMonth: s.payrollRuns.periodMonth, status: s.payrollRuns.status, companyId: s.payrollRuns.companyId })
          .from(s.payrollRuns)
          .where(inArray(s.payrollRuns.companyId, companyIds))
          .limit(RESULTS_PER_TYPE)
      : Promise.resolve([]),

    canComp
      ? db
          .select({
            id: s.loans.id,
            scheme: s.loans.scheme,
            status: s.loans.status,
            firstName: s.employees.firstName,
            lastName: s.employees.lastName,
          })
          .from(s.loans)
          .innerJoin(s.employees, eq(s.loans.employeeId, s.employees.id))
          .where(
            and(
              inArray(s.employees.companyId, companyIds),
              or(like(s.loans.scheme, like_), like(s.employees.firstName, like_), like(s.employees.lastName, like_)),
            ),
          )
          .limit(RESULTS_PER_TYPE)
      : Promise.resolve([]),
  ]);

  const results: SearchResult[] = [
    ...employees.map((e) => ({
      type: "employee" as const,
      id: e.id,
      title: `${e.firstName} ${e.lastName}`,
      subtitle: e.empCode,
      href: `/console/employees/${e.id}`,
    })),
    ...assets.map((a) => ({
      type: "asset" as const,
      id: a.id,
      title: a.assetTag,
      subtitle: [a.make, a.model].filter(Boolean).join(" ") || a.status.replace(/_/g, " "),
      href: `/console/assets/${a.id}`,
    })),
    ...joiners.map((j) => ({
      type: "onboarding" as const,
      id: j.id,
      title: `${j.firstName} ${j.lastName}`,
      subtitle: j.designation ?? "Onboarding",
      href: `/console/onboarding/${j.id}`,
    })),
    ...exits.map((x) => ({
      type: "exit" as const,
      id: x.id,
      title: `${x.firstName} ${x.lastName}`,
      subtitle: `Exit · ${x.status.replace(/_/g, " ")}`,
      href: `/console/exits/${x.id}`,
    })),
    ...workflows.map((w) => ({
      type: "workflow" as const,
      id: w.id,
      title: w.sourceEntity.replace(/_/g, " "),
      subtitle: `Workflow · ${w.status}`,
      href: `/console/workflows/${w.id}`,
    })),
    ...runs
      .filter((r) => `${r.periodMonth}/${r.periodYear}`.includes(q) || String(r.periodYear).includes(q))
      .map((r) => ({
        type: "run" as const,
        id: r.id,
        title: `${r.periodMonth}/${r.periodYear} run`,
        subtitle: r.status.replace(/_/g, " "),
        href: `/console/runs`,
      })),
    ...loans.map((l) => ({
      type: "loan" as const,
      id: l.id,
      title: `${l.firstName} ${l.lastName} — ${l.scheme}`,
      subtitle: l.status.replace(/_/g, " "),
      href: `/console/loans/${l.id}`,
    })),
  ];

  return results;
}
