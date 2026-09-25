"use server";

import { forEachSelected, type BulkResult } from "@/lib/console/bulk";
import { sendOffer, setBgvStatus } from "./actions";

const JOINERS: [string, string] = ["joiner", "joiners"];

export async function bulkSendOffers(_prev: BulkResult, fd: FormData): Promise<BulkResult> {
  return forEachSelected(fd, { key: "joinerId", action: sendOffer, verb: "marked offer sent", noun: JOINERS });
}

export async function bulkSetBgv(_prev: BulkResult, fd: FormData): Promise<BulkResult> {
  return forEachSelected(fd, { key: "joinerId", action: setBgvStatus, verb: "updated", noun: JOINERS });
}
