"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { filingDigest, operationData, periodLiabilities } from "@/lib/statutory/operations";
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
  if (!filingKey || !kind || !Number.isInteger(periodYear) || periodYear < 2000 || periodYear > 2200 || !Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12
    || filingKey !== `${kind}:${stateCode ?? "-"}:${periodYear}:${String(periodMonth).padStart(2, "0")}`) {
    return { error: "That filing could not be identified." };
  }
  if (status === "filed" && kind === "tds_24q") {
    const data = await operationData(companyId, periodYear, periodMonth);
    const quarter = periodMonth <= 3 ? 4 : Math.floor((periodMonth - 4) / 3) + 1;
    const verified = data.registers.some(r => {
      if (r.kind !== "filing_validation" || r.status !== "posted") return false;
      const snapshot = JSON.parse(r.snapshotJson);
      return snapshot.quarter === quarter && snapshot.inputDigest === filingDigest(data, quarter);
    });
    if (!verified) return { error: "Form 138 needs a reviewed, current RPU/FVU validation artifact and report. Complete Compliance operations > Deposits & filing before recording the portal acknowledgement." };
  }
  const depositSchemes: Record<string, string> = { tds_deposit: "tds", epf_ecr: "epf", esic_contribution: "esic", pt_return: "pt", lwf_return: "lwf" };
  const depositScheme = depositSchemes[kind];
  if (status === "filed" && depositScheme) {
    const data = await operationData(companyId, periodYear, periodMonth);
    const liabilities = await periodLiabilities(companyId, periodYear, periodMonth);
    const liability = liabilities.rows.find(r => r.scheme === depositScheme && r.stateCode === (stateCode ?? "-"));
    const deposited = data.deposits.filter(d => d.scheme === depositScheme && d.stateCode === (stateCode ?? "-") && d.periodYear === periodYear && d.periodMonth === periodMonth)
      .reduce((sum, d) => sum + d.amountPaise, 0);
    if (!liability || deposited !== liability.amountPaise) return { error: "Record and reconcile the deposited challan under Compliance operations before marking this obligation filed." };
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
