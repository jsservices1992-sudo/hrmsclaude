"use server";

import { and, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { forEachSelected, selectedIds, type BulkResult } from "@/lib/console/bulk";
import { retireAsset, revokeAsset, type AssetState } from "./actions";

export async function bulkRetireAssets(_prev: BulkResult, fd: FormData): Promise<BulkResult> {
  return forEachSelected(fd, { key: "assetId", action: retireAsset, verb: "retired", noun: ["asset", "assets"] });
}

/** The list ticks assets; a return closes the allocation each one is out on. */
export async function bulkReturnAssets(_prev: BulkResult, fd: FormData): Promise<BulkResult> {
  const ids = selectedIds(fd);
  const open = ids.length
    ? await db
        .select({ id: s.assetAllocations.id, assetId: s.assetAllocations.assetId })
        .from(s.assetAllocations)
        .where(and(inArray(s.assetAllocations.assetId, ids), isNull(s.assetAllocations.returnedAt)))
    : [];
  const allocationOf = new Map(open.map((a) => [a.assetId, a.id]));
  const returnOne = (prev: AssetState, one: FormData) => {
    const allocationId = allocationOf.get(String(one.get("assetId")));
    if (!allocationId) return Promise.resolve({ error: "Not issued to anybody." });
    one.set("allocationId", allocationId);
    return revokeAsset(prev, one);
  };
  return forEachSelected(fd, { ids, key: "assetId", action: returnOne, verb: "returned", noun: ["asset", "assets"] });
}
