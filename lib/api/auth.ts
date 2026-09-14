import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { hashApiKey, looksLikeApiKey } from "@/lib/auth/apikeys";

export type ApiPrincipal = {
  keyId: string;
  companyId: string;
  compensationScope: "none" | "company";
};

export type ApiAuthResult =
  | { ok: true; principal: ApiPrincipal }
  | { ok: false; status: 401; error: string };

/**
 * REST API authentication — PRD §3.18.
 *
 * A key is looked up by the SHA-256 hash of the full token, not by the
 * displayed prefix — the prefix exists for a human to recognise a key in
 * a list, not to authenticate with. A revoked or otherwise inactive key
 * fails the same as an unknown one, so a caller cannot distinguish
 * "revoked" from "never existed" by probing.
 */
export async function authenticateApiRequest(request: Request): Promise<ApiAuthResult> {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token || !looksLikeApiKey(token)) {
    return { ok: false, status: 401, error: "Provide a valid API key as `Authorization: Bearer <key>`." };
  }

  const hash = hashApiKey(token);
  const [row] = await db.select().from(s.apiKeys).where(eq(s.apiKeys.hash, hash)).limit(1);
  if (!row || !row.active) {
    return { ok: false, status: 401, error: "That key is invalid or has been revoked." };
  }

  // Best-effort — a failed write here should never turn into a 500 for the caller.
  try {
    await db
      .update(s.apiKeys)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(s.apiKeys.id, row.id));
  } catch {
    /* the request still succeeds even if this bookkeeping write fails */
  }

  return {
    ok: true,
    principal: {
      keyId: row.id,
      companyId: row.companyId,
      compensationScope: row.compensationScope,
    },
  };
}

export function unauthorized(error: string) {
  return Response.json({ error }, { status: 401 });
}
