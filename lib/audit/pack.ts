import "server-only";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { loadRegister } from "../statutory/load";
import { buildSummaries } from "../statutory/load";
import { diffRuns, computeVariance, type RunSide } from "./diff";
import { TAX_CONFIG_VERSION, TAX_CONFIG_VERIFIED } from "../tax/config";
import { ECR_VERSION } from "../statutory/ecr";

/**
 * The audit pack — PRD §3.15, FR-AUD-7.
 *
 * Statutory audit, internal audit and due diligence all ask for the same
 * set, and assembling it by hand is a week of work. The pack answers the
 * section's control objective for every rupee in a period: what it was,
 * how it was computed, who authorised it, and what it was before.
 */

/** Every version of a period, shaped for comparison. */
export async function loadRunSides(
  companyId: string,
  year: number,
  month: number,
): Promise<RunSide[]> {
  const runs = await db
    .select()
    .from(s.payrollRuns)
    .where(
      and(
        eq(s.payrollRuns.companyId, companyId),
        eq(s.payrollRuns.periodYear, year),
        eq(s.payrollRuns.periodMonth, month),
      ),
    )
    .orderBy(asc(s.payrollRuns.version));

  const sides: RunSide[] = [];

  for (const run of runs) {
    const summaries = await db
      .select({ summary: s.payrollEmployeeSummaries, emp: s.employees })
      .from(s.payrollEmployeeSummaries)
      .innerJoin(
        s.employees,
        eq(s.payrollEmployeeSummaries.employeeId, s.employees.id),
      )
      .where(eq(s.payrollEmployeeSummaries.runId, run.id));

    const lines = await db
      .select()
      .from(s.payrollLines)
      .where(eq(s.payrollLines.runId, run.id));

    const linesByEmployee = new Map<
      string,
      { code: string; label: string; amountPaise: number }[]
    >();
    for (const l of lines) {
      const list = linesByEmployee.get(l.employeeId) ?? [];
      list.push({ code: l.code, label: l.label, amountPaise: l.amountPaise });
      linesByEmployee.set(l.employeeId, list);
    }

    sides.push({
      version: run.version,
      status: run.status,
      calculatedAt: run.calculatedAt ?? run.createdAt,
      preparedBy: run.preparedBy ?? "unknown",
      employees: summaries.map(({ summary, emp }) => ({
        employeeId: emp.id,
        empCode: emp.empCode,
        name: `${emp.firstName} ${emp.lastName}`,
        grossPaise: summary.grossPaise,
        deductionsPaise: summary.deductionsPaise,
        netPaise: summary.netPaise,
        paidDays: summary.paidDays,
        lopDays: summary.lopDays,
        lines: linesByEmployee.get(emp.id) ?? [],
      })),
    });
  }

  return sides;
}

/** The prior calendar month, for the variance report. */
export function priorPeriod(year: number, month: number) {
  return month === 1
    ? { year: year - 1, month: 12 }
    : { year, month: month - 1 };
}

export type AuditPack = {
  company: typeof s.companies.$inferSelect;
  period: { year: number; month: number };
  run: typeof s.payrollRuns.$inferSelect | null;
  versions: RunSide[];
  diff: ReturnType<typeof diffRuns> | null;
  variance: ReturnType<typeof computeVariance> | null;
  summaries: Awaited<ReturnType<typeof buildSummaries>> | null;
  approvals: (typeof s.auditLog.$inferSelect)[];
  exceptions: (typeof s.auditLog.$inferSelect)[];
  filings: (typeof s.statutoryFilings.$inferSelect)[];
  configVersions: { name: string; version: string; verified: boolean }[];
  accessSummary: { actor: string; reads: number; rowsRead: number }[];
  alerts: (typeof s.controlAlerts.$inferSelect)[];
  holds: (typeof s.legalHolds.$inferSelect)[];
  completeness: { item: string; present: boolean; note: string }[];
};

export async function buildAuditPack(args: {
  companyId: string;
  year: number;
  month: number;
}): Promise<AuditPack | null> {
  const [company] = await db
    .select()
    .from(s.companies)
    .where(eq(s.companies.id, args.companyId))
    .limit(1);
  if (!company) return null;

  const versions = await loadRunSides(args.companyId, args.year, args.month);
  const register = await loadRegister(args.companyId, args.year, args.month);

  const [run] = await db
    .select()
    .from(s.payrollRuns)
    .where(
      and(
        eq(s.payrollRuns.companyId, args.companyId),
        eq(s.payrollRuns.periodYear, args.year),
        eq(s.payrollRuns.periodMonth, args.month),
      ),
    )
    .orderBy(desc(s.payrollRuns.version))
    .limit(1);

  // Compare the two most recent versions, which is the question anyone
  // reviewing a reopened period actually asks.
  const diff =
    versions.length >= 2
      ? diffRuns(versions[versions.length - 2], versions[versions.length - 1])
      : null;

  const prior = priorPeriod(args.year, args.month);
  const priorVersions = await loadRunSides(args.companyId, prior.year, prior.month);
  const current = versions[versions.length - 1] ?? null;

  const variance = current
    ? computeVariance({
        prior: priorVersions[priorVersions.length - 1] ?? null,
        current,
        thresholdBps: 1500,
        absoluteThresholdPaise: 1_000_000,
      })
    : null;

  const summaries = register ? await buildSummaries(register, args.month, args.year) : null;

  // The approval trail and every exception, from the log itself.
  const periodStart = `${args.year}-${String(args.month).padStart(2, "0")}-01`;
  const packWindowStart = `${prior.year}-${String(prior.month).padStart(2, "0")}-01`;
  const periodEnd = new Date(Date.UTC(args.year, args.month + 1, 0))
    .toISOString()
    .slice(0, 10);

  const logRows = await db
    .select()
    .from(s.auditLog)
    .where(and(gte(s.auditLog.at, packWindowStart), lte(s.auditLog.at, periodEnd + "T23:59:59.999Z")))
    .orderBy(desc(s.auditLog.at))
    .limit(500);

  const approvals = logRows.filter(
    (r) =>
      r.action.startsWith("run.") ||
      r.action.startsWith("bank_file.") ||
      r.action.startsWith("statutory_filing."),
  );

  // An exception is anything blocked, overridden, waived or written off —
  // the list an auditor asks for by name.
  const exceptions = logRows.filter((r) =>
    /denied|waiv|override|written_off|write_off|reopened|superseded|forfeit/i.test(
      r.action,
    ),
  );

  const filings = await db
    .select()
    .from(s.statutoryFilings)
    .where(
      and(
        eq(s.statutoryFilings.companyId, args.companyId),
        eq(s.statutoryFilings.periodYear, args.year),
        eq(s.statutoryFilings.periodMonth, args.month),
      ),
    );

  const accessRows = await db
    .select()
    .from(s.accessLog)
    .where(and(gte(s.accessLog.at, periodStart), lte(s.accessLog.at, periodEnd + "T23:59:59.999Z")))
    .limit(2000);

  const byActor = new Map<string, { reads: number; rows: number }>();
  for (const a of accessRows) {
    const existing = byActor.get(a.actor) ?? { reads: 0, rows: 0 };
    existing.reads += 1;
    existing.rows += a.rowCount;
    byActor.set(a.actor, existing);
  }

  const accessSummary = [...byActor.entries()]
    .map(([actor, v]) => ({ actor, reads: v.reads, rowsRead: v.rows }))
    .sort((a, b) => b.rowsRead - a.rowsRead);

  const alerts = await db
    .select()
    .from(s.controlAlerts)
    .where(eq(s.controlAlerts.companyId, args.companyId))
    .orderBy(desc(s.controlAlerts.raisedAt))
    .limit(100);

  const holds = await db
    .select()
    .from(s.legalHolds)
    .where(eq(s.legalHolds.companyId, args.companyId));

  const configVersions = [
    {
      name: "Income tax configuration",
      version: TAX_CONFIG_VERSION,
      verified: TAX_CONFIG_VERIFIED,
    },
    { name: "EPF ECR layout", version: ECR_VERSION, verified: false },
    {
      name: "Statutory configuration as at",
      version: run?.configSnapshot ?? "not recorded",
      verified: false,
    },
  ];

  // What the pack is missing is as much a finding as what it contains.
  const completeness = [
    {
      item: "Payroll register",
      present: Boolean(register),
      note: register
        ? `Version ${register.run.version}, ${register.run.status.replace(/_/g, " ")}`
        : "No run exists for this period",
    },
    {
      item: "Approval trail",
      present: approvals.some((a) => a.action === "run.approved"),
      note: approvals.some((a) => a.action === "run.approved")
        ? "The run was approved by a second person"
        : "No approval is recorded for this period",
    },
    {
      item: "Statutory summaries",
      present: Boolean(summaries),
      note: summaries ? "PF, ESIC, TDS, PT and LWF" : "Not available without a run",
    },
    {
      item: "Remittance references",
      present: filings.some((f) => f.status === "filed" && f.filingReference),
      note:
        filings.filter((f) => f.status === "filed").length > 0
          ? `${filings.filter((f) => f.status === "filed").length} filing(s) with an acknowledgement`
          : "No filing has been recorded as lodged",
    },
    {
      item: "Variance report",
      present: Boolean(variance && variance.warnings.length === 0),
      note: variance
        ? variance.warnings[0] ?? `${variance.flagged.length} employee(s) flagged`
        : "Not available without a run",
    },
    {
      item: "Configuration versions",
      present: configVersions.every((c) => c.verified),
      note: configVersions.some((c) => !c.verified)
        ? "One or more configuration sets are unverified against their source"
        : "All configuration sets are verified",
    },
    {
      item: "Compensation access log",
      present: accessRows.length > 0,
      note:
        accessRows.length > 0
          ? `${accessRows.length} read(s) by ${byActor.size} user(s)`
          : "No compensation reads recorded for this period",
    },
  ];

  return {
    company,
    period: { year: args.year, month: args.month },
    run: run ?? null,
    versions,
    diff,
    variance,
    summaries,
    approvals,
    exceptions,
    filings,
    configVersions,
    accessSummary,
    alerts,
    holds,
    completeness,
  };
}

/* ==================================================================
   Rendering
   ================================================================== */

function csvField(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

const rupees = (paise: number) => (paise / 100).toFixed(2);

/**
 * The pack as one CSV with titled sections. A single file is what gets
 * emailed to an auditor; a zip of seven is what gets half-opened.
 */
export function renderAuditPack(pack: AuditPack): string {
  const out: string[] = [];
  const section = (title: string) => {
    out.push("");
    out.push(`# ${title}`);
  };
  const row = (...cells: (string | number | null | undefined)[]) =>
    out.push(cells.map(csvField).join(","));

  out.push(`# AUDIT PACK — ${pack.company.name}`);
  row("Period", `${pack.period.year}-${String(pack.period.month).padStart(2, "0")}`);
  row("Generated", new Date().toISOString());
  row("Run version", pack.run?.version ?? "none");
  row("Run status", pack.run?.status ?? "none");
  row("Prepared by", pack.run?.preparedBy ?? "");
  row("Approved by", pack.run?.approvedBy ?? "not approved");

  section("COMPLETENESS");
  row("Item", "Present", "Note");
  for (const c of pack.completeness) {
    row(c.item, c.present ? "yes" : "NO", c.note);
  }

  section("CONFIGURATION VERSIONS IN FORCE");
  row("Configuration", "Version", "Verified");
  for (const c of pack.configVersions) {
    row(c.name, c.version, c.verified ? "yes" : "NO");
  }

  section("PAYROLL REGISTER");
  const current = pack.versions[pack.versions.length - 1];
  if (current) {
    row("Employee code", "Name", "Paid days", "LOP days", "Gross", "Deductions", "Net");
    for (const e of current.employees) {
      row(
        e.empCode,
        e.name,
        e.paidDays,
        e.lopDays,
        rupees(e.grossPaise),
        rupees(e.deductionsPaise),
        rupees(e.netPaise),
      );
    }
    row(
      "TOTAL",
      "",
      "",
      "",
      rupees(current.employees.reduce((a, e) => a + e.grossPaise, 0)),
      rupees(current.employees.reduce((a, e) => a + e.deductionsPaise, 0)),
      rupees(current.employees.reduce((a, e) => a + e.netPaise, 0)),
    );
  } else {
    row("No run exists for this period");
  }

  section("STATUTORY SUMMARY");
  if (pack.summaries) {
    row("Head", "Count", "Employee", "Employer", "Total");
    row(
      "Provident fund",
      pack.summaries.pf.memberCount,
      rupees(pack.summaries.pf.employeeSharePaise),
      rupees(pack.summaries.pf.employerTotalPaise),
      rupees(pack.summaries.pf.totalPaise),
    );
    if (pack.summaries.pf.chargesPaise > 0) {
      row("PF — EDLI & admin charges (employer)", "", "", rupees(pack.summaries.pf.chargesPaise), rupees(pack.summaries.pf.chargesPaise));
    }
    row(
      "ESIC",
      pack.summaries.esic.coveredCount,
      rupees(pack.summaries.esic.employeeSharePaise),
      rupees(pack.summaries.esic.employerSharePaise),
      rupees(pack.summaries.esic.totalPaise),
    );
    row("TDS", pack.summaries.tds.deducteeCount, rupees(pack.summaries.tds.totalTdsPaise), "", rupees(pack.summaries.tds.totalTdsPaise));
    row("Professional tax", pack.summaries.pt.employeeCount, rupees(pack.summaries.pt.totalPaise), "", rupees(pack.summaries.pt.totalPaise));
    row(
      "Labour welfare fund",
      "",
      rupees(pack.summaries.lwf.employeeSharePaise),
      rupees(pack.summaries.lwf.employerSharePaise),
      rupees(pack.summaries.lwf.totalPaise),
    );
  } else {
    row("Not available without a run");
  }

  section("REMITTANCE REFERENCES");
  row("Filing", "State", "Status", "Reference", "Filed on", "Owner");
  if (pack.filings.length === 0) row("No filings recorded for this period");
  for (const f of pack.filings) {
    row(f.kind, f.stateCode ?? "", f.status, f.filingReference ?? "", f.filedAt ?? "", f.owner ?? "");
  }

  section("APPROVAL TRAIL");
  row("When", "Actor", "Role", "Source", "Action", "Reason");
  for (const a of pack.approvals) {
    row(a.at, a.actor, a.actorRole ?? "", a.source, a.action, a.reason ?? "");
  }

  section("EXCEPTIONS & OVERRIDES");
  row("When", "Actor", "Role", "Action", "Entity", "Reason");
  if (pack.exceptions.length === 0) row("No exceptions recorded");
  for (const e of pack.exceptions) {
    row(e.at, e.actor, e.actorRole ?? "", e.action, `${e.entity}:${e.entityId ?? ""}`, e.reason ?? "");
  }

  section("VARIANCE AGAINST THE PRIOR PERIOD");
  if (pack.variance) {
    row("Employee code", "Name", "Prior net", "Current net", "Delta", "Change %", "Flagged", "Reason");
    for (const v of pack.variance.rows) {
      row(
        v.empCode,
        v.name,
        rupees(v.priorNetPaise),
        rupees(v.currentNetPaise),
        rupees(v.deltaPaise),
        (v.deltaBps / 100).toFixed(2),
        v.flagged ? "yes" : "",
        v.reason,
      );
    }
  } else {
    row("Not available without a run");
  }

  section("VERSION COMPARISON");
  if (pack.diff) {
    row(`Version ${pack.diff.from.version} to version ${pack.diff.to.version}`);
    row("Net change", rupees(pack.diff.totals.netDeltaPaise));
    row("Employees changed", pack.diff.changed.length);
    row("Employees added", pack.diff.added.length);
    row("Employees removed", pack.diff.removed.length);
    row("");
    row("Component", "Delta", "Employees affected");
    for (const c of pack.diff.componentImpact) {
      row(c.label, rupees(c.deltaPaise), c.employeeCount);
    }
  } else {
    row("Only one version exists; there is nothing to compare");
  }

  section("COMPENSATION ACCESS");
  row("Actor", "Reads", "Rows read");
  if (pack.accessSummary.length === 0) row("No compensation reads recorded");
  for (const a of pack.accessSummary) {
    row(a.actor, a.reads, a.rowsRead);
  }

  section("CONTROL ALERTS");
  row("Raised", "Severity", "Kind", "Actor", "Acknowledged by", "Title");
  if (pack.alerts.length === 0) row("No alerts raised");
  for (const a of pack.alerts) {
    row(a.raisedAt, a.severity, a.kind, a.actor, a.acknowledgedBy ?? "OUTSTANDING", a.title);
  }

  section("LEGAL HOLDS");
  row("Placed", "Employee", "Period", "Reason", "Placed by", "Released");
  if (pack.holds.length === 0) row("No legal holds in force");
  for (const h of pack.holds) {
    row(h.placedAt, h.employeeId ?? "all", h.periodYear ?? "all", h.reason, h.placedBy, h.releasedAt ?? "in force");
  }

  return out.join("\n") + "\n";
}
