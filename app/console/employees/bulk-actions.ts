"use server";

import { inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { forEachSelected, selectedIds, type BulkResult } from "@/lib/console/bulk";
import { decideProfileChange, inviteEmployee } from "./actions";

/** Portal invitations for everybody ticked — each through the single invite. */
export async function bulkInviteEmployees(_prev: BulkResult, fd: FormData): Promise<BulkResult> {
  const ids = selectedIds(fd);
  const people = ids.length
    ? await db
        .select({ id: s.employees.id, firstName: s.employees.firstName, lastName: s.employees.lastName })
        .from(s.employees)
        .where(inArray(s.employees.id, ids))
    : [];
  const nameOf = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
  return forEachSelected(fd, {
    ids,
    key: "employeeId",
    action: inviteEmployee,
    verb: "invited to the portal",
    noun: ["employee", "employees"],
    labelFor: (id) => nameOf.get(id) ?? id,
  });
}

export async function bulkDecideProfileChanges(_prev: BulkResult, fd: FormData): Promise<BulkResult> {
  return forEachSelected(fd, {
    key: "requestId",
    action: decideProfileChange,
    verb: fd.get("decision") === "rejected" ? "rejected" : "approved",
    noun: ["request", "requests"],
  });
}
