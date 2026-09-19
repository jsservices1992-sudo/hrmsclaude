"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, currentSessionId } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { checkPassword } from "@/lib/auth/signup";
import { recordAudit } from "@/lib/audit/log";
import { validateApplication, type LeaveTypeDef } from "@/lib/attendance/leave";
import {
  restrictedHolidayOptions,
  validateRestrictedHoliday,
} from "@/lib/attendance/restricted";
import {
  checkUpload,
  storageKeyFor,
  DOCUMENT_REQUIREMENTS,
  MAX_FILE_BYTES,
} from "@/lib/storage/rules";
import { save, remove, headHex, storageUnavailable } from "@/lib/storage";
import { dispatchEvent } from "@/lib/webhooks/dispatch";
import { publishedRunFor } from "@/lib/ess/load";
import { applyPunch, clockOf, type DayPunch } from "@/lib/ess/punch-day";
import { validateRegularisation } from "@/lib/ess/regularisation";
import {
  DECLARATION_SECTIONS,
  parseRupeeField,
  checkForSubmission,
  proofSectionsFor,
} from "@/lib/ess/declaration";
import { CURRENT_FY } from "@/lib/tax/fy";
import { profileFieldFor, validateProfileChange } from "@/lib/ess/profile";
import { decideRegularisation } from "@/app/console/attendance/actions";
import { headers } from "next/headers";
import {
  decidePunch,
  DEFAULT_GEOFENCE_METRES,
} from "@/lib/attendance/geofence";
import { formatDate } from "@/lib/format/date";

/** The app runs Indian payroll; attendance minutes are IST. */
const IST_OFFSET_MINUTES = 330;

export type SelfState = { error?: string; ok?: string };

/**
 * Self-service acts on the signed-in person's own record and nothing else.
 * The employee id is never taken from the form — a hidden field is a
 * suggestion, and trusting it is how one employee edits another's data.
 */
async function me() {
  const user = await getSessionUser();
  if (!user?.employeeId) return null;
  const [employee] = await db
    .select()
    .from(s.employees)
    .where(eq(s.employees.id, user.employeeId))
    .limit(1);
  return employee ? { user, employee } : null;
}

function daysBetweenInclusive(from: string, to: string): number {
  return (
    Math.round(
      (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000,
    ) + 1
  );
}

export async function applyForLeave(_prev: SelfState, fd: FormData): Promise<SelfState> {
  const self = await me();
  if (!self) return { error: "Your account is not linked to an employee record." };
  const { user, employee } = self;

  const leaveTypeId = String(fd.get("leaveTypeId") ?? "");
  const fromDate = String(fd.get("fromDate") ?? "");
  const toDate = String(fd.get("toDate") ?? "");
  const halfDay = fd.get("halfDay") === "on";
  const reason = String(fd.get("reason") ?? "").trim() || null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return { error: "Choose the dates you want off." };
  }
  if (toDate < fromDate) return { error: "The end date is before the start date." };
  if (halfDay && fromDate !== toDate) {
    return { error: "A half day can only be taken on a single date." };
  }

  const [type] = await db
    .select()
    .from(s.leaveTypes)
    .where(
      and(eq(s.leaveTypes.id, leaveTypeId), eq(s.leaveTypes.companyId, employee.companyId)),
    )
    .limit(1);
  if (!type) return { error: "Choose a leave type." };

  // Overlapping requests are how the same day gets deducted twice.
  const existing = await db
    .select()
    .from(s.leaveRequests)
    .where(eq(s.leaveRequests.employeeId, employee.id));
  const overlap = existing.find(
    (r) =>
      (r.status === "pending" || r.status === "approved") &&
      r.fromDate <= toDate &&
      r.toDate >= fromDate,
  );
  if (overlap) {
    return {
      error: `You already have ${overlap.status} leave from ${formatDate(overlap.fromDate)} to ${formatDate(overlap.toDate)} that overlaps these dates.`,
    };
  }

  /* A restricted holiday is an allowance spent on one of the company's
     own optional holidays, so the date has to be on the published list.
     Without that check it is simply two more days of casual leave under
     a different name. */
  let restrictedAllowanceLeft: number | null = null;
  if (type.restrictedHoliday) {
    const today = new Date().toISOString().slice(0, 10);
    const year = Number(fromDate.slice(0, 4));
    const holidays = await db
      .select()
      .from(s.holidays)
      .where(eq(s.holidays.companyId, employee.companyId));
    const claimed = existing.filter(
      (r) =>
        r.leaveTypeId === type.id &&
        (r.status === "pending" || r.status === "approved") &&
        r.fromDate.startsWith(String(year)),
    );
    const rh = validateRestrictedHoliday({
      fromDate,
      toDate,
      halfDay,
      options: restrictedHolidayOptions({
        holidays,
        branchId: employee.branchId,
        year,
        claimedDates: claimed.map((r) => r.fromDate),
        today,
      }),
      claimedCount: claimed.length,
      quota: type.annualDays,
    });
    if (!rh.ok) return { error: rh.error };

    /* The allowance is counted from what has actually been claimed, not
       from `leaveBalances` — nothing accrues an optional holiday, so the
       balance row is zero and the day would otherwise be booked as loss
       of pay. An employee docked for taking a holiday the company
       offered them is not a warning, it is a wrong payslip. */
    restrictedAllowanceLeft = type.annualDays - claimed.length;
  }

  const days = halfDay ? 0.5 : daysBetweenInclusive(fromDate, toDate);

  const [balance] = await db
    .select()
    .from(s.leaveBalances)
    .where(
      and(eq(s.leaveBalances.employeeId, employee.id), eq(s.leaveBalances.leaveType, type.name)),
    )
    .limit(1);

  const [exit] = await db
    .select()
    .from(s.exitCases)
    .where(eq(s.exitCases.employeeId, employee.id))
    .limit(1);

  const def: LeaveTypeDef = {
    code: type.code,
    name: type.name,
    annualDays: type.annualDays,
    frequency: type.frequency,
    paid: type.paid,
    accruesDuringProbation: type.accruesDuringProbation,
    carryForwardCap: type.carryForwardCap,
    encashable: type.encashable,
    // Read from the leave type, not assumed: some types allow advance leave.
    allowNegative: type.allowNegative,
    rounding: type.rounding,
  };

  const check = validateApplication({
    type: def,
    days,
    currentBalance: restrictedAllowanceLeft ?? balance?.balanceDays ?? 0,
    onProbation: employee.employmentType === "probation",
    lastWorkingDay: exit?.lastWorkingDay ?? null,
    toDate,
  });
  if (!check.valid) return { error: check.errors.join(" ") };

  const id = randomUUID();
  await db.insert(s.leaveRequests).values({
    id,
    employeeId: employee.id,
    leaveTypeId: type.id,
    fromDate,
    toDate,
    days,
    halfDay,
    reason,
    status: "pending",
    lopDays: check.lopDays,
    approverId: employee.managerId,
    createdAt: new Date().toISOString(),
  });

  await recordAudit({
    user,
    action: "leave.applied",
    entity: "leave_request",
    entityId: id,
    after: { type: type.code, fromDate, toDate, days, lopDays: check.lopDays },
  });

  await dispatchEvent(employee.companyId, "leave_applied", {
    leaveRequestId: id,
    employeeId: employee.id,
    leaveType: type.code,
    fromDate,
    toDate,
    days,
    lopDays: check.lopDays,
  });

  revalidatePath("/me");
  return {
    ok:
      check.lopDays > 0
        ? `Applied for ${days} day(s). ${check.lopDays} of them exceed your balance and will be unpaid if approved.`
        : `Applied for ${days} day(s). It is with your manager.`,
  };
}

export async function cancelLeave(_prev: SelfState, fd: FormData): Promise<SelfState> {
  const self = await me();
  if (!self) return { error: "Your account is not linked to an employee record." };

  const id = String(fd.get("requestId") ?? "");
  const [req] = await db
    .select()
    .from(s.leaveRequests)
    .where(and(eq(s.leaveRequests.id, id), eq(s.leaveRequests.employeeId, self.employee.id)))
    .limit(1);
  if (!req) return { error: "Request not found." };
  if (req.status !== "pending") {
    return { error: `This request is already ${req.status}; ask HR to change it.` };
  }

  await db.update(s.leaveRequests).set({ status: "cancelled" }).where(eq(s.leaveRequests.id, id));
  await recordAudit({
    user: self.user,
    action: "leave.cancelled",
    entity: "leave_request",
    entityId: id,
    before: { status: "pending" },
    after: { status: "cancelled" },
  });

  revalidatePath("/me");
  return { ok: "Cancelled." };
}

/**
 * Manager approval — PRD §3.17. A manager may decide leave only for their
 * own direct reports, checked against the reporting line on the record.
 */
export async function managerDecideLeave(_prev: SelfState, fd: FormData): Promise<SelfState> {
  const self = await me();
  if (!self) return { error: "Your account is not linked to an employee record." };

  const id = String(fd.get("requestId") ?? "");
  const decision = String(fd.get("decision") ?? "");
  const note = String(fd.get("note") ?? "").trim() || null;

  if (decision !== "approved" && decision !== "rejected") {
    return { error: "Approve or reject the request." };
  }
  if (decision === "rejected" && !note) {
    return { error: "A rejection needs a reason your team member can see." };
  }

  const [row] = await db
    .select({ req: s.leaveRequests, emp: s.employees })
    .from(s.leaveRequests)
    .innerJoin(s.employees, eq(s.leaveRequests.employeeId, s.employees.id))
    .where(eq(s.leaveRequests.id, id))
    .limit(1);
  if (!row) return { error: "Request not found." };

  if (row.emp.managerId !== self.employee.id) {
    await recordAudit({
      user: self.user,
      action: "leave.decide.denied",
      entity: "leave_request",
      entityId: id,
      reason: "Not the reporting manager of the applicant",
    });
    return { error: "You can only decide leave for people who report to you." };
  }
  if (row.req.employeeId === self.employee.id) {
    return { error: "You cannot approve your own leave." };
  }
  if (row.req.status !== "pending") {
    return { error: `This request is already ${row.req.status}.` };
  }

  await db
    .update(s.leaveRequests)
    .set({
      status: decision,
      decidedBy: self.user.email,
      decidedAt: new Date().toISOString(),
      decisionNote: note,
    })
    .where(eq(s.leaveRequests.id, id));

  await recordAudit({
    user: self.user,
    action: `leave.${decision}`,
    entity: "leave_request",
    entityId: id,
    before: { status: "pending" },
    after: { status: decision, days: row.req.days },
    reason: note,
  });

  revalidatePath("/me");
  revalidatePath("/console/attendance");
  return { ok: decision === "approved" ? "Approved." : "Rejected, with your reason." };
}

/**
 * An employee uploading their own papers — the thing the PRD wants so that
 * HR "touches a record only to verify, not to type". It can never mark
 * its own upload verified: that is HR's act, not the uploader's.
 */
export async function uploadOwnDocument(_prev: SelfState, fd: FormData): Promise<SelfState> {
  const self = await me();
  if (!self) return { error: "Your account is not linked to an employee record." };
  const { user, employee } = self;

  const docType = String(fd.get("docType") ?? "");
  const requirement = DOCUMENT_REQUIREMENTS.find((r) => r.docType === docType);
  if (!requirement) return { error: "Choose which document this is." };

  const expiresOn = String(fd.get("expiresOn") ?? "").trim() || null;
  if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) {
    return { error: "Enter the expiry date as YYYY-MM-DD." };
  }

  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file." };
  if (file.size > MAX_FILE_BYTES) {
    return { error: `The limit is ${MAX_FILE_BYTES / 1024 / 1024}MB.` };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload({
    declaredMime: file.type,
    sizeBytes: bytes.byteLength,
    headHex: headHex(bytes),
    originalName: file.name,
  });
  if (!check.ok) return { error: check.errors.join(" ") };

  const documentId = randomUUID();
  const key = storageKeyFor({ employeeId: employee.id, documentId, extension: check.extension! });
  const unavailable = storageUnavailable();
  if (unavailable) return { error: unavailable };

  await save(key, bytes);

  try {
    await db.insert(s.employeeDocuments).values({
      id: documentId,
      employeeId: employee.id,
      docType,
      label: requirement.label,
      storageRef: key,
      issuedOn: null,
      expiresOn,
      verified: false,
      restricted: requirement.category === "identity",
      uploadedAt: new Date().toISOString(),
    });
  } catch (e) {
    await remove(key);
    throw e;
  }

  await recordAudit({
    user,
    action: "employee.document_self_uploaded",
    entity: "employee_document",
    entityId: documentId,
    after: { docType, sizeBytes: bytes.byteLength },
  });

  revalidatePath("/me");
  return { ok: `${requirement.label} uploaded. HR will check it against the original.` };
}

/**
 * An employee confirming they physically have an asset issued to them —
 * the record HR relies on when an allocation is disputed later. Only the
 * holder can confirm their own allocation, and only once.
 */
export async function confirmAssetReceipt(_prev: SelfState, fd: FormData): Promise<SelfState> {
  const self = await me();
  if (!self) return { error: "Your account is not linked to an employee record." };
  const { user, employee } = self;

  const allocationId = String(fd.get("allocationId") ?? "");
  const [allocation] = await db
    .select()
    .from(s.assetAllocations)
    .where(
      and(
        eq(s.assetAllocations.id, allocationId),
        eq(s.assetAllocations.employeeId, employee.id),
        isNull(s.assetAllocations.returnedAt),
      ),
    )
    .limit(1);
  if (!allocation) return { error: "Allocation not found." };
  if (allocation.consentedAt) return { error: "Already confirmed." };

  await db
    .update(s.assetAllocations)
    .set({ consentedAt: new Date().toISOString() })
    .where(eq(s.assetAllocations.id, allocationId));

  await recordAudit({
    user,
    action: "asset.receipt_confirmed",
    entity: "asset_allocation",
    entityId: allocationId,
    after: { consentedAt: new Date().toISOString() },
  });

  revalidatePath("/me");
  return { ok: "Thanks — receipt confirmed." };
}

/**
 * Asking for a day's attendance to be corrected.
 *
 * The console could already decide these and the pre-payroll check
 * refuses to be clean while any are pending, but nothing created one.
 * This is the missing half. The original punches stay on the record
 * until an approver acts — the request carries what was asked for.
 */
export async function requestRegularisation(
  _prev: SelfState,
  fd: FormData,
): Promise<SelfState> {
  const self = await me();
  if (!self) return { error: "Your account is not linked to an employee record." };
  const { user, employee } = self;

  const date = String(fd.get("date") ?? "");
  const today = new Date().toISOString().slice(0, 10);

  const [existing] = await db
    .select()
    .from(s.regularisationRequests)
    .where(
      and(
        eq(s.regularisationRequests.employeeId, employee.id),
        eq(s.regularisationRequests.date, date),
        eq(s.regularisationRequests.status, "pending"),
      ),
    )
    .limit(1);

  const periodPublished = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? Boolean(
        await publishedRunFor({
          companyId: employee.companyId,
          year: Number(date.slice(0, 4)),
          month: Number(date.slice(5, 7)),
        }),
      )
    : false;

  const check = validateRegularisation({
    date,
    inTime: String(fd.get("inTime") ?? ""),
    outTime: String(fd.get("outTime") ?? ""),
    reason: String(fd.get("reason") ?? ""),
    today,
    periodPublished,
    hasPendingForDate: Boolean(existing),
  });
  if (!check.ok) return { error: check.error };

  /* What the day says now, so the before-and-after survives the
     decision. A day with no record at all is an absence by omission,
     which is exactly the case people most often need corrected. */
  const [record] = await db
    .select()
    .from(s.attendanceRecords)
    .where(
      and(
        eq(s.attendanceRecords.employeeId, employee.id),
        eq(s.attendanceRecords.date, date),
      ),
    )
    .limit(1);

  const id = randomUUID();
  await db.insert(s.regularisationRequests).values({
    id,
    employeeId: employee.id,
    date,
    originalStatus: record?.status ?? "absent",
    originalPunchesJson: record?.punchesJson ?? "[]",
    requestedPunchesJson: JSON.stringify(check.punches),
    reason: String(fd.get("reason") ?? "").trim(),
    status: "pending",
    createdAt: new Date().toISOString(),
  });

  await recordAudit({
    user,
    action: "regularisation.requested",
    entity: "attendance",
    entityId: `${employee.id}:${date}`,
    before: { status: record?.status ?? "absent", punches: record?.punchesJson ?? "[]" },
    after: { punches: check.punches },
    reason: String(fd.get("reason") ?? "").trim(),
  });

  revalidatePath("/me");
  revalidatePath("/console/attendance");
  return { ok: "Correction sent. You will see the decision here." };
}

/** Withdrawing a correction that has not been decided yet. */
export async function cancelRegularisation(
  _prev: SelfState,
  fd: FormData,
): Promise<SelfState> {
  const self = await me();
  if (!self) return { error: "Your account is not linked to an employee record." };
  const { user, employee } = self;

  const requestId = String(fd.get("requestId") ?? "");
  const [req] = await db
    .select()
    .from(s.regularisationRequests)
    .where(
      and(
        eq(s.regularisationRequests.id, requestId),
        eq(s.regularisationRequests.employeeId, employee.id),
      ),
    )
    .limit(1);
  if (!req) return { error: "Request not found." };
  if (req.status !== "pending") return { error: `This request is already ${req.status}.` };

  await db
    .update(s.regularisationRequests)
    .set({
      status: "rejected",
      decidedBy: user.email,
      decidedAt: new Date().toISOString(),
      decisionNote: "Withdrawn by the employee.",
    })
    .where(eq(s.regularisationRequests.id, requestId));

  await recordAudit({
    user,
    action: "regularisation.withdrawn",
    entity: "attendance",
    entityId: `${employee.id}:${req.date}`,
    before: { status: "pending" },
    after: { status: "withdrawn" },
  });

  revalidatePath("/me");
  revalidatePath("/console/attendance");
  return { ok: "Correction withdrawn." };
}

/**
 * The investment declaration.
 *
 * Saving keeps a draft; submitting is the point at which payroll's TDS
 * projection starts trusting it and the sections claimed become proof
 * tasks for HR. A declaration HR has already locked is not editable
 * here — reopening it is their decision, not the employee's.
 */
export async function saveTaxDeclaration(
  _prev: SelfState,
  fd: FormData,
): Promise<SelfState> {
  const self = await me();
  if (!self) return { error: "Your account is not linked to an employee record." };
  const { user, employee } = self;

  const submitting = String(fd.get("intent") ?? "save") === "submit";

  const [existing] = await db
    .select()
    .from(s.taxDeclarations)
    .where(
      and(
        eq(s.taxDeclarations.employeeId, employee.id),
        eq(s.taxDeclarations.financialYear, CURRENT_FY),
      ),
    )
    .limit(1);

  if (existing?.status === "locked") {
    return {
      error:
        "This year's declaration is locked because the proof window has closed. Ask HR if something needs to change.",
    };
  }

  /* Amounts first: one bad field fails the whole save rather than
     silently storing a zero the employee thinks is a claim. */
  const amounts: Record<string, number> = {};
  for (const d of DECLARATION_SECTIONS) {
    const parsed = parseRupeeField(String(fd.get(d.field) ?? ""));
    if (!parsed.ok) return { error: parsed.error };
    amounts[d.field] = parsed.paise;
  }
  const rent = parseRupeeField(String(fd.get("annualRentPaise") ?? ""));
  if (!rent.ok) return { error: rent.error };
  const voluntary = parseRupeeField(String(fd.get("voluntaryMonthlyPaise") ?? ""));
  if (!voluntary.ok) return { error: voluntary.error };

  const previousSalary = parseRupeeField(String(fd.get("previousSalaryPaise") ?? ""));
  if (!previousSalary.ok) return { error: previousSalary.error };
  const previousTds = parseRupeeField(String(fd.get("previousTdsPaise") ?? ""));
  if (!previousTds.ok) return { error: previousTds.error };
  const previousPt = parseRupeeField(String(fd.get("previousPtPaise") ?? ""));
  if (!previousPt.ok) return { error: previousPt.error };

  const rentCity = String(fd.get("rentCity") ?? "").trim() || null;
  const landlordName = String(fd.get("landlordName") ?? "").trim() || null;
  const landlordPan = String(fd.get("landlordPan") ?? "").trim().toUpperCase() || null;

  if (submitting) {
    const issues = checkForSubmission({
      annualRentPaise: rent.paise,
      landlordName,
      landlordPan,
      rentCity,
    });
    if (issues.length > 0) return { error: issues.map((i) => i.message).join(" ") };
  }

  /* The regime is the employee's to choose until HR locks it. */
  const requestedRegime = String(fd.get("regime") ?? "");
  const regime: "old" | "new" =
    existing?.regimeLocked
      ? existing.regime
      : requestedRegime === "old" || requestedRegime === "new"
        ? requestedRegime
        : (existing?.regime ?? "new");

  const now = new Date().toISOString();
  const values = {
    ...amounts,
    regime,
    annualRentPaise: rent.paise,
    rentCity,
    landlordName,
    landlordPan,
    voluntaryMonthlyPaise: voluntary.paise,
    previousEmployerName: String(fd.get("previousEmployerName") ?? "").trim() || null,
    previousSalaryPaise: previousSalary.paise,
    previousTdsPaise: previousTds.paise,
    previousPtPaise: previousPt.paise,
    selfOrFamilyIsSenior: fd.get("selfOrFamilyIsSenior") === "on",
    parentsAreSenior: fd.get("parentsAreSenior") === "on",
    taxpayerIsSenior: fd.get("taxpayerIsSenior") === "on",
    isSelfOccupied: fd.get("isSelfOccupied") === "on",
    ddbPersonIsSenior: fd.get("ddbPersonIsSenior") === "on",
    dependentDisability: (["none", "normal", "severe"] as const).includes(
      String(fd.get("dependentDisability")) as never,
    )
      ? (String(fd.get("dependentDisability")) as "none" | "normal" | "severe")
      : "none",
    selfDisability: (["none", "normal", "severe"] as const).includes(
      String(fd.get("selfDisability")) as never,
    )
      ? (String(fd.get("selfDisability")) as "none" | "normal" | "severe")
      : "none",
    status: (submitting ? "submitted" : "draft") as "submitted" | "draft",
    submittedAt: submitting ? now : (existing?.submittedAt ?? null),
    updatedAt: now,
  };

  const declarationId = existing?.id ?? randomUUID();
  if (existing) {
    await db
      .update(s.taxDeclarations)
      .set(values)
      .where(eq(s.taxDeclarations.id, existing.id));
  } else {
    await db.insert(s.taxDeclarations).values({
      id: declarationId,
      employeeId: employee.id,
      financialYear: CURRENT_FY,
      ...values,
    });
  }

  if (submitting) {
    /* Each claimed section becomes a proof task. An existing task keeps
       its verification — only the declared amount moves, so HR does not
       re-verify what it already saw. */
    const wanted = proofSectionsFor(amounts, rent.paise);
    const current = await db
      .select()
      .from(s.taxProofs)
      .where(eq(s.taxProofs.declarationId, declarationId));

    for (const row of wanted) {
      const match = current.find((p) => p.section === row.section);
      if (match) {
        if (match.declaredPaise !== row.declaredPaise) {
          await db
            .update(s.taxProofs)
            .set({
              declaredPaise: row.declaredPaise,
              status: "pending",
              verifiedPaise: 0,
              decidedBy: null,
              decidedAt: null,
            })
            .where(eq(s.taxProofs.id, match.id));
        }
      } else {
        await db.insert(s.taxProofs).values({
          id: randomUUID(),
          declarationId,
          section: row.section,
          declaredPaise: row.declaredPaise,
          status: "pending",
          createdAt: now,
        });
      }
    }
    /* A section no longer claimed is no longer anybody's task. */
    for (const p of current) {
      if (!wanted.some((w) => w.section === p.section)) {
        await db.delete(s.taxProofs).where(eq(s.taxProofs.id, p.id));
      }
    }
  }

  await recordAudit({
    user,
    action: submitting ? "tax_declaration.submitted" : "tax_declaration.saved",
    entity: "tax_declaration",
    entityId: declarationId,
    before: existing ? { status: existing.status, regime: existing.regime } : null,
    after: { status: values.status, regime },
  });

  revalidatePath("/me");
  revalidatePath("/console/tax");
  return {
    ok: submitting
      ? "Declaration submitted. HR will ask for proofs for what you have claimed."
      : "Saved as a draft. It does not affect your TDS until you submit it.",
  };
}

/**
 * Asking for your own record to be corrected.
 *
 * Nothing is written onto the employee row here. The request carries
 * what the record says today alongside what it should say, so whoever
 * approves it sees both and the trail survives the decision.
 */
export async function requestProfileChange(
  _prev: SelfState,
  fd: FormData,
): Promise<SelfState> {
  const self = await me();
  if (!self) return { error: "Your account is not linked to an employee record." };
  const { user, employee } = self;

  const field = String(fd.get("field") ?? "");
  const def = profileFieldFor(field);
  if (!def) return { error: "That is not a field you can change here." };

  const current = (employee as unknown as Record<string, string | null>)[field] ?? null;

  /* Evidence for the money-and-tax fields: a bank account changed on an
     unsupported request is the classic payroll fraud, so the document
     has to be on file before the request can even be raised. */
  let hasProof = true;
  if (def.needsProof) {
    const proofTypes = field === "pan" ? ["PAN"] : ["BANK_PROOF"];
    const docs = await db
      .select({ id: s.employeeDocuments.id })
      .from(s.employeeDocuments)
      .where(
        and(
          eq(s.employeeDocuments.employeeId, employee.id),
          inArray(s.employeeDocuments.docType, proofTypes),
        ),
      );
    hasProof = docs.some(Boolean);
  }

  const check = validateProfileChange({
    field,
    requestedValue: String(fd.get("requestedValue") ?? ""),
    currentValue: current,
    hasProof,
  });
  if (!check.ok) return { error: check.error };

  const [existing] = await db
    .select({ id: s.profileChangeRequests.id })
    .from(s.profileChangeRequests)
    .where(
      and(
        eq(s.profileChangeRequests.employeeId, employee.id),
        eq(s.profileChangeRequests.field, field),
        eq(s.profileChangeRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (existing) {
    return { error: `You already have a request waiting for your ${def.label.toLowerCase()}.` };
  }

  const id = randomUUID();
  await db.insert(s.profileChangeRequests).values({
    id,
    employeeId: employee.id,
    field,
    currentValue: current,
    requestedValue: check.value,
    reason: String(fd.get("reason") ?? "").trim() || null,
    status: "pending",
    createdAt: new Date().toISOString(),
  });

  await recordAudit({
    user,
    action: "profile_change.requested",
    entity: "employee",
    entityId: employee.id,
    before: { [field]: def.sensitive ? "«redacted»" : current },
    after: { [field]: def.sensitive ? "«redacted»" : check.value },
    reason: String(fd.get("reason") ?? "").trim() || null,
  });

  revalidatePath("/me");
  revalidatePath("/console/employees");
  return { ok: "Sent to HR. You will see the decision here." };
}

/** Withdrawing a change request that has not been decided. */
export async function cancelProfileChange(
  _prev: SelfState,
  fd: FormData,
): Promise<SelfState> {
  const self = await me();
  if (!self) return { error: "Your account is not linked to an employee record." };
  const { user, employee } = self;

  const requestId = String(fd.get("requestId") ?? "");
  const [req] = await db
    .select()
    .from(s.profileChangeRequests)
    .where(
      and(
        eq(s.profileChangeRequests.id, requestId),
        eq(s.profileChangeRequests.employeeId, employee.id),
      ),
    )
    .limit(1);
  if (!req) return { error: "Request not found." };
  if (req.status !== "pending") return { error: `This request is already ${req.status}.` };

  await db
    .update(s.profileChangeRequests)
    .set({
      status: "rejected",
      decidedBy: user.email,
      decidedAt: new Date().toISOString(),
      decisionNote: "Withdrawn by the employee.",
    })
    .where(eq(s.profileChangeRequests.id, requestId));

  await recordAudit({
    user,
    action: "profile_change.withdrawn",
    entity: "employee",
    entityId: employee.id,
    before: { status: "pending" },
    after: { status: "withdrawn" },
  });

  revalidatePath("/me");
  revalidatePath("/console/employees");
  return { ok: "Request withdrawn." };
}

/**
 * A manager deciding one of their own reports' attendance corrections.
 *
 * The console's version is HR-gated, which left the person who actually
 * knows whether someone was at the client site unable to say so. Being
 * a manager is a fact about the reporting line, not a role, so the
 * check is the reporting line — and it reuses the console's decision
 * path rather than duplicating the apply-and-re-derive logic.
 */
export async function managerDecideRegularisation(
  _prev: SelfState,
  fd: FormData,
): Promise<SelfState> {
  const self = await me();
  if (!self) return { error: "Your account is not linked to an employee record." };

  const requestId = String(fd.get("requestId") ?? "");
  if (!requestId) return { error: "Request not found." };

  /* The reporting-line check lives in the console action, so there is
     one gate and one apply-and-re-derive path rather than two that can
     drift apart. */
  const result = await decideRegularisation({}, fd);
  revalidatePath("/me");
  return result.error ? { error: result.error } : { ok: result.ok };
}

/* ==================== self-service attendance ==================== */

export type PunchState = {
  error?: string;
  ok?: string;
  /** How far the device said it was, so a refusal can be argued with. */
  distanceMetres?: number | null;
};

/**
 * Marks the employee in or out from their own browser.
 *
 * The coordinates are what the device reported and a device can be told
 * to report anything, so this is a deterrent and a record rather than
 * proof of attendance. Every attempt is written down — refused ones
 * especially, because a pattern of tries from three streets away is the
 * thing worth seeing, and only keeping the successes would hide it.
 *
 * The punch itself lands in the same attendance record the biometric and
 * the CSV import write to, so nothing downstream has to know where a
 * minute came from.
 */
export async function punchAttendance(_prev: PunchState, fd: FormData): Promise<PunchState> {
  const ctx = await me();
  if (!ctx) return { error: "Your account is not linked to an employee record." };
  const { employee } = ctx;

  if (employee.status === "exited") {
    return { error: "This record is closed." };
  }

  const kind = String(fd.get("kind") ?? "");
  if (kind !== "in" && kind !== "out") return { error: "Choose in or out." };

  const num = (v: FormDataEntryValue | null) => {
    const n = Number(String(v ?? ""));
    return Number.isFinite(n) ? n : null;
  };
  const latitude = num(fd.get("latitude"));
  const longitude = num(fd.get("longitude"));
  const accuracyMetres = num(fd.get("accuracy"));

  const [branch] = await db
    .select({
      id: s.branches.id,
      name: s.branches.name,
      latitude: s.branches.latitude,
      longitude: s.branches.longitude,
      geofenceMetres: s.branches.geofenceMetres,
    })
    .from(s.branches)
    .where(eq(s.branches.id, employee.branchId))
    .limit(1);

  const decision = decidePunch({
    reported: latitude != null && longitude != null ? { latitude, longitude } : null,
    accuracyMetres,
    office:
      branch?.latitude != null && branch?.longitude != null
        ? { latitude: branch.latitude, longitude: branch.longitude }
        : null,
    geofenceMetres: branch?.geofenceMetres ?? DEFAULT_GEOFENCE_METRES,
  });

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const hdrs = await headers();

  await db.insert(s.attendancePunches).values({
    id: randomUUID(),
    employeeId: employee.id,
    branchId: branch?.id ?? null,
    date,
    at: now.toISOString(),
    kind,
    latitude,
    longitude,
    accuracyMetres,
    distanceMetres: decision.distanceMetres,
    accepted: decision.allowed,
    reason: decision.allowed ? null : decision.reason,
    userAgent: hdrs.get("user-agent")?.slice(0, 300) ?? null,
  });

  if (!decision.allowed) {
    return { error: decision.reason, distanceMetres: decision.distanceMetres };
  }

  /* Minutes since midnight, which is what the attendance record stores
     and what the derivation engine reads. */
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes() + IST_OFFSET_MINUTES;
  const minuteOfDay = ((minute % 1440) + 1440) % 1440;

  const [existing] = await db
    .select()
    .from(s.attendanceRecords)
    .where(and(eq(s.attendanceRecords.employeeId, employee.id), eq(s.attendanceRecords.date, date)))
    .limit(1);

  const existingPunches: DayPunch[] = existing ? JSON.parse(existing.punchesJson) : [];

  const applied = applyPunch(existingPunches, kind, minuteOfDay);
  if (!applied.ok) return { error: applied.error };
  const punches = applied.punches;

  if (existing) {
    await db
      .update(s.attendanceRecords)
      .set({ punchesJson: JSON.stringify(punches), source: "mobile" })
      .where(eq(s.attendanceRecords.id, existing.id));
  } else {
    await db.insert(s.attendanceRecords).values({
      id: randomUUID(),
      employeeId: employee.id,
      date,
      punchesJson: JSON.stringify(punches),
      dayType: "working",
      /* The real status is derived from worked minutes against the shift
         when the month is computed; this is only what it looks like so
         far. */
      status: "present",
      source: "mobile",
    });
  }

  await recordAudit({
    user: ctx.user,
    action: kind === "in" ? "attendance.punched_in" : "attendance.punched_out",
    entity: "attendance_record",
    entityId: employee.id,
    after: { date, minuteOfDay, distanceMetres: decision.distanceMetres },
  });

  revalidatePath("/me");
  const clock = clockOf(minuteOfDay)!;
  return {
    ok:
      kind === "in"
        ? `Punched in at ${clock}, ${decision.distanceMetres}m from ${branch?.name ?? "the office"}.`
        : `Punched out at ${clock}. Today's hours will be totalled when attendance is derived.`,
    distanceMetres: decision.distanceMetres,
  };
}

/* ==================== account ==================== */

/**
 * Changing your own password.
 *
 * The current one is asked for because a signed-in session left open on a
 * shared machine is otherwise enough to lock the owner out of their own
 * payslips. Every other session is then revoked: if the reason for
 * changing it is that somebody else knows it, leaving their session alive
 * defeats the change.
 */
export async function changeOwnPassword(
  _prev: SelfState,
  fd: FormData,
): Promise<SelfState> {
  const self = await me();
  if (!self) return { error: "Your account is not linked to an employee record." };
  const { user } = self;

  const current = String(fd.get("currentPassword") ?? "");
  const next = String(fd.get("newPassword") ?? "");
  const confirm = String(fd.get("confirmPassword") ?? "");

  if (!current || !next) return { error: "Fill in both your current and new password." };
  if (next !== confirm) return { error: "The two new passwords do not match." };
  if (next === current) return { error: "That is the password you already have." };

  const [account] = await db
    .select({ id: s.users.id, passwordHash: s.users.passwordHash })
    .from(s.users)
    .where(eq(s.users.email, user.email))
    .limit(1);
  if (!account) return { error: "Your account could not be read." };

  /* Compared against a dud hash when there is none on record, so a missing
     password takes the same time to fail as a wrong one. */
  const ok = await verifyPassword(current, account.passwordHash ?? "scrypt$00$00");
  if (!ok) return { error: "That is not your current password." };

  const problem = checkPassword(next, { email: user.email });
  if (problem) return { error: problem };

  const now = new Date().toISOString();
  await db
    .update(s.users)
    .set({ passwordHash: await hashPassword(next), passwordSetAt: now })
    .where(eq(s.users.id, account.id));

  const keep = await currentSessionId();
  await db
    .delete(s.sessions)
    .where(
      keep
        ? and(eq(s.sessions.userId, account.id), ne(s.sessions.id, keep))
        : eq(s.sessions.userId, account.id),
    );

  await recordAudit({
    user,
    action: "account.password_changed",
    entity: "user",
    entityId: account.id,
    reason: "Changed by the employee from their own workspace",
  });

  revalidatePath("/me");
  return {
    ok: "Password changed. Any other device you were signed in on has been signed out.",
  };
}
