"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, canAccessCompany, canActOnPeople } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/log";
import { isLetterType, mergeTemplate } from "@/lib/letters/template";
import { nextRefNo } from "@/lib/letters/fields";

export type LetterIssueState = { error?: string; ok?: string };

async function requireHr(employeeId: string) {
  const user = await getSessionUser();
  if (!user) return { user: null, employee: null, error: "Not authorised." as const };
  if (!canActOnPeople(user)) {
    return { user, employee: null, error: "Your role is read-only." as const };
  }
  const [employee] = await db.select().from(s.employees).where(eq(s.employees.id, employeeId)).limit(1);
  if (!employee) return { user, employee: null, error: "Employee not found." as const };
  if (!canAccessCompany(user, employee.companyId)) {
    return { user, employee: null, error: "Not authorised." as const };
  }
  return { user, employee, error: null };
}

/**
 * Issuing a letter — PRD letter-generation gap. Records what was
 * actually handed over, not a pointer at a template that can change
 * tomorrow: a text letter's final (possibly HR-edited) wording is
 * copied in full, and a file letter records exactly which file it was
 * at the moment of issue.
 */
export async function issueLetter(
  _prev: LetterIssueState,
  fd: FormData,
): Promise<LetterIssueState> {
  const employeeId = String(fd.get("employeeId") ?? "");
  const { user, employee, error } = await requireHr(employeeId);
  if (error || !user || !employee) return { error: error ?? "Not authorised." };

  const type = String(fd.get("type") ?? "");
  if (!isLetterType(type)) return { error: "Unknown letter type." };

  const [template] = await db
    .select()
    .from(s.letterTemplates)
    .where(and(eq(s.letterTemplates.companyId, employee.companyId), eq(s.letterTemplates.type, type)))
    .limit(1);

  if (!template) {
    return { error: "No template is set for this letter — add one under Settings → Letter templates first." };
  }

  const now = new Date().toISOString();
  const refNo = await nextRefNo(employeeId, type, employee.empCode, now.slice(0, 10));

  if (template.mode === "text") {
    const text = String(fd.get("text") ?? "").trim();
    if (!text) return { error: "The letter text is empty." };
    /* A {{field}} still in the text would print as-is on a letter handed
       to someone; it is filled in or taken out first. */
    const blank = mergeTemplate(text, {}).missingFields;
    if (blank.length > 0) {
      return { error: `Fill in or remove before issuing: ${blank.map((k) => `{{${k}}}`).join(", ")}` };
    }
    await db.insert(s.letterIssues).values({
      id: randomUUID(),
      employeeId,
      companyId: employee.companyId,
      type,
      mode: "text",
      text,
      theme: template.theme,
      signatoryName: template.signatoryName,
      signatoryTitle: template.signatoryTitle,
      refNo,
      issuedBy: user.email,
      issuedAt: now,
    });
  } else {
    if (!template.fileKey) return { error: "The template's file is missing — re-upload it under Settings → Letter templates." };
    await db.insert(s.letterIssues).values({
      id: randomUUID(),
      employeeId,
      companyId: employee.companyId,
      type,
      mode: "file",
      fileKey: template.fileKey,
      fileName: template.fileName,
      fileExtension: template.fileExtension,
      refNo,
      issuedBy: user.email,
      issuedAt: now,
    });
  }

  await recordAudit({
    user,
    action: "letter.issued",
    entity: "employee",
    entityId: employeeId,
    after: { type, mode: template.mode },
  });

  revalidatePath(`/console/employees/${employeeId}/letters`);
  return { ok: `Letter ${refNo} issued and added to this employee's record.` };
}


export async function loadIssuedLetters(employeeId: string) {
  return db
    .select()
    .from(s.letterIssues)
    .where(eq(s.letterIssues.employeeId, employeeId))
    .orderBy(desc(s.letterIssues.issuedAt));
}
