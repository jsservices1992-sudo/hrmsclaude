import { createHash } from "node:crypto";
import { canAccessCompany, canAccessConsole, canSeeCompensation, getSessionUser } from "@/lib/auth/session";
import { recordAccess } from "@/lib/audit/log";
import { filingDigest, operationData, quarterMonths } from "@/lib/statutory/operations";
import { csvFile } from "@/lib/statutory/workflow-rules";
import { read } from "@/lib/storage";

export async function GET(request: Request) {
  const user = await getSessionUser();
  const url = new URL(request.url);
  const companyId = url.searchParams.get("company") ?? "";
  if (!user || !canAccessConsole(user) || !canSeeCompensation(user) || !canAccessCompany(user, companyId)) return new Response("Not authorised", { status: 403 });
  const year = Number(url.searchParams.get("year")), month = Number(url.searchParams.get("month"));
  if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) return new Response("Invalid period", { status: 400 });
  const data = await operationData(companyId, year, month);
  const kind = url.searchParams.get("kind");
  await recordAccess({ user, companyId, dataClass: "compensation", surface: `compliance operations export:${kind}`, filterApplied: `${year}/${month}`, rowCount: data.employees.length });
  if (kind === "fvu" || kind === "validation-report") {
    const register = data.registers.find(r => r.id === url.searchParams.get("register") && r.kind === "filing_validation" && (kind === "validation-report" || r.status === "posted"));
    if (!register) return new Response("Reviewed filing artifact not found", { status: 404 });
    const sourceData = await operationData(companyId, register.periodYear, register.periodMonth);
    const snap = JSON.parse(register.snapshotJson);
    if (snap.inputDigest !== filingDigest(sourceData, snap.quarter)) return new Response("Deductions or challan allocation changed. Revalidate with the official utility.", { status: 409 });
    const key = kind === "fvu" ? snap.artifactKey : snap.reportKey;
    const hash = kind === "fvu" ? snap.artifactSha256 : snap.reportSha256;
    if (!key || !hash) return new Response("Validation report missing", { status: 409 });
    const bytes = await read(key);
    if (!bytes || createHash("sha256").update(bytes).digest("hex") !== hash) return new Response("Artifact missing or integrity check failed", { status: 409 });
    const extension = kind === "fvu" ? "fvu" : key.endsWith(".pdf") ? "pdf" : "txt";
    return file(new Uint8Array(bytes), `form138-q${snap.quarter}-${register.periodYear}.${extension}`, "application/octet-stream");
  }
  let rows: (string | number | null)[][];
  if (kind === "eps") {
    rows = [["Employee", "Name", "UAN", "Prior EPS member", "Joining wage paise", "Revision wage paise", "Transition review", "History incomplete", "Reviewer", "Evidence"]];
    for (const e of data.eps) rows.push([e.empCode, e.name, e.uan, String(e.epsMember), e.joiningWagePaise,
      e.revisionWagePaise, String(e.transitionRequired), String(e.needsReview), e.review?.reviewedBy ?? null, e.review?.evidence ?? null]);
  } else if (kind === "tds-packet") {
    const quarter = Number(url.searchParams.get("quarter"));
    if (![1, 2, 3, 4].includes(quarter)) return new Response("Choose Q1-Q4", { status: 400 });
    rows = [["Form 138 reconciliation packet - prepare/validate in official RPU/FVU", "TAN", data.company?.tan ?? "", "SHA-256", filingDigest(data, quarter)],
      ["Employee", "PAN", "Month", "Source", "TDS paise", "Allocated paise", "CIN/reference", "BSR", "Serial", "Deposit date", "Allocation paise"]];
    for (const l of data.ledger.filter(l => quarterMonths(quarter).includes(l.month))) {
      const e = data.employees.find(e => e.id === l.employeeId)!;
      const allocations = data.allocations.filter(a => a.ledgerId === l.id);
      const allocated = allocations.reduce((sum, a) => sum + a.amountPaise, 0);
      if (!allocations.length) rows.push([e.empCode, e.pan, l.month, l.sourceKey, l.tdsPaise, 0, "UNALLOCATED", null, null, null, 0]);
      for (const a of allocations) {
        const deposit = data.deposits.find(d => d.id === a.depositId)!;
        rows.push([e.empCode, e.pan, l.month, l.sourceKey, l.tdsPaise, allocated, deposit.reference, deposit.bsr, deposit.serial, deposit.depositedOn, a.amountPaise]);
      }
    }
  } else if (kind === "registers") {
    const tab = url.searchParams.get("tab");
    const map: Record<string, string> = { eps: "eps_review", bonus: "bonus", overtime: "overtime", leave: "worker_leave", notifications: "worker_coverage", deposits: "filing_validation" };
    if (!tab || !map[tab]) return new Response("Choose a register", { status: 400 });
    rows = [["Register", "Employee", "Year", "Month", "Status", "Prepared by", "Reviewed by", "Evidence", "Snapshot"]];
    for (const r of data.registers.filter(r => r.kind === map[tab] && r.periodYear === year)) {
      const snap = JSON.parse(r.snapshotJson), empCode = data.employees.find(e => e.id === r.employeeId)?.empCode ?? "";
      rows.push([r.id, empCode, r.periodYear, r.periodMonth, r.status, r.preparedBy, r.reviewedBy, r.evidence, r.snapshotJson]);
      if (r.kind === "overtime") {
        rows.push(["Date", "Worked minutes", "Off day", "Daily OT minutes", "Weekly OT minutes", "Total OT minutes", "Double-rate hourly paise"]);
        for (const d of snap.rows) rows.push([d.date, d.workedMinutes, String(d.offDay), d.dailyMinutes, d.weeklyMinutes, d.overtimeMinutes, snap.ratePaisePerHour]);
      } else if (r.kind === "bonus") {
        rows.push(["Employee", "Calculation wage paise", "Worked days", "Minimum paise", "Maximum paise", "Award paise", "Previously paid paise", "Balance paise", "Due on"]);
        for (const a of snap.awards) rows.push([a.empCode, a.basePaise, a.workedDays, a.minimumPaise, a.maximumPaise, a.payablePaise, a.alreadyPaidPaise, a.balancePaise, snap.dueOn]);
      }
    }
  } else return new Response("Unknown export", { status: 404 });
  return file(csvFile(rows), `compliance-${kind}-${year}-${month}.csv`, "text/csv; charset=utf-8");
}

function file(body: string | Uint8Array<ArrayBuffer>, filename: string, type: string) {
  return new Response(body, { headers: { "content-type": type, "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
