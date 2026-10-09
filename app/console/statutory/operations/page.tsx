import Link from "next/link";
import { redirect } from "next/navigation";
import { canAccessCompany, canMutate, canSeeCompensation, getSessionUser, scopeCompanies } from "@/lib/auth/session";
import { listCompanies } from "@/lib/payroll/load";
import { filingDigest, operationData, periodLiabilities } from "@/lib/statutory/operations";
import { reconcileDeposit } from "@/lib/statutory/workflow-rules";
import { formatINR } from "@/lib/payroll/money";
import { PageHeader, Table, THead, TH, TBody, TR, TD, Badge, MonthNav } from "@/components/console/ui";
import { OperationForm } from "./forms";

export const metadata = { title: "Compliance operations" };
const TABS = { deposits: "Deposits & filing", eps: "EPS evidence", bonus: "Annual bonus", overtime: "Overtime", leave: "Worker leave", notifications: "Notifications" };

export default async function OperationsPage(props: PageProps<"/console/statutory/operations">) {
  const user = await getSessionUser();
  if (!user || !canSeeCompensation(user)) redirect("/console?denied=statutory");
  const sp = await props.searchParams;
  const companies = scopeCompanies(user, await listCompanies());
  const companyId = typeof sp.company === "string" && canAccessCompany(user, sp.company) ? sp.company : companies[0]?.id;
  if (!companyId) redirect("/console");
  const now = new Date();
  const year = Number(sp.year) || now.getUTCFullYear(), month = Number(sp.month) || now.getUTCMonth() + 1;
  const tab = typeof sp.tab === "string" && sp.tab in TABS ? sp.tab as keyof typeof TABS : "deposits";
  const data = await operationData(companyId, year, month);
  const formProps = { companyId, year, month, employees: data.employees };
  const query = `company=${encodeURIComponent(companyId)}&year=${year}&month=${month}`;
  const fy = month >= 4 ? year : year - 1;
  const kind = { bonus: "bonus", overtime: "overtime", leave: "worker_leave", eps: "eps_review", deposits: "filing_validation", notifications: "worker_coverage" }[tab];
  const registers = data.registers.filter(r => r.kind === kind && (tab === "eps" || r.periodYear === year));
  const liabilities = tab === "deposits" ? await periodLiabilities(companyId, year, month) : null;
  const mutate = canMutate(user);
  return <div className="flex flex-col gap-6 max-w-[88rem]">
    <PageHeader title="Compliance operations" eyebrow={data.company?.name} actions={<MonthNav year={year} month={month} href={(y, m) => `/console/statutory/operations?company=${companyId}&year=${y}&month=${m}&tab=${tab}`} />} />
    <div className="flex flex-wrap gap-3 items-end"><form method="get" className="flex gap-2 items-center"><input name="tab" type="hidden" value={tab} /><input name="year" type="hidden" value={year} /><input name="month" type="hidden" value={month} /><label className="text-sm">Company <select name="company" defaultValue={companyId} className="border border-line rounded px-2 py-1.5">{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><button className="text-sm font-semibold text-indigo" type="submit">Apply</button></form><Link className="text-sm text-indigo" href={`/console/statutory?${query}`}>Returns &amp; filings</Link></div>
    <nav aria-label="Compliance workflows" className="flex gap-5 overflow-x-auto border-b border-line-2">{Object.entries(TABS).map(([key, label]) => <Link key={key} href={`/console/statutory/operations?${query}&tab=${key}`} aria-current={tab === key ? "page" : undefined} className={`py-3 text-sm whitespace-nowrap border-b-2 ${tab === key ? "border-indigo text-indigo font-semibold" : "border-transparent text-ink-2"}`}>{label}</Link>)}</nav>
    {tab === "deposits" && <>
      <section><h2 className="text-base font-semibold mb-3">Deposit reconciliation</h2><Table><THead><TH>Authority</TH><TH>State</TH><TH>Liability</TH><TH>Deposited</TH><TH>Outstanding / excess</TH></THead><TBody>{liabilities?.rows.map(row => {
        const r = reconcileDeposit(row.amountPaise, data.deposits.filter(d => d.scheme === row.scheme && d.stateCode === row.stateCode && d.periodYear === year && d.periodMonth === month));
        return <TR key={`${row.scheme}:${row.stateCode}`}><TD>{row.scheme.toUpperCase()}</TD><TD>{row.stateCode}</TD><TD>{formatINR(r.liabilityPaise)}</TD><TD>{formatINR(r.paidPaise)}</TD><TD><Badge tone={r.matches ? "teal" : "rust"}>{r.matches ? "Reconciled" : r.excessPaise ? `Excess ${formatINR(r.excessPaise)}` : `Due ${formatINR(r.outstandingPaise)}`}</Badge></TD></TR>;
      })}</TBody></Table></section>
      {mutate && <section className="border-t border-line-2 pt-4"><h2 className="text-base font-semibold mb-3">Record deposited challan</h2><OperationForm {...formProps} operation="deposit" /></section>}
      <section><h2 className="text-base font-semibold mb-3">Deposit evidence</h2><Table><THead><TH>Authority / period</TH><TH>Reference</TH><TH>BSR / serial</TH><TH>Amount</TH><TH>Allocated</TH><TH>Date / evidence</TH></THead><TBody>{data.deposits.filter(d => d.periodYear === year && d.periodMonth === month).map(d => <TR key={d.id}><TD>{d.scheme.toUpperCase()} · {d.stateCode}</TD><TD>{d.reference}</TD><TD>{d.bsr ?? "-"} / {d.serial ?? "-"}</TD><TD>{formatINR(d.amountPaise)}</TD><TD>{formatINR(data.allocations.filter(a => a.depositId === d.id).reduce((sum, a) => sum + a.amountPaise, 0))}</TD><TD className="whitespace-normal">{d.depositedOn}<span className="block text-xs text-ink-2">{d.evidence}</span></TD></TR>)}</TBody></Table></section>
      {mutate && <section className="border-t border-line-2 pt-4"><h2 className="text-base font-semibold mb-3">Allocate challan to salary TDS</h2><OperationForm {...formProps} operation="allocate" deposits={data.deposits} ledger={data.ledger} /></section>}
      <section><h2 className="text-base font-semibold mb-3">Form 138 · FY {fy}-{fy + 1}</h2><div className="flex flex-wrap gap-4 text-sm mb-4">{[1, 2, 3, 4].map(q => <Link key={q} className="text-indigo font-semibold" href={`/console/statutory/operations/export?${query}&kind=tds-packet&quarter=${q}`}>Q{q} reconciliation packet</Link>)}</div>
        {mutate && <OperationForm {...formProps} operation="filing_validation" />}
        {data.registers.filter(r => r.kind === "filing_validation" && r.status === "posted").map(r => {
          const snap = JSON.parse(r.snapshotJson);
          const current = snap.inputDigest === filingDigest(data, snap.quarter);
          return <p key={r.id} className="text-sm mt-3">Q{snap.quarter} · {snap.toolVersion} · {current ? <Link className="text-indigo" href={`/console/statutory/operations/export?${query}&kind=fvu&register=${r.id}`}>Reviewed FVU artifact</Link> : <span className="text-rust">Stale: revalidate changed deductions/deposits</span>}</p>;
        })}
      </section>
    </>}
    {tab === "eps" && <>
      <section><div className="flex items-center justify-between gap-3 mb-3"><h2 className="text-base font-semibold">EPS transition &amp; history review</h2><Link className="text-sm text-indigo" href={`/console/statutory/operations/export?${query}&kind=eps`}>Download report</Link></div><Table><THead><TH>Employee</TH><TH>UAN</TH><TH>Joining wage</TH><TH>17 Sep wage</TH><TH>Transition / evidence</TH></THead><TBody>{data.eps.map(e => <TR key={e.id}><TD><Link className="text-indigo" href={`/console/employees/${e.id}?tab=payroll`}>{e.empCode} · {e.name}</Link></TD><TD>{e.uan ?? "Missing"}</TD><TD>{e.joiningWagePaise === null ? "Unknown" : formatINR(e.joiningWagePaise)}</TD><TD>{e.revisionWagePaise === null ? "Unknown" : formatINR(e.revisionWagePaise)}</TD><TD>{e.transitionRequired ? "Enrolment review required" : e.needsReview ? "History incomplete" : "History recorded"}<span className="block text-xs text-ink-2">{e.review ? `Reviewed by ${e.review.reviewedBy}` : "Not reviewed"}</span></TD></TR>)}</TBody></Table></section>
      {mutate && <section className="border-t border-line-2 pt-4"><h2 className="text-base font-semibold mb-3">Review historical evidence / enrolment</h2><OperationForm {...formProps} operation="eps_review" /></section>}
    </>}
    {tab === "bonus" && mutate && <section><h2 className="text-base font-semibold mb-3">Annual bonus · accounting year {year}-{year + 1}</h2><OperationForm {...formProps} operation="bonus" /></section>}
    {tab === "overtime" && mutate && <section><h2 className="text-base font-semibold mb-3">Attendance-derived overtime</h2><OperationForm {...formProps} operation="overtime" /></section>}
    {tab === "leave" && mutate && <section><h2 className="text-base font-semibold mb-3">Worker leave · calendar year {year}</h2><OperationForm {...formProps} operation="worker_leave" /></section>}
    {["leave", "overtime", "notifications"].includes(tab) && mutate && <section className="border-t border-line-2 pt-4"><h2 className="text-base font-semibold mb-3">Reviewed employee coverage</h2><OperationForm {...formProps} operation="worker_coverage" /></section>}
    {tab === "notifications" && <>
      <section><h2 className="text-base font-semibold mb-3">State notification tracker</h2><form method="get" className="flex gap-2 mb-4"><input type="hidden" name="company" value={companyId} /><input type="hidden" name="tab" value="notifications" /><input type="hidden" name="year" value={year} /><input type="hidden" name="month" value={month} /><label className="text-sm">State <select name="state" defaultValue={String(sp.state ?? "IN")} className="border border-line rounded px-2 py-1.5">{[...new Set(["IN", ...data.notifications.map(n => n.stateCode)])].sort().map(code => <option key={code}>{code}</option>)}</select></label><button className="text-sm text-indigo" type="submit">Apply</button></form>
        <Table><THead><TH>Subject</TH><TH>Status</TH><TH>Effective dates</TH><TH>Original document</TH><TH>Review</TH></THead><TBody>{data.notifications.filter(n => n.stateCode === String(sp.state ?? "IN")).map(n => <TR key={n.id}><TD>{n.subject.replaceAll("_", " ")}{n.monthlyFloorPaise && <span className="block">{formatINR(n.monthlyFloorPaise)}</span>}</TD><TD>{n.status.replaceAll("_", " ")}</TD><TD>{n.effectiveFrom} / {n.effectiveTo ?? "open"}</TD><TD className="whitespace-normal"><a className="text-indigo" href={n.documentUrl} target="_blank" rel="noreferrer">{n.notificationRef}</a><span className="block text-xs break-all text-ink-3">SHA-256 {n.documentSha256}</span></TD><TD className="whitespace-normal">{n.reviewedBy}<span className="block text-xs text-ink-2">{n.reviewNote}</span></TD></TR>)}</TBody></Table>
      </section>
      {user.role === "admin" && <section className="border-t border-line-2 pt-4"><h2 className="text-base font-semibold mb-3">Append notification / floor-wage version</h2><OperationForm {...formProps} operation="notification" /></section>}
    </>}
    <section className="border-t border-line-2 pt-4"><div className="flex items-center justify-between mb-3"><h2 className="text-base font-semibold">Review queue &amp; posted register</h2><Link className="text-sm text-indigo" href={`/console/statutory/operations/export?${query}&kind=registers&tab=${tab}`}>Download register</Link></div>
      {registers.length === 0 && <p className="text-sm text-ink-3">No records for this selection.</p>}
      {registers.map(r => {
        const snap = JSON.parse(r.snapshotJson);
        const employee = data.employees.find(e => e.id === r.employeeId);
        return <details key={r.id} className="border-b border-line-2 py-3"><summary className="cursor-pointer text-sm font-medium">{employee ? `${employee.empCode} · ${employee.firstName} ${employee.lastName}` : r.kind.replaceAll("_", " ")} · {r.periodYear}/{r.periodMonth} · {r.status}</summary>
          <dl className="grid sm:grid-cols-2 gap-2 text-sm my-3"><div><dt className="text-ink-3">Prepared by</dt><dd>{r.preparedBy}</dd></div><div><dt className="text-ink-3">Reviewed by</dt><dd>{r.reviewedBy ?? "Pending"}</dd></div><div className="sm:col-span-2"><dt className="text-ink-3">Evidence</dt><dd className="break-words">{r.evidence}</dd></div>{r.reviewEvidence && <div className="sm:col-span-2"><dt className="text-ink-3">Reviewer evidence</dt><dd className="break-words">{r.reviewEvidence}</dd></div>}
            {Object.entries(snap).filter(([k, v]) => typeof v !== "object" && !["inputDigest", "employeeDigest", "artifactKey"].includes(k)).map(([k, v]) => <div key={k}><dt className="text-ink-3 break-words">{k.replace(/([a-z])([A-Z])/g, "$1 $2")}</dt><dd className="break-words">{k.endsWith("Paise") ? formatINR(Number(v)) : String(v)}</dd></div>)}
          </dl>
          {snap.awards && <Table><THead><TH>Employee</TH><TH>Minimum</TH><TH>Maximum</TH><TH>Award</TH><TH>Previously paid</TH><TH>Balance</TH></THead><TBody>{snap.awards.map((a: { employeeId: string; empCode: string; minimumPaise: number; maximumPaise: number; payablePaise: number; alreadyPaidPaise: number; balancePaise: number }) => <TR key={a.employeeId}><TD>{a.empCode}</TD>{[a.minimumPaise, a.maximumPaise, a.payablePaise, a.alreadyPaidPaise, a.balancePaise].map((v, i) => <TD key={i}>{formatINR(v)}</TD>)}</TR>)}</TBody></Table>}
          {snap.surplus && <div className="text-sm my-3"><h3 className="font-semibold">Closing set-on / set-off</h3>{snap.surplus.closingCarry.map((lot: { year: number; kind: string; amountPaise: number }, i: number) => <p key={i}>{lot.year} · {lot.kind} · {formatINR(lot.amountPaise)}</p>)}</div>}
          {r.status === "draft" && mutate && <OperationForm {...formProps} operation="post" registerId={r.id} />}
          {r.kind === "filing_validation" && <Link className="text-sm text-indigo" href={`/console/statutory/operations/export?${query}&kind=validation-report&register=${r.id}`}>Validation report</Link>}
        </details>;
      })}
      {["leave", "overtime"].includes(tab) && data.registers.filter(r => r.kind === "worker_coverage").map(r => <details key={r.id} className="border-b border-line-2 py-3"><summary className="cursor-pointer text-sm">Coverage · {data.employees.find(e => e.id === r.employeeId)?.empCode} · {r.status}</summary><p className="text-sm my-3">{r.evidence}</p>{r.status === "draft" && mutate && <OperationForm {...formProps} operation="post" registerId={r.id} />}</details>)}
    </section>
  </div>;
}
