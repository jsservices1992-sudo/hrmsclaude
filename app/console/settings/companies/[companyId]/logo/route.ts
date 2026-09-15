import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { read } from "@/lib/storage";
import { getSessionUser, canAccessConsole, canAccessCompany } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Serves the uploaded company logo.
 *
 * Through the application rather than from a public bucket, for the same
 * reason every other stored file is: knowing a key is not the same as
 * being allowed to read it. A logo is hardly a secret, but the store
 * holds PAN cards next to it and opening one path to the world is how
 * the next one gets opened too.
 *
 * Cached privately and briefly — it appears on every payslip on screen,
 * and re-reading it from object storage for each row is waste.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ companyId: string }> },
) {
  const user = await getSessionUser();
  if (!user || !canAccessConsole(user)) {
    return new Response("Not authorised.", { status: 403 });
  }

  const { companyId } = await ctx.params;
  if (!canAccessCompany(user, companyId)) {
    return new Response("Not authorised.", { status: 403 });
  }

  const [company] = await db
    .select({ logoUrl: s.companies.logoUrl })
    .from(s.companies)
    .where(eq(s.companies.id, companyId))
    .limit(1);
  if (!company?.logoUrl) return new Response("No logo.", { status: 404 });

  /* The extension is not in the row — it is whichever of the two was
     uploaded, so both are tried rather than stored redundantly. */
  for (const [extension, type] of [
    ["png", "image/png"],
    ["jpg", "image/jpeg"],
  ] as const) {
    const bytes = await read(`companies/${companyId}/logo.${extension}`);
    if (bytes) {
      return new Response(Buffer.from(bytes), {
        headers: {
          "content-type": type,
          "cache-control": "private, max-age=300",
        },
      });
    }
  }

  return new Response("The record points at a logo that is not in storage.", { status: 410 });
}
