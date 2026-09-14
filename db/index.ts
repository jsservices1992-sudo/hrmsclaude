import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/**
 * The database connection.
 *
 * PostgreSQL, reached over the network from a serverless runtime,
 * which is what shapes every setting below.
 *
 * Connections are the scarce resource. Each concurrent serverless
 * invocation gets its own process and therefore its own pool, so a
 * pool of ten per instance multiplied by however many instances the
 * platform decides to run is how a managed Postgres hits its
 * connection limit and starts refusing everyone — including the
 * instances already running. One connection per instance, released
 * quickly, is the setting that survives that.
 *
 * Money is stored in paise as bigint, not integer: Postgres integers
 * are 32-bit and would cap at about Rs 2.14 crore, wrapping silently
 * on any company whose annual totals exceed it.
 */

const url = process.env.DATABASE_URL;

declare global {
  // eslint-disable-next-line no-var
  var __lekhaDb: ReturnType<typeof createDb> | undefined;
  // eslint-disable-next-line no-var
  var __lekhaSql: ReturnType<typeof postgres> | undefined;
}

function createDb() {
  /* Checked when the connection is first opened rather than at import,
     because the build imports this module to collect page data with
     NODE_ENV already "production" and no database configured. */
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Point it at your PostgreSQL database — see /api/health for what this deployment is missing.",
    );
  }

  const client =
    globalThis.__lekhaSql ??
    postgres(url, {
      /* One per instance. See the note above: pools multiply by
         instance count, and the limit is per database. */
      max: 1,
      /* Hand the connection back quickly so an idle instance is not
         holding a slot another one needs. */
      idle_timeout: 20,
      max_lifetime: 60 * 30,
      connect_timeout: 10,
      /* Managed Postgres requires TLS for connections from outside its
         own network, which is every connection from here. */
      ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : "require",
      /* Prepared statements are per-connection state, which a
         transaction-mode pooler does not preserve. Off, so the app
         behaves the same whether or not a pooler sits in front. */
      prepare: false,
    });

  if (process.env.NODE_ENV !== "production") globalThis.__lekhaSql = client;
  return drizzle(client, { schema });
}

let connection: ReturnType<typeof createDb> | undefined = globalThis.__lekhaDb;

export const db = new Proxy({} as ReturnType<typeof createDb>, {
  get(_target, prop) {
    connection ??= createDb();
    if (process.env.NODE_ENV !== "production") globalThis.__lekhaDb = connection;
    const value = Reflect.get(connection, prop) as unknown;
    /* Bound to the real connection, not to this proxy: a method read
       through a proxy and then called would otherwise run with `this`
       set to the proxy and re-enter the trap. */
    return typeof value === "function" ? value.bind(connection) : value;
  },
});

export { schema };
