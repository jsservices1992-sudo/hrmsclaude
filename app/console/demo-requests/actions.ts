"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { canManageSharedStatutory } from "@/lib/auth/permissions";

const STATUSES = ["new", "contacted", "closed"] as const;

/** Moves a demo request along — operator only, like the list itself. */
export async function setDemoStatus(fd: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user || !canManageSharedStatutory(user)) return;
  const id = String(fd.get("id") ?? "");
  const status = String(fd.get("status") ?? "") as (typeof STATUSES)[number];
  if (!id || !STATUSES.includes(status)) return;
  await db.update(s.demoRequests).set({ status }).where(eq(s.demoRequests.id, id));
  revalidatePath("/console/demo-requests");
}
