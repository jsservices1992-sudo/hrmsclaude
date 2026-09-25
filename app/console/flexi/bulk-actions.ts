"use server";

import { forEachSelected, type BulkResult } from "@/lib/console/bulk";
import { decideClaim } from "./actions";

export async function bulkDecideClaims(_prev: BulkResult, fd: FormData): Promise<BulkResult> {
  return forEachSelected(fd, {
    key: "claimId",
    action: decideClaim,
    verb: fd.get("decision") === "rejected" ? "rejected" : "approved",
    noun: ["claim", "claims"],
  });
}
