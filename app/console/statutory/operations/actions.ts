"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
import * as c from "@/db/compliance-schema";
import { canAccessCompany, canMutate, canSeeCompensation, getSessionUser } from "@/lib/auth/session";
import { loadSodPolicies } from "@/lib/audit/log";
import { digest, epsHistoryDigest, filingDigest, quarterMonths, operationData, periodDates, prepareBonus, prepareOvertime, prepareWorkerLeave } from "@/lib/statutory/operations";
import { validDate } from "@/lib/statutory/workflow-rules";
import { BOOKED_RUN_STATUSES } from "@/lib/payroll/authoritative-runs";
import { isSafeKey } from "@/lib/storage/rules";
import { storageUnavailable, trySave } from "@/lib/storage";
import { ageAsOfMonth } from "@/lib/statutory/ecr";
import { validatePan } from "@/lib/tax/engine";

export type OperationState = { error?: string; ok?: string };
const date = z.string().refine(validDate, "Enter a valid calendar date");
const evidence = z.string().trim().min(10, "A document reference and review basis are required").max(2000);
const paise = (value: FormDataEntryValue | null) => {
  const raw = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new Error("Enter a non-negative amount in rupees, with at most two decimals");
  const amount = Math.round(Number(raw) * 100);
  if (!Number.isSafeInteger(amount)) throw new Error("Amount is too large");
  return amount;
};
const days = (fd: FormData, key: string) => z.coerce.number().min(0).max(1000).parse(fd.get(key));
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function audit(tx: Tx, user: { email: string; role: string }, action: string, id: string, after: unknown) {
  await tx.insert(s.auditLog).values({ id: randomUUID(), at: new Date().toISOString(), actor: user.email,
    actorRole: user.role, action, entity: "compliance_operations", entityId: id, after: JSON.stringify(after) });
}

export async function saveOperation(_previous: OperationState, fd: FormData): Promise<OperationState> {
  const user = await getSessionUser();
  const companyId = String(fd.get("companyId") ?? "");
  if (!user || !canMutate(user) || !canSeeCompensation(user) || !canAccessCompany(user, companyId)) return { error: "Not authorised" };
  const operation = String(fd.get("operation") ?? "");
  try {
    const year = z.coerce.number().int().min(2000).max(2200).parse(fd.get("year"));
    const month = z.coerce.number().int().min(1).max(12).parse(fd.get("month"));
    periodDates(year, month);
    const now = new Date().toISOString();
    const ref = evidence.parse(fd.get("evidence"));
    const employeeId = String(fd.get("employeeId") ?? "");
    const [company] = await db.select().from(s.companies).where(eq(s.companies.id, companyId));
    if (!company) return { error: "Company not found" };
    if (operation === "deposit") {
      const scheme = z.enum(["tds", "epf", "esic", "pt", "lwf"]).parse(fd.get("scheme"));
      const amountPaise = paise(fd.get("amount"));
      if (!amountPaise) throw new Error("Deposit amount must be positive");
      const depositedOn = date.parse(fd.get("depositedOn"));
      if (depositedOn > now.slice(0, 10)) throw new Error("A deposit cannot be dated in the future");
      const reference = z.string().trim().min(5).max(150).parse(fd.get("reference"));
      const stateCode = ["pt", "lwf"].includes(scheme) ? z.string().regex(/^[A-Z]{2}$/).parse(fd.get("stateCode")) : "-";
      const bsr = scheme === "tds" ? z.string().regex(/^\d{7}$/, "BSR must contain seven digits").parse(fd.get("bsr")) : null;
      const serial = scheme === "tds" ? z.string().regex(/^\d{5}$/, "Challan serial must contain five digits").parse(fd.get("serial")) : null;
      const id = randomUUID();
      await db.transaction(async tx => {
        await tx.insert(c.statutoryDeposits).values({ id, companyId, scheme, stateCode, periodYear: year, periodMonth: month,
          amountPaise, depositedOn, reference, bsr, serial, evidence: ref, recordedBy: user.email, recordedAt: now });
        await audit(tx, user, "statutory.deposit", id, { scheme, amountPaise, reference, year, month, stateCode });
      });
    } else if (operation === "allocate") {
      const depositId = String(fd.get("depositId")), ledgerId = String(fd.get("ledgerId")), amount = paise(fd.get("amount"));
      if (!amount) throw new Error("Allocation must be positive");
      await db.transaction(async tx => {
        // The company lock serialises allocation across separate deposits for one deduction.
        await tx.select().from(s.companies).where(eq(s.companies.id, companyId)).for("update");
        const [deposit] = await tx.select().from(c.statutoryDeposits).where(and(eq(c.statutoryDeposits.id, depositId), eq(c.statutoryDeposits.companyId, companyId))).for("update");
        const [ledger] = await tx.select({ ledger: s.tdsLedger, employee: s.employees }).from(s.tdsLedger)
          .innerJoin(s.employees, eq(s.employees.id, s.tdsLedger.employeeId)).where(eq(s.tdsLedger.id, ledgerId));
        if (!deposit || deposit.scheme !== "tds" || !ledger || ledger.employee.companyId !== companyId) throw new Error("Deposit and deduction must belong to this company");
        const fy = deposit.periodMonth >= 4 ? deposit.periodYear : deposit.periodYear - 1;
        if (ledger.ledger.financialYear !== fy || ledger.ledger.month !== deposit.periodMonth) throw new Error("Deposit and deduction periods must match");
        const allocations = await tx.select().from(c.tdsAllocations);
        const allocatedDeposit = allocations.filter(a => a.depositId === depositId).reduce((sum, a) => sum + a.amountPaise, 0);
        const allocatedLedger = allocations.filter(a => a.ledgerId === ledgerId).reduce((sum, a) => sum + a.amountPaise, 0);
        if (amount + allocatedDeposit > deposit.amountPaise || amount + allocatedLedger > ledger.ledger.tdsPaise) throw new Error("Allocation exceeds unallocated deposit or deduction");
        const existing = allocations.find(a => a.depositId === depositId && a.ledgerId === ledgerId);
        if (existing) await tx.update(c.tdsAllocations).set({ amountPaise: existing.amountPaise + amount }).where(eq(c.tdsAllocations.id, existing.id));
        else await tx.insert(c.tdsAllocations).values({ id: randomUUID(), depositId, ledgerId, amountPaise: amount });
        await audit(tx, user, "statutory.allocate", depositId, { ledgerId, amount, evidence: ref });
      });
    } else if (operation === "notification") {
      if (user.role !== "admin") throw new Error("Only an administrator may attest to legal notifications");
      const stateCode = z.string().regex(/^[A-Z]{2}$/).parse(fd.get("stateCode"));
      const subject = z.enum(["wage_code", "osh_code", "minimum_wage", "pt", "lwf", "floor_wage"]).parse(fd.get("subject"));
      const status = z.enum(["draft", "notified", "not_notified", "superseded"]).parse(fd.get("notificationStatus"));
      const documentUrl = z.string().url().refine(v => {
        const u = new URL(v);
        return u.protocol === "https:" && !u.username && !u.password && /\.(gov|nic)\.in$/i.test(u.hostname);
      }, "Use an original HTTPS government document (.gov.in or .nic.in)").parse(fd.get("documentUrl"));
      const documentSha256 = z.string().regex(/^[a-f0-9]{64}$/i, "Enter the document SHA-256").parse(fd.get("documentSha256"));
      const effectiveFrom = date.parse(fd.get("effectiveFrom"));
      const effectiveTo = fd.get("effectiveTo") ? date.parse(fd.get("effectiveTo")) : null;
      if (effectiveTo && effectiveTo < effectiveFrom) throw new Error("Effective end precedes start");
      const monthlyFloorPaise = subject === "floor_wage" && status === "notified" ? paise(fd.get("floorAmount")) : null;
      if (monthlyFloorPaise !== null && monthlyFloorPaise <= 0) throw new Error("A notified floor needs a positive reviewed monthly equivalent and conversion basis");
      const id = randomUUID();
      await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('statutory-notifications'))`);
        await tx.select().from(s.companies).where(eq(s.companies.id, companyId)).for("update");
        const rows = await tx.select().from(c.ruleNotifications).where(and(eq(c.ruleNotifications.stateCode, stateCode), eq(c.ruleNotifications.subject, subject)));
        if (rows.some(r => r.effectiveFrom === effectiveFrom)) throw new Error("A notification version already starts on that date");
        if (rows.some(r => r.effectiveFrom > effectiveFrom)) throw new Error("Backdated insert requires review; append after the latest recorded version");
        const previousDay = new Date(effectiveFrom + "T00:00:00Z"); previousDay.setUTCDate(previousDay.getUTCDate() - 1);
        for (const r of rows.filter(r => !r.effectiveTo || r.effectiveTo >= effectiveFrom)) await tx.update(c.ruleNotifications)
          .set({ effectiveTo: previousDay.toISOString().slice(0, 10) }).where(eq(c.ruleNotifications.id, r.id));
        await tx.insert(c.ruleNotifications).values({ id, stateCode, subject, status, notificationRef: ref, documentUrl,
          documentSha256: documentSha256.toLowerCase(), effectiveFrom, effectiveTo, reviewedBy: user.email,
          reviewedAt: now, reviewNote: z.string().trim().min(10).max(2000).parse(fd.get("reviewNote")), monthlyFloorPaise });
        await audit(tx, user, "statutory.notification", id, { stateCode, subject, status, effectiveFrom, monthlyFloorPaise, ref });
      });
    } else if (operation === "post") {
      const id = String(fd.get("registerId"));
      const policies = await loadSodPolicies(companyId);
      await db.transaction(async tx => {
        await tx.select().from(s.companies).where(eq(s.companies.id, companyId)).for("update");
        const [row] = await tx.select().from(c.complianceRegisters).where(and(eq(c.complianceRegisters.id, id), eq(c.complianceRegisters.companyId, companyId))).for("update");
        if (!row || row.status !== "draft") throw new Error("Register is no longer a draft");
        if (row.preparedBy === user.email && policies.find(p => p.rule === "preparer_cannot_approve")?.enabled !== false) throw new Error("A second reviewer must post this register");
        const snapshot = JSON.parse(row.snapshotJson);
        if (row.kind === "overtime") {
          const latest = await prepareOvertime(companyId, row.employeeId!, row.periodYear, row.periodMonth, snapshot.divisor, tx);
          if (latest.inputDigest !== snapshot.inputDigest) throw new Error("Attendance or salary changed. Prepare again before posting");
        } else if (row.kind === "bonus") {
          const latest = await prepareBonus(companyId, row.periodYear, snapshot.allocablePaise, tx, snapshot.openingCarry);
          if (latest.inputDigest !== snapshot.inputDigest) throw new Error("Bonus inputs changed. Prepare again before posting");
        } else if (row.kind === "worker_leave") {
          const latest = await prepareWorkerLeave(companyId, row.employeeId!, row.periodYear, snapshot.facts, tx);
          if (latest.inputDigest !== snapshot.inputDigest) throw new Error("Leave inputs changed. Prepare again before posting");
        } else if (row.kind === "eps_review") {
          const [e] = await tx.select().from(s.employees).where(eq(s.employees.id, row.employeeId!)).for("update");
          if (epsHistoryDigest(e) !== snapshot.employeeDigest) throw new Error("EPS history changed. Prepare review again");
        } else if (row.kind === "filing_validation") {
          const data = await operationData(companyId, row.periodYear, row.periodMonth, tx);
          if (filingDigest(data, snapshot.quarter) !== snapshot.inputDigest) throw new Error("TDS or deposit allocation changed; regenerate and revalidate with the official utility");
        }
        if (["overtime", "bonus", "worker_leave"].includes(row.kind)) {
          const payout = periodDates(snapshot.payoutYear, snapshot.payoutMonth);
          if (row.kind === "bonus" && payout.from <= `${row.periodYear + 1}-03-31`) throw new Error("Annual bonus payout must follow the accounting year close");
          if (row.kind === "worker_leave" && payout.from <= `${row.periodYear}-12-31`) throw new Error("Year-end encashment payout must follow the calendar year close");
          const runs = await tx.select().from(s.payrollRuns).where(and(eq(s.payrollRuns.companyId, companyId), eq(s.payrollRuns.periodYear, snapshot.payoutYear), eq(s.payrollRuns.periodMonth, snapshot.payoutMonth))).for("update");
          const latest = runs.sort((a, b) => b.version - a.version)[0];
          if (latest && BOOKED_RUN_STATUSES.has(latest.status)) throw new Error("Payout payroll is already approved. Choose an unapproved period and recompute it after posting");
          if (row.kind === "overtime") {
            const manual = await tx.select().from(s.payrollAdjustments).where(and(eq(s.payrollAdjustments.employeeId, row.employeeId!), eq(s.payrollAdjustments.periodYear, row.periodYear), eq(s.payrollAdjustments.periodMonth, row.periodMonth), eq(s.payrollAdjustments.category, "ot")));
            if (manual.length) throw new Error("Existing overtime adjustment would duplicate this register. Reconcile/remove the unposted manual entry first");
          }
          const awards: { employeeId: string; amountPaise: number }[] = row.kind === "bonus"
            ? snapshot.awards.map((a: { employeeId: string; balancePaise: number }) => ({ employeeId: a.employeeId, amountPaise: a.balancePaise }))
            : [{ employeeId: row.employeeId!, amountPaise: row.kind === "overtime" ? snapshot.amountPaise : snapshot.encashPaise }];
          for (const a of awards.filter(a => a.amountPaise > 0)) {
            const [employee] = await tx.select().from(s.employees).where(eq(s.employees.id, a.employeeId));
            if (!employee || employee.status === "exited" || (employee.dateOfExit && employee.dateOfExit < payout.from)) throw new Error("An award belongs to a leaver excluded from payout payroll. Arrange a reviewed supplemental settlement; queuing it into an active-employee run would leave it unpaid");
          }
          for (const a of awards.filter(a => a.amountPaise > 0)) await tx.insert(s.payrollAdjustments).values({ id: randomUUID(), employeeId: a.employeeId,
            periodYear: snapshot.payoutYear, periodMonth: snapshot.payoutMonth, kind: "earning", category: row.kind === "overtime" ? "ot" : row.kind === "bonus" ? "bonus" : "other",
            code: row.kind === "overtime" ? "SYS_OT" : row.kind === "bonus" ? "SYS_BONUS" : "SYS_LEAVE_ENCASH",
            label: row.kind === "overtime" ? "Statutory overtime" : row.kind === "bonus" ? "Annual statutory bonus" : "Worker leave encashment",
            amountPaise: a.amountPaise, esicTreatment: row.kind === "overtime" ? "overtime" : row.kind === "bonus" ? "excluded_50" : snapshot.encashTreatment,
            reason: `${row.kind} register ${id}; ${row.evidence}`,
            sourceKey: `compliance:${id}:${a.employeeId}`, createdBy: user.email, createdAt: now });
          if (row.kind === "worker_leave") {
            const [balance] = await tx.select().from(s.leaveBalances).where(and(eq(s.leaveBalances.employeeId, row.employeeId!), eq(s.leaveBalances.leaveType, "EL"))).for("update");
            const expectedClosing = snapshot.facts.openingDays + snapshot.facts.policyEarnedDays - snapshot.facts.usedDays;
            if (!balance || Math.abs(balance.balanceDays - Math.max(0, expectedClosing)) > .01) throw new Error("Current EL balance does not reconcile with reviewed opening, policy accrual and usage. Reconcile before year-end posting");
            if (balance.asOf > `${row.periodYear}-12-31`) throw new Error("EL balance already includes a later year. Reconcile historical year-end separately instead of overwriting today's balance");
            await tx.update(s.leaveBalances).set({ balanceDays: snapshot.carryDays, asOf: `${row.periodYear + 1}-01-01`, encashable: true }).where(eq(s.leaveBalances.id, balance.id));
          }
          if (row.kind === "bonus" && payout.to > snapshot.dueOn && !snapshot.extensionEvidence) throw new Error("Bonus payment period exceeds the eight-month deadline; a valid extension order is required");
        }
        await tx.update(c.complianceRegisters).set({ status: "posted", reviewedBy: user.email, reviewEvidence: ref, postedAt: now }).where(eq(c.complianceRegisters.id, id));
        await audit(tx, user, "statutory.register.post", id, { kind: row.kind, evidence: ref });
      });
    } else {
      const kind = z.enum(["eps_review", "worker_coverage", "overtime", "bonus", "worker_leave", "filing_validation"]).parse(operation);
      const employee = employeeId ? (await db.select().from(s.employees).where(and(eq(s.employees.id, employeeId), eq(s.employees.companyId, companyId))))[0] : null;
      if (["eps_review", "worker_coverage", "overtime", "worker_leave"].includes(kind) && !employee) throw new Error("Choose an employee of this company");
      let snapshot: Record<string, unknown>, sourceKey: string;
      if (kind === "eps_review") {
        if (!employee!.dateOfBirth || ageAsOfMonth(employee!.dateOfBirth, year, month) === null) throw new Error("Record a verified birth date in employee master first");
        if (employee!.epsMember === null || employee!.epsJoiningWagePaise === null || (employee!.dateOfJoining < "2026-09-17" && employee!.epsMember !== true && employee!.epsRevisionWagePaise === null)) throw new Error("Complete EPS membership/joining/revision wage in Employee Payroll settings first");
        snapshot = { epsMember: employee!.epsMember, joiningWagePaise: employee!.epsJoiningWagePaise,
          revisionWagePaise: employee!.epsRevisionWagePaise, dateOfJoining: employee!.dateOfJoining,
          portalReference: z.string().trim().min(5).parse(fd.get("portalReference")),
          employeeDigest: epsHistoryDigest(employee!) };
        sourceKey = `eps:${employeeId}:${digest(snapshot)}`;
      } else if (kind === "worker_coverage") {
        snapshot = { leaveCovered: fd.get("leaveCovered") === "on", overtimeCovered: fd.get("overtimeCovered") === "on",
          adolescentOrUnderground: fd.get("adolescentOrUnderground") === "on", effectiveFrom: date.parse(fd.get("effectiveFrom")),
          classification: z.string().trim().min(5).max(500).parse(fd.get("classification")) };
        sourceKey = `coverage:${employeeId}:${snapshot.effectiveFrom}`;
      } else if (kind === "overtime") {
        snapshot = { ...await prepareOvertime(companyId, employeeId, year, month, days(fd, "divisor")) };
        sourceKey = `overtime:${employeeId}:${year}:${month}`;
      } else if (kind === "bonus") {
        if (fd.get("bonusApplicabilityReviewed") !== "on") throw new Error("Confirm bonus applicability, statutory exclusions and opening carry against the certified accounts");
        const openingCarry = z.array(z.object({ year: z.number().int().min(1900).max(year - 1), kind: z.enum(["set_on", "set_off"]), amountPaise: z.number().int().nonnegative().safe() })).max(20)
          .parse(JSON.parse(String(fd.get("openingCarryJson") ?? "[]")));
        snapshot = { ...await prepareBonus(companyId, year, paise(fd.get("allocable")), db, openingCarry), extensionEvidence: String(fd.get("extensionEvidence") ?? "").trim() };
        if (`${year + 1}-03-31` >= now.slice(0, 10)) throw new Error("Close the accounting year before annual bonus settlement");
        sourceKey = `bonus:${year}`;
      } else if (kind === "worker_leave") {
        if (employee!.dateOfExit && employee!.dateOfExit <= `${year}-12-31`) throw new Error("Exited workers require leave entitlement to be reconciled in F&F, not queued into a later payroll. Complete that separation review first.");
        if (`${year}-12-31` >= now.slice(0, 10) && !(employee!.dateOfExit && employee!.dateOfExit < now.slice(0, 10))) throw new Error("Year-end posting is available after year close, or on exit");
        snapshot = { ...await prepareWorkerLeave(companyId, employeeId, year, {
          qualifyingDeemedDays: days(fd, "qualifyingDeemedDays"), openingDays: days(fd, "openingDays"), usedDays: days(fd, "usedDays"), refusedDays: days(fd, "refusedDays"),
          policyEarnedDays: days(fd, "policyEarnedDays"), policyCarryCap: days(fd, "policyCarryCap"), encashOnDemandDays: days(fd, "encashOnDemandDays"), dailyWagePaise: paise(fd.get("dailyWage")),
        }), encashTreatment: z.enum(["included", "excluded_50", "excluded"]).parse(fd.get("encashTreatment")) };
        if (Number(snapshot.encashDays) > 0 && Number(snapshot.encashPaise) <= 0) throw new Error("A reviewed statutory daily wage is required for leave encashment");
        sourceKey = `worker_leave:${employeeId}:${year}`;
      } else {
        const data = await operationData(companyId, year, month);
        const quarter = z.coerce.number().int().min(1).max(4).parse(fd.get("quarter"));
        const ledger = data.ledger.filter(l => quarterMonths(quarter).includes(l.month));
        if (!ledger.length || !company.tan) throw new Error("TAN and booked quarter deductions are required");
        for (const l of ledger) {
          if (data.allocations.filter(a => a.ledgerId === l.id).reduce((sum, a) => sum + a.amountPaise, 0) !== l.tdsPaise) throw new Error("Allocate every quarter deduction to deposited challans before validation");
          const pan = validatePan(data.employees.find(e => e.id === l.employeeId)?.pan);
          if (!pan.valid || !pan.isIndividual) throw new Error("Valid individual employee PANs are required for this filing packet");
        }
        const unavailable = storageUnavailable(); if (unavailable) throw new Error(unavailable);
        const file = fd.get("validationFile");
        if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".fvu") || file.size <= 0 || file.size > 512000) throw new Error("Upload the externally validated .fvu artifact (maximum 500 KB)");
        const report = fd.get("validationReport");
        if (!(report instanceof File) || !/\.(pdf|txt)$/i.test(report.name) || report.size <= 0 || report.size > 100000) throw new Error("Upload the successful validation report (PDF/TXT, maximum 100 KB)");
        const toolVersion = z.string().trim().min(3).max(100).parse(fd.get("toolVersion"));
        const validationReference = z.string().trim().min(5).max(200).parse(fd.get("validationReference"));
        const fileKey = `companies/${companyId}/compliance/${randomUUID()}.fvu`;
        if (!isSafeKey(fileKey)) throw new Error("Invalid artifact path");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const error = await trySave(fileKey, bytes); if (error) throw new Error(error);
        const reportKey = fileKey.replace(/\.fvu$/, report.name.toLowerCase().endsWith(".pdf") ? ".pdf" : ".txt");
        const reportBytes = new Uint8Array(await report.arrayBuffer());
        if (report.name.toLowerCase().endsWith(".pdf") && new TextDecoder().decode(reportBytes.slice(0, 5)) !== "%PDF-") throw new Error("The report is not a valid PDF document");
        const reportError = await trySave(reportKey, reportBytes); if (reportError) throw new Error(reportError);
        snapshot = { quarter, inputDigest: filingDigest(data, quarter), artifactKey: fileKey,
          artifactSha256: createHash("sha256").update(bytes).digest("hex"), artifactName: file.name,
          reportKey, reportSha256: createHash("sha256").update(reportBytes).digest("hex"), toolVersion, validationReference };
        sourceKey = `filing:${year}:${quarter}:${snapshot.inputDigest}`;
      }
      if (["bonus", "overtime", "worker_leave"].includes(kind)) {
        snapshot.payoutYear = z.coerce.number().int().min(year).max(2200).parse(fd.get("payoutYear"));
        snapshot.payoutMonth = z.coerce.number().int().min(1).max(12).parse(fd.get("payoutMonth"));
        if (kind === "overtime" && (snapshot.payoutYear !== year || snapshot.payoutMonth !== month)) throw new Error("Overtime must be posted to its attendance period");
      }
      await db.transaction(async tx => {
        await tx.select().from(s.companies).where(eq(s.companies.id, companyId)).for("update");
        const [existing] = await tx.select().from(c.complianceRegisters).where(and(eq(c.complianceRegisters.companyId, companyId), eq(c.complianceRegisters.sourceKey, sourceKey))).for("update");
        if (existing?.status === "posted") throw new Error("This register is already posted; historical evidence cannot be overwritten");
        const id = existing?.id ?? randomUUID();
        const values = { companyId, employeeId: employee?.id ?? null, kind, sourceKey, periodYear: year, periodMonth: month,
          snapshotJson: JSON.stringify(snapshot), evidence: ref, preparedBy: user.email, preparedAt: now };
        if (existing) await tx.update(c.complianceRegisters).set(values).where(eq(c.complianceRegisters.id, id));
        else await tx.insert(c.complianceRegisters).values({ ...values, id });
        await audit(tx, user, "statutory.register.prepare", id, { kind, sourceKey, evidence: ref });
      });
    }
    revalidatePath("/console/statutory/operations"); revalidatePath("/console/statutory"); revalidatePath("/console/compliance");
    return { ok: operation === "post" ? "Posted. Recalculate any affected draft payroll before approval." : "Saved on the audit record." };
  } catch (error) {
    if (error instanceof z.ZodError) return { error: error.issues.map(i => i.message).join("; ") };
    if ((error as { code?: string }).code === "23505") return { error: "This reference or register already exists. Refresh before retrying." };
    console.error("[compliance operations]", error);
    return { error: error instanceof Error && !("code" in error) ? error.message : "The operation could not be saved. Check database migrations and retry." };
  }
}
