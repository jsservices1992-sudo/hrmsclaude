import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";

export type AssetRow = {
  asset: typeof s.assets.$inferSelect;
  holder: { id: string; name: string; empCode: string } | null;
  allocationId: string | null;
  issuedAt: string | null;
};

/** Every asset for a company, with whoever currently holds it, if anyone. */
export async function listAssets(companyId: string): Promise<AssetRow[]> {
  const rows = await db
    .select()
    .from(s.assets)
    .where(eq(s.assets.companyId, companyId))
    .orderBy(desc(s.assets.createdAt));

  const openAllocations = await db
    .select({ alloc: s.assetAllocations, emp: s.employees })
    .from(s.assetAllocations)
    .innerJoin(s.employees, eq(s.assetAllocations.employeeId, s.employees.id))
    .where(isNull(s.assetAllocations.returnedAt));

  const holderByAsset = new Map(
    openAllocations.map((r) => [
      r.alloc.assetId,
      {
        holder: { id: r.emp.id, name: `${r.emp.firstName} ${r.emp.lastName}`, empCode: r.emp.empCode },
        allocationId: r.alloc.id,
        issuedAt: r.alloc.issuedAt,
      },
    ]),
  );

  return rows.map((asset) => {
    const open = holderByAsset.get(asset.id);
    return {
      asset,
      holder: open?.holder ?? null,
      allocationId: open?.allocationId ?? null,
      issuedAt: open?.issuedAt ?? null,
    };
  });
}

export async function loadAsset(assetId: string) {
  const [asset] = await db.select().from(s.assets).where(eq(s.assets.id, assetId)).limit(1);
  if (!asset) return null;

  const history = await db
    .select({ alloc: s.assetAllocations, emp: s.employees })
    .from(s.assetAllocations)
    .innerJoin(s.employees, eq(s.assetAllocations.employeeId, s.employees.id))
    .where(eq(s.assetAllocations.assetId, assetId))
    .orderBy(desc(s.assetAllocations.issuedAt));

  const open = history.find((h) => !h.alloc.returnedAt) ?? null;

  return { asset, history, open };
}

/** Assets currently issued to one employee — for the employee page's Assets tab. */
export async function loadEmployeeAssets(employeeId: string) {
  return db
    .select({ alloc: s.assetAllocations, asset: s.assets })
    .from(s.assetAllocations)
    .innerJoin(s.assets, eq(s.assetAllocations.assetId, s.assets.id))
    .where(and(eq(s.assetAllocations.employeeId, employeeId), isNull(s.assetAllocations.returnedAt)));
}

/** Full allocation history for one employee — issued and returned. */
export async function loadEmployeeAssetHistory(employeeId: string) {
  return db
    .select({ alloc: s.assetAllocations, asset: s.assets })
    .from(s.assetAllocations)
    .innerJoin(s.assets, eq(s.assetAllocations.assetId, s.assets.id))
    .where(eq(s.assetAllocations.employeeId, employeeId))
    .orderBy(desc(s.assetAllocations.issuedAt));
}
