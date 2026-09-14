import { sql } from "drizzle-orm";
import { db } from "@/db";
import { signupEnabled } from "@/lib/auth/signup";

export const dynamic = "force-dynamic";

/**
 * Is this deployment actually configured?
 *
 * A misconfigured instance fails at the first database query, which is
 * a Server Action, which the browser reports as an opaque 500. This
 * says which piece is missing instead — the single most useful thing
 * to have when a deploy comes up blank.
 *
 * It reports presence and reachability, never values: whether
 * DATABASE_URL is set, not what it is. A health endpoint that echoes
 * its own credentials is worse than no health endpoint.
 */
export async function GET() {
  const checks: Record<string, unknown> = {};

  const databaseUrl = Boolean(process.env.DATABASE_URL);
  const blobToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

  /* In development a local file is the intended setup, so an unset
     DATABASE_URL there is not a fault to report as one. */
  const isProduction = process.env.NODE_ENV === "production";

  checks.database = {
    configured: databaseUrl,
    hint: databaseUrl
      ? undefined
      : isProduction
        ? "DATABASE_URL is not set. Add your PostgreSQL connection string to the deployment's environment variables, then redeploy."
        : "Using a local file — expected in development.",
  };

  checks.documentStorage = {
    configured: blobToken,
hint: blobToken
      ? undefined
      : isProduction
        ? "BLOB_READ_WRITE_TOKEN is not set. Add a Blob store in the Vercel project's Storage tab, then redeploy."
        : "Using the local filesystem — expected in development.",
  };

  /* Reachability and schema in one query: a database that answers but
     has no tables is the other half of a failed deploy, and it fails
     differently — db:push was never run at it. */
  let ok = false;
  if (databaseUrl || !isProduction) {
    try {
      const result = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from information_schema.tables
            where table_schema = 'public'`,
      );
      const tables = Number(result[0]?.n ?? 0);
      ok = tables > 0;
      checks.schema = {
        reachable: true,
        tables,
        hint: ok
          ? undefined
          : "The database is reachable but has no tables. Run: DATABASE_URL=… npm run db:push && npm run db:triggers",
      };
    } catch (error) {
      checks.schema = {
        reachable: false,
        /* The driver's message names the host and the failure mode and
           carries no credential. */
        error: error instanceof Error ? error.message : String(error),
        hint: "The database could not be reached. Check DATABASE_URL, and that the database allows connections from outside its own network.",
      };
    }
  }

  checks.registration = { open: signupEnabled() };

  const healthy = ok && (isProduction ? databaseUrl && blobToken : true);
  return Response.json(
    { healthy, checks },
    { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
