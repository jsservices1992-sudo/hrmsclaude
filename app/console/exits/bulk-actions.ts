"use server";

import { forEachSelected, type BulkResult } from "@/lib/console/bulk";
import { acceptExit } from "./actions";
import { prepareSettlement } from "./fnf-actions";

export async function bulkAcceptExits(_prev: BulkResult, fd: FormData): Promise<BulkResult> {
  return forEachSelected(fd, { key: "exitId", action: acceptExit, verb: "accepted", noun: ["exit", "exits"] });
}

export async function bulkPrepareSettlements(_prev: BulkResult, fd: FormData): Promise<BulkResult> {
  return forEachSelected(fd, { key: "exitCaseId", action: prepareSettlement, verb: "drafted", noun: ["settlement", "settlements"] });
}
