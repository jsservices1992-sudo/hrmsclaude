import type { Config } from "drizzle-kit";

/**
 * Schema management against the configured PostgreSQL database.
 *
 * There is no local fallback: pushing a schema at whatever database
 * happens to be default is how the wrong one gets altered.
 */
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("Set DATABASE_URL to the database you are pushing the schema at.");
}

export default {
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
} satisfies Config;
