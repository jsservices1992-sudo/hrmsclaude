import type { Config } from "drizzle-kit";

/**
 * Schema management against the configured PostgreSQL database.
 *
 * There is no local fallback: pushing a schema at whatever database
 * happens to be default is how the wrong one gets altered.
 *
 * TLS is explicit. A managed Postgres refuses unencrypted connections
 * from outside its own network, and drizzle-kit's driver does not
 * infer that from the URL — so without this it opens a connection that
 * the server will not complete, and the push hangs on "Pulling schema"
 * rather than failing with something you could act on.
 */
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("Set DATABASE_URL to the database you are pushing the schema at.");
}

const isLocal = url.includes("localhost") || url.includes("127.0.0.1");

export default {
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  },
} satisfies Config;
