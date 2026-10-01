import "server-only";
import { and, desc, eq, gte, inArray, lte, notInArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { currentPeriod, today } from "@/lib/clock";

export type AttentionItem = {
  label: string;
  value: string;
  href: string;
  tone: "warning" | "info" | "success";
};

const RUN_LABEL: Record<string, string> = {
  draft: "Draft",
  inputs_locked: "Inputs locked",
  calculated: "Calculated",
  in_review: "In review",
  approved: "Approved",
  finalised: "Finalised",
  disbursed: "Paid",
  closed: "Closed",
};

/**
 * What the sidebar shows under the navigation: the handful of things
 * waiting on someone in this company right now, each one a link to where
 * it is dealt with. Empty sections are left out — a list of zeros is
 * noise, not reassurance.
 */
export async function loadAttention(companyId: string | null): Promise<AttentionItem[]> {
  if (!companyId) return [];
  const period = currentPeriod();
  const day = today();
  const items: AttentionItem[] = [];

  const employees = await db
    .select({ id: s.employees.id, dateOfExit: s.employees.dateOfExit })
    .from(s.employees)
    .where(eq(s.employees.companyId, companyId));
  const ids = employees.map((e) => e.id);
  const active = employees.filter((e) => !e.dateOfExit || e.dateOfExit >= day).length;

  const [run] = await db
    .select({ status: s.payrollRuns.status })
    .from(s.payrollRuns)
    .where(
      and(
        eq(s.payrollRuns.companyId, companyId),
        eq(s.payrollRuns.periodYear, period.year),
        eq(s.payrollRuns.periodMonth, period.month),
      ),
    )
    .orderBy(desc(s.payrollRuns.version))
    .limit(1);
  const paid = run && ["disbursed", "closed"].includes(run.status);
  items.push({
    label: `Payroll · ${period.label.slice(0, 3)}`,
    value: run ? RUN_LABEL[run.status] ?? run.status : "Not started",
    href: `/console/payroll?company=${companyId}&year=${period.year}&month=${period.month}`,
    tone: paid ? "success" : "info",
  });

  if (ids.length === 0) return items;

  items.push({ label: "Active employees", value: String(active), href: "/console/employees", tone: "info" });

  const [onLeave, leave, corrections, exits, joiners] = await Promise.all([
    db
      .select({ employeeId: s.leaveRequests.employeeId })
      .from(s.leaveRequests)
      .where(
        and(
          inArray(s.leaveRequests.employeeId, ids),
          eq(s.leaveRequests.status, "approved"),
          lte(s.leaveRequests.fromDate, day),
          gte(s.leaveRequests.toDate, day),
        ),
      ),
    db
      .select({ id: s.leaveRequests.id })
      .from(s.leaveRequests)
      .where(and(inArray(s.leaveRequests.employeeId, ids), eq(s.leaveRequests.status, "pending"))),
    db
      .select({ id: s.regularisationRequests.id })
      .from(s.regularisationRequests)
      .where(
        and(
          inArray(s.regularisationRequests.employeeId, ids),
          eq(s.regularisationRequests.status, "pending"),
        ),
      ),
    db
      .select({ id: s.exitCases.id })
      .from(s.exitCases)
      .where(
        and(
          inArray(s.exitCases.employeeId, ids),
          notInArray(s.exitCases.status, ["settled", "withdrawn"]),
        ),
      ),
    db
      .select({ id: s.joiners.id })
      .from(s.joiners)
      .where(and(eq(s.joiners.companyId, companyId), notInArray(s.joiners.status, ["joined", "dropped"]))),
  ]);

  const onLeaveToday = new Set(onLeave.map((l) => l.employeeId)).size;
  if (onLeaveToday > 0) {
    items.push({
      label: "On leave today",
      value: String(onLeaveToday),
      href: `/console/attendance?company=${companyId}&tab=calendar`,
      tone: "info",
    });
  }
  const approvals = leave.length + corrections.length;
  if (approvals > 0) {
    items.push({
      label: "Approvals waiting",
      value: String(approvals),
      href: `/console/attendance?company=${companyId}&tab=approvals`,
      tone: "warning",
    });
  }
  if (joiners.length > 0) {
    items.push({ label: "Joiners in progress", value: String(joiners.length), href: "/console/onboarding", tone: "info" });
  }
  if (exits.length > 0) {
    items.push({ label: "Exits open", value: String(exits.length), href: "/console/exits", tone: "info" });
  }
  return items;
}
