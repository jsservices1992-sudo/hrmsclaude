import "server-only";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

/**
 * The database connection.
 *
 * libSQL rather than better-sqlite3, because the product is deployed to
 * a serverless platform where there is no persistent filesystem: a
 * native driver writing to a local file loses the entire database on
 * every redeploy. libSQL speaks the same SQLite dialect — the schema in
 * `schema.ts` is unchanged — but reaches a hosted database over the
 * network, and the same client also opens a plain local file, so
 * development and production run one code path rather than two that
 * drift.
 *
 * The consequence that matters is that every query is now genuinely
 * asynchronous, including inside transactions. A forgotten `await` used
 * to be harmless; it is now a write that may never land. The
 * `no-floating-promises` lint rule exists to catch exactly that.
 */

declare global {
  // eslint-disable-next-line no-var
  var __lekhaDb: ReturnType<typeof createDb> | undefined;
}

function createDb() {
  const url =
    process.env.DATABASE_URL ?? `file:${process.env.DATABASE_PATH ?? "./data/lekha.db"}`;
  const authToken = process.env.DATABASE_AUTH_TOKEN;

  /* Checked when the connection is first opened rather than when this
     module is imported: the build imports it to collect page data, with
     NODE_ENV already "production" and no database configured, so a
     module-level throw fails every build. A deployment that is actually
     missing DATABASE_URL still fails, on its first query, loudly. */
  if (!process.env.DATABASE_URL && process.env.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL is not set. A production deployment has no durable local filesystem, so a file-backed database would be lost on the next deploy.",
    );
  }

  const client = createClient(authToken ? { url, authToken } : { url });
  return drizzle(client, { schema });
}

/* Opened on first use, and reused across hot reloads so development does
   not open a handle per request. */
let connection: ReturnType<typeof createDb> | undefined = globalThis.__lekhaDb;

export const db = new Proxy({} as ReturnType<typeof createDb>, {
  get(_target, prop, receiver) {
    connection ??= createDb();
    if (process.env.NODE_ENV !== "production") globalThis.__lekhaDb = connection;
    return Reflect.get(connection, prop, receiver);
  },
});

export { schema };
