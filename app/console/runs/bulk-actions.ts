"use server";

import { forEachSelected, type BulkResult } from "@/lib/console/bulk";
import { approveRun, reopenRun } from "@/app/console/payroll/actions";

export async function bulkApproveRuns(_prev: BulkResult, fd: FormData): Promise<BulkResult> {
  return forEachSelected(fd, { key: "runId", action: approveRun, verb: "approved", noun: ["run", "runs"] });
}

export async function bulkReopenRuns(_prev: BulkResult, fd: FormData): Promise<BulkResult> {
  return forEachSelected(fd, { key: "runId", action: reopenRun, verb: "reopened", noun: ["run", "runs"] });
}
