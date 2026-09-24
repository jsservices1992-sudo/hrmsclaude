import { redirect } from "next/navigation";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, isTenantWide, canMutate } from "@/lib/auth/session";
import { listCompanies } from "@/lib/payroll/load";
import {
  loadAlerts,
  refreshAlerts,
  loadAccessLog,
  loadLegalHolds,
  loadSodPolicies,
} from "@/lib/audit/log";
import { RETENTION_RULES, DEFAULT_SOD } from "@/lib/audit/controls";
import { loadRunSides } from "@/lib/audit/pack";
import { diffRuns } from "@/lib/audit/diff";
import { formatINR } from "@/lib/payroll/money";
import {
  AcknowledgeForm,
  SodToggle,
  PlaceHoldForm,
  ReleaseHoldForm,
  ErasureTestForm,
} from "./forms";
import {
  PageHeader,
  Card,
  Badge,
  type BadgeTone,
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD,
  MonthNav,
} from "@/components/console/ui";
import { formatDate, formatDateTime } from "@/lib/format/date";

export const metadata = { title: "Audit log" };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SOD_LABEL: Record<string, string> = {
  preparer_cannot_approve: "The preparer of a run cannot approve it",
  bank_changer_cannot_approve:
    "Someone who changed bank details cannot approve the run that pays into them",
  employee_creator_cannot_approve_salary:
    "The creator of an employee cannot approve their salary structure",
};

const TONE: Record<string, BadgeTone> = {
  denied: "rust",
  failed: "rust",
  written_off: "rust",
  approved: "teal",
  verified: "teal",
  reopened: "brass",
  superseded: "brass",
  calculated: "indigo",
};

function toneFor(action: string): BadgeTone {
  const key = Object.keys(TONE).find((k) => action.includes(k));
  return key ? TONE[key] : "neutral";
}

function Panel({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card padded={false}>
      <div className="px-5 py-3.5 border-b border-line-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[15px] font-semibold text-ink">{title}</span>
        {right}
      </div>
      {children}
    </Card>
  );
}

export default async function AuditPage(props: PageProps<"/console/audit">) {
  const user = (await getSessionUser())!;
  // Entries span every legal entity and carry no company of their own,
  // so a user confined to one entity cannot be shown them safely.
  if (!isTenantWide(user)) redirect("/console?denied=audit");

  const sp = await props.searchParams;
  const companies = await listCompanies();
  const companyId =
    (typeof sp.company === "string" ? sp.company : null) ?? companies[0]?.id;
  if (!companyId) redirect("/console");

  const now = new Date();
  const year = Number(sp.year) || now.getUTCFullYear();
  const month = Number(sp.month) || now.getUTCMonth() + 1;
  const company = companies.find((c) => c.id === companyId)!;

  /*
   * When money is actually due to leave. Without this the highest-value
   * alert — a bank account changed days before disbursement — can never
   * fire, because proximity is the whole test.
   */
  const [pendingFile] = await db
    .select()
    .from(s.bankFiles)
    .where(
      and(
        eq(s.bankFiles.companyId, companyId),
        inArray(s.bankFiles.status, ["active", "released"]),
      ),
    )
    .orderBy(desc(s.bankFiles.generatedAt))
    .limit(1);

  // Fall back to month end, which is when most companies pay.
  const disbursementDate =
    pendingFile?.valueDate ??
    new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  /* eslint-disable-next-line react-hooks/purity -- a server component,
     rendered once per request: "now" is the request's own time, and the
     45-day alert window is measured from it by design. */
  const windowStart = new Date(Date.now() - 45 * 86_400_000).toISOString();
  await refreshAlerts({
    companyId,
    sinceIso: windowStart,
    disbursementDate,
  });

  const [entries, alerts, access, holds, policies, versions] = await Promise.all([
    db.select().from(s.auditLog).orderBy(desc(s.auditLog.at)).limit(120),
    loadAlerts(companyId),
    loadAccessLog({ companyIds: companies.map((c) => c.id), limit: 60 }),
    loadLegalHolds(companyId),
    loadSodPolicies(companyId),
    loadRunSides(companyId, year, month),
  ]);

  const diff =
    versions.length >= 2
      ? diffRuns(versions[versions.length - 2], versions[versions.length - 1])
      : null;

  const employees = await db
    .select({
      id: s.employees.id,
      empCode: s.employees.empCode,
      firstName: s.employees.firstName,
      lastName: s.employees.lastName,
    })
    .from(s.employees)
    .where(eq(s.employees.companyId, companyId))
    .orderBy(asc(s.employees.empCode))
    .limit(200);

  const bulkReads = access.filter((a) => a.rowCount >= 10);
  const query = `company=${companyId}&year=${year}&month=${month}`;

  return (
    <div className="flex flex-col gap-6 max-w-[84rem]">
      <PageHeader
        eyebrow="Audit & controls"
        title="Audit log"
        description="For any rupee paid in any period: what it was, how it was computed, who authorised it, and what it was before the last change."
        actions={
          <MonthNav year={year} month={month} href={(y, m) => `/console/audit?company=${companyId}&year=${y}&month=${m}`} />
        }
      />

      {/* ---------- audit pack ---------- */}
      <div className="border border-indigo/40 bg-surface px-5 py-4 flex flex-wrap items-center justify-between gap-4 rounded-xl">
        <div>
          <p className="text-xs font-semibold text-indigo mb-1">Audit pack</p>
          <p className="text-sm text-ink-2 max-w-[64ch]">
            The register, statutory summaries and their remittance references,
            the approval trail, exceptions and overrides, the variance report
            and the configuration versions in force — for {MONTHS[month - 1]}{" "}
            {year}, in one file.
          </p>
        </div>
        <a
          href={`/console/audit/pack?${query}`}
          className="px-4 py-2 text-sm border border-indigo text-indigo bg-surface hover:bg-indigo hover:text-white whitespace-nowrap rounded-lg"
        >
          Download pack ↓
        </a>
      </div>

      {/* ---------- alerts ---------- */}
      <Panel
        title="Control alerts"
        right={
          alerts.length > 0 ? (
            <span className="text-xs font-semibold text-rust">{alerts.length} outstanding</span>
          ) : (
            <span className="text-xs font-semibold text-teal">nothing outstanding</span>
          )
        }
      >
        {alerts.length === 0 ? (
          <p className="px-4 py-5 text-sm text-ink-3">
            No sensitive change has been raised in the last 45 days.
          </p>
        ) : (
          <ul className="divide-y divide-line-2">
            {alerts.map((a) => (
              <li key={a.id} className="px-4 py-3 flex flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      <Badge tone={a.severity === "high" ? "rust" : "brass"} className="mr-2">
                        {a.severity}
                      </Badge>
                      {a.title}
                    </p>
                    <p className="text-xs text-ink-2 mt-1 max-w-[76ch]">{a.detail}</p>
                    <p className="text-xs text-ink-3 mt-1 font-mono">
                      {a.actor} · {formatDateTime(a.raisedAt)}
                    </p>
                  </div>
                  {canMutate(user) && <AcknowledgeForm alertId={a.id} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ---------- version comparison ---------- */}
      <Panel
        title={`Run versions · ${MONTHS[month - 1]} ${year}`}
        right={
          <span className="text-xs font-medium text-ink-2">
            {versions.length} version{versions.length === 1 ? "" : "s"}
          </span>
        }
      >
        {versions.length === 0 ? (
          <p className="px-4 py-5 text-sm text-ink-3">
            No run exists for this period.
          </p>
        ) : (
          <>
            <Table>
              <THead>
                <TH>Version</TH>
                <TH>Status</TH>
                <TH>Prepared by</TH>
                <TH>Calculated</TH>
                <TH>Employees</TH>
                <TH>Net</TH>
              </THead>
              <TBody>
                {versions.map((v) => (
                  <TR key={v.version}>
                    <TD className="font-mono tnum">v{v.version}</TD>
                    <TD>
                      <Badge tone={toneFor(v.status)}>{v.status.replace(/_/g, " ")}</Badge>
                    </TD>
                    <TD className="text-ink-2 font-mono text-xs">
                      {v.preparedBy}
                    </TD>
                    <TD className="text-ink-3 font-mono text-xs">
                      {formatDateTime(v.calculatedAt)}
                    </TD>
                    <TD className="font-mono tnum text-ink-2">
                      {v.employees.length}
                    </TD>
                    <TD className="font-mono tnum">
                      {formatINR(v.employees.reduce((a, e) => a + e.netPaise, 0))}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            {diff ? (
              <div className="border-t border-line">
                <div className="px-4 py-2.5 bg-surface-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink">
                    v{diff.from.version} → v{diff.to.version}
                  </span>
                  <span
                    className={`label tnum ${
                      diff.totals.netDeltaPaise === 0 ? "text-ink-3" : "text-amber"
                    }`}
                  >
                    net {diff.totals.netDeltaPaise >= 0 ? "+" : "−"}
                    {formatINR(Math.abs(diff.totals.netDeltaPaise))}
                  </span>
                </div>

                {diff.warnings.length > 0 && (
                  <ul className="px-4 py-2.5 text-xs text-amber border-b border-line-2 flex flex-col gap-1">
                    {diff.warnings.map((w, i) => (
                      <li key={i}>· {w}</li>
                    ))}
                  </ul>
                )}

                <div className="px-4 py-2.5 text-xs text-ink-2 border-b border-line-2">
                  {diff.changed.length} changed · {diff.added.length} added ·{" "}
                  {diff.removed.length} removed · {diff.unchangedCount} unchanged
                </div>

                {diff.componentImpact.length > 0 && (
                  <Table className="border-0 rounded-none">
                    <THead>
                      <TH>Component</TH>
                      <TH>Moved by</TH>
                      <TH>Employees affected</TH>
                    </THead>
                    <TBody>
                      {diff.componentImpact.slice(0, 12).map((c) => (
                        <TR key={c.code}>
                          <TD>
                            {c.label}
                            <span className="block font-mono text-xs text-ink-3">
                              {c.code}
                            </span>
                          </TD>
                          <TD className={`font-mono tnum ${c.deltaPaise < 0 ? "text-rust" : "text-teal"}`}>
                            {c.deltaPaise >= 0 ? "+" : "−"}
                            {formatINR(Math.abs(c.deltaPaise))}
                          </TD>
                          <TD className="font-mono tnum text-ink-2">
                            {c.employeeCount}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </div>
            ) : (
              <p className="px-4 py-3 text-xs text-ink-3 border-t border-line-2">
                Only one version exists, so there is nothing to compare. A
                comparison appears once a period is reopened and recalculated.
              </p>
            )}
          </>
        )}
      </Panel>

      {/* ---------- segregation of duties ---------- */}
      <Panel title="Segregation of duties">
        <ul className="divide-y divide-line-2">
          {DEFAULT_SOD.map((d) => {
            const live = policies.find((p) => p.rule === d.rule) ?? d;
            return (
              <li
                key={d.rule}
                className="px-4 py-3 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm">{SOD_LABEL[d.rule] ?? d.rule}</p>
                  <p className="text-xs text-ink-3 mt-0.5">
                    {live.coolingDays
                      ? `Cooling window of ${live.coolingDays} days. `
                      : ""}
                    A blocked attempt is written to the log, not just refused on
                    screen.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={live.enabled ? "teal" : "rust"}>
                    {live.enabled ? "enforced" : "off"}
                  </Badge>
                  {user.role === "admin" && (
                    <SodToggle
                      companyId={companyId}
                      rule={d.rule}
                      enabled={live.enabled}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      {/* ---------- compensation access ---------- */}
      <Panel
        title="Compensation & bank data access"
        right={
          bulkReads.length > 0 ? (
            <span className="text-xs font-semibold text-amber">{bulkReads.length} bulk reads</span>
          ) : (
            <span className="text-xs font-medium text-ink-2">{access.length} recent reads</span>
          )
        }
      >
        {access.length === 0 ? (
          <p className="px-4 py-5 text-sm text-ink-3">
            No compensation reads recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto max-h-[26rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  {["When", "Who", "Role", "Data", "Surface", "Subject", "Rows"].map((h) => (
                    <th
                      key={h}
                      className="text-xs font-medium text-ink-2 text-left px-4 py-2 whitespace-nowrap sticky top-0 bg-surface-2"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {access.map((a) => (
                  <tr key={a.id} className="border-b border-line-2 last:border-0">
                    <td className="px-4 py-2 font-mono text-xs text-ink-3 whitespace-nowrap">
                      {formatDateTime(a.at)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{a.actor}</td>
                    <td className="px-4 py-2 text-xs text-ink-2">{a.actorRole}</td>
                    <td className="px-4 py-2">
                      <Badge tone="neutral">{a.dataClass}</Badge>
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-2">{a.surface}</td>
                    <td className="px-4 py-2 text-xs">
                      {a.subjectCode ? (
                        <>
                          {a.subjectName}{" "}
                          <span className="font-mono text-ink-3">{a.subjectCode}</span>
                        </>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td
                      className={`px-4 py-2 font-mono tnum ${
                        a.rowCount >= 10 ? "text-amber" : "text-ink-3"
                      }`}
                    >
                      {a.rowCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2 max-w-[78ch]">
          Reads are logged as well as writes. A bulk export records the row
          count and the filter used, so &ldquo;who took a copy of the
          payroll&rdquo; has an answer.
        </p>
      </Panel>

      {/* ---------- retention & legal hold ---------- */}
      <Panel
        title="Retention & legal hold"
        right={
          holds.filter((h) => !h.releasedAt).length > 0 ? (
            <span className="text-xs font-semibold text-rust">
              {holds.filter((h) => !h.releasedAt).length} in force
            </span>
          ) : undefined
        }
      >
        <Table className="border-0 rounded-none">
          <THead>
            <TH>Record class</TH>
            <TH>Keep for</TH>
            <TH>Basis</TH>
            <TH>Erasable</TH>
          </THead>
          <TBody>
            {RETENTION_RULES.map((r) => (
              <TR key={r.recordClass}>
                <TD className="whitespace-normal">{r.label}</TD>
                <TD className="font-mono tnum whitespace-nowrap">
                  {r.retainYears} years
                </TD>
                <TD className="text-xs text-ink-2 max-w-[42ch] whitespace-normal">{r.basis}</TD>
                <TD>
                  <Badge tone={r.erasable ? "teal" : "neutral"}>
                    {r.erasable ? "on request" : "no"}
                  </Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>

        <p className="px-4 py-2 text-xs text-amber border-t border-line-2 max-w-[78ch]">
          These periods are unverified against the current text of each Act.
          Treat them as a starting position for a customer&rsquo;s own legal
          review, not as advice.
        </p>

        <div className="px-4 py-3 border-t border-line-2">
          <p className="text-xs font-medium text-ink-2 mb-2">Test a deletion request</p>
          <ErasureTestForm
            companyId={companyId}
            recordClasses={RETENTION_RULES.map((r) => ({
              value: r.recordClass,
              label: r.label,
            }))}
          />
        </div>

        {holds.length > 0 && (
          <ul className="divide-y divide-line-2 border-t border-line-2">
            {holds.map((h) => (
              <li
                key={h.id}
                className="px-4 py-3 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm">
                    {h.employeeName ? (
                      <>
                        {h.employeeName}{" "}
                        <span className="font-mono text-xs text-ink-3">
                          {h.employeeCode}
                        </span>
                      </>
                    ) : (
                      "All employees"
                    )}
                    {h.periodYear ? ` · ${h.periodYear}` : " · all periods"}
                  </p>
                  <p className="text-xs text-ink-2 mt-0.5">{h.reason}</p>
                  <p className="text-xs text-ink-3 mt-0.5 font-mono">
                    {h.placedBy} · {formatDate(h.placedAt)}
                    {h.releasedAt && ` · released ${formatDate(h.releasedAt)}`}
                  </p>
                </div>
                {!h.releasedAt && user.role === "admin" && (
                  <ReleaseHoldForm holdId={h.id} />
                )}
              </li>
            ))}
          </ul>
        )}

        {user.role === "admin" && (
          <div className="px-4 py-3 border-t border-line-2">
            <p className="text-xs font-medium text-ink-2 mb-2">Place a legal hold</p>
            <PlaceHoldForm
              companyId={companyId}
              employees={employees.map((e) => ({
                id: e.id,
                label: `${e.empCode} — ${e.firstName} ${e.lastName}`,
              }))}
            />
          </div>
        )}
      </Panel>

      {/* ---------- the log itself ---------- */}
      <Panel
        title="Audit log"
        right={<span className="text-xs font-medium text-ink-2">append-only · last 120</span>}
      >
        <div className="overflow-x-auto max-h-[36rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                {["When", "Actor", "Role", "Source", "Action", "Entity", "Reason"].map((h) => (
                  <th
                    key={h}
                    className="text-xs font-medium text-ink-2 text-left px-4 py-2 whitespace-nowrap sticky top-0 bg-surface-2"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-line-2 last:border-0">
                  <td className="px-4 py-2 font-mono text-xs text-ink-3 whitespace-nowrap">
                    {formatDateTime(e.at)}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{e.actor}</td>
                  <td className="px-4 py-2 text-xs text-ink-2">{e.actorRole ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-ink-3">{e.source}</td>
                  <td className="px-4 py-2">
                    <Badge tone={toneFor(e.action)} className="whitespace-nowrap">
                      {e.action}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-2 font-mono">
                    {e.entity}
                    {e.affectedCount ? ` ×${e.affectedCount}` : ""}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-2 max-w-[38ch]">
                    {e.reason ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2 max-w-[78ch]">
          The log is append-only at the database, not by convention: update and
          delete are refused by a trigger, so no role — including an
          administrator — can edit or remove an entry.
        </p>
      </Panel>
    </div>
  );
}
