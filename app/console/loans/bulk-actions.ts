"use server";

import { forEachSelected, type BulkResult } from "@/lib/console/bulk";
import { holdLoan, resumeLoan } from "./actions";

export async function bulkHoldLoans(_prev: BulkResult, fd: FormData): Promise<BulkResult> {
  return forEachSelected(fd, { key: "loanId", action: holdLoan, verb: "put on hold", noun: ["loan", "loans"] });
}

export async function bulkResumeLoans(_prev: BulkResult, fd: FormData): Promise<BulkResult> {
  return forEachSelected(fd, { key: "loanId", action: resumeLoan, verb: "resumed", noun: ["loan", "loans"] });
}
