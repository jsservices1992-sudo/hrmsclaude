"use server";

import { forEachSelected, selectedIds, type BulkResult } from "@/lib/console/bulk";
import {
  addVariablePayBulk,
  clearAttendanceOverride,
  decideLeave,
  decideRegularisation,
  markAttendanceDay,
  overrideAttendanceInput,
  removeAdjustment,
} from "./actions";

const PEOPLE: [string, string] = ["person", "people"];

export async function bulkMarkDay(_prev: BulkResult, fd: FormData): Promise<BulkResult> {
  return forEachSelected(fd, { key: "employeeId", action: markAttendanceDay, verb: "marked", noun: PEOPLE });
}

export async function bulkSetLop(_prev: BulkResult, fd: FormData): Promise<BulkResult> {
  return forEachSelected(fd, { key: "employeeId", action: overrideAttendanceInput, verb: "overridden", noun: PEOPLE });
}

export async function bulkClearOverride(_prev: BulkResult, fd: FormData): Promise<BulkResult> {
  return forEachSelected(fd, { key: "employeeId", action: clearAttendanceOverride, verb: "put back on attendance", noun: PEOPLE });
}

/** The same amount for each ticked person, through the batch variable-pay action. */
export async function bulkAddPayItem(_prev: BulkResult, fd: FormData): Promise<BulkResult> {
  const ids = selectedIds(fd);
  if (ids.length === 0) return { error: "Nothing is selected." };
  const amount = String(fd.get("amount") ?? "").trim();
  if (!amount) return { error: "Enter an amount." };
  const batch = new FormData();
  for (const k of ["companyId", "year", "month", "typeId", "reason"]) {
    const v = fd.get(k);
    if (v != null) batch.set(k, v);
  }
  for (const id of ids) batch.set(`amount:${id}`, amount);
  return addVariablePayBulk({}, batch);
}

/** Leave and corrections share one list, so each id says which it is. */
export async function bulkDecideRequests(_prev: BulkResult, fd: FormData): Promise<BulkResult> {
  const ids = selectedIds(fd);
  const leave = ids.filter((i) => i.startsWith("leave:")).map((i) => i.slice(6));
  const reg = ids.filter((i) => i.startsWith("reg:")).map((i) => i.slice(4));
  const verb = fd.get("decision") === "rejected" ? "rejected" : "approved";
  const a = leave.length
    ? await forEachSelected(fd, { ids: leave, key: "requestId", action: decideLeave, verb, noun: ["leave request", "leave requests"] })
    : {};
  const b = reg.length
    ? await forEachSelected(fd, { ids: reg, key: "requestId", action: decideRegularisation, verb, noun: ["correction", "corrections"] })
    : {};
  const join = (x?: string, y?: string) => [x, y].filter(Boolean).join(" ") || undefined;
  return { ok: join(a.ok, b.ok), error: join(a.error, b.error) ?? (ids.length ? undefined : "Nothing is selected.") };
}

export async function bulkRemoveAdjustments(_prev: BulkResult, fd: FormData): Promise<BulkResult> {
  return forEachSelected(fd, { key: "id", action: removeAdjustment, verb: "removed", noun: ["item", "items"] });
}
