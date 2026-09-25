"use server";

import { inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { forEachSelected, selectedIds, type BulkResult } from "@/lib/console/bulk";
import { setRegime, verifyProof, type TaxState } from "./actions";

/**
 * Verify or reject every ticked proof. Verifying admits each one at the
 * amount it declared — the figure the single form starts from — and the
 * single action still caps and checks it.
 */
export async function bulkDecideProofs(_prev: BulkResult, fd: FormData): Promise<BulkResult> {
  const ids = selectedIds(fd);
  const rejecting = fd.get("decision") === "rejected";
  const declared = new Map<string, number>();
  if (!rejecting && ids.length) {
    const rows = await db
      .select({ id: s.taxProofs.id, declaredPaise: s.taxProofs.declaredPaise })
      .from(s.taxProofs)
      .where(inArray(s.taxProofs.id, ids));
    for (const r of rows) declared.set(r.id, r.declaredPaise);
  }
  const atDeclared = (prev: TaxState, one: FormData) => {
    if (!rejecting) one.set("verifiedRupees", String(Math.round((declared.get(String(one.get("proofId"))) ?? 0) / 100)));
    return verifyProof(prev, one);
  };
  return forEachSelected(fd, {
    ids,
    key: "proofId",
    action: atDeclared,
    verb: rejecting ? "rejected" : "verified",
    noun: ["proof", "proofs"],
  });
}

export async function bulkSetRegime(_prev: BulkResult, fd: FormData): Promise<BulkResult> {
  return forEachSelected(fd, { key: "employeeId", action: setRegime, verb: `moved to the ${fd.get("regime")} regime`, noun: ["employee", "employees"] });
}
