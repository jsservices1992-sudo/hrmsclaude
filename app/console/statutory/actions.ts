"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  getSessionUser,
  canMutate,
  canAccessCompany,
} from "@/lib/auth/session";

export type FilingState = { error?: string; ok?: string };

/**
 * Recording a filing. The acknowledgement number is the point of this —
 * a filing marked done with no reference is not evidence of anything, so
 * it is required rather than optional.
 */
export async function recordFiling(
  _prev: FilingState,
  fd: FormData,
): Promise<FilingState> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authorised." };
  if (!canMutate(user)) {
    return { error: "Only payroll may record a statutory filing." };
  }

  const companyId = String(fd.get("companyId") ?? "");
  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };

  const filingKey = String(fd.get("filingKey") ?? "");
  const kind = String(fd.get("kind") ?? "");
  const stateCode = String(fd.get("stateCode") ?? "") || null;
  const periodYear = Number(fd.get("periodYear"));
  const periodMonth = Number(fd.get("periodMonth"));
  const status = String(fd.get("status") ?? "");
  const reference = String(fd.get("reference") ?? "").trim() || null;

  if (status !== "in_progress" && status !== "filed") {
    return { error: "Choose whether this is in progress or filed." };
  }
  if (status === "filed" && !reference) {
    return {
      error:
        "A filing needs its acknowledgement number. Without one there is nothing to prove it was lodged.",
    };
  }
  if (!filingKey || !kind || !Number.isInteger(periodYear) || !Number.isInteger(periodMonth)) {
    return { error: "That filing could not be identified." };
  }

  const now = new Date().toISOString();

  const [existing] = await db
    .select()
    .from(s.statutoryFilings)
    .where(
      and(
        eq(s.statutoryFilings.companyId, companyId),
        eq(s.statutoryFilings.filingKey, filingKey),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(s.statutoryFilings)
      .set({
        status,
        filingReference: reference,
        owner: user.email,
        filedAt: status === "filed" ? now.slice(0, 10) : null,
        updatedAt: now,
      })
      .where(eq(s.statutoryFilings.id, existing.id));
  } else {
    await db.insert(s.statutoryFilings).values({
      id: randomUUID(),
      companyId,
      filingKey,
      kind,
      stateCode,
      periodYear,
      periodMonth,
      status,
      filingReference: reference,
      owner: user.email,
      filedAt: status === "filed" ? now.slice(0, 10) : null,
      updatedAt: now,
    });
  }

  await db.insert(s.auditLog).values({
    id: randomUUID(),
    at: now,
    actor: user.email,
    action: `statutory_filing.${status}`,
    entity: "statutory_filing",
    entityId: filingKey,
    before: existing ? JSON.stringify({ status: existing.status }) : null,
    after: JSON.stringify({ status, reference }),
    reason: null,
  });

  revalidatePath("/console/statutory");
  return {
    ok:
      status === "filed"
        ? `Recorded as filed against ${reference}.`
        : "Marked as in progress.",
  };
}
