import type { Config } from "drizzle-kit";

/**
 * Schema management against whichever database is configured.
 *
 * Turso when DATABASE_URL is set — which is how a deployment's schema is
 * pushed, from a developer's machine pointed at the hosted database.
 * A local file otherwise, for development.
 *
 * The dialect differs between the two ("turso" carries an auth token,
 * "sqlite" does not), so this picks rather than templating one shape.
 */
const url = process.env.DATABASE_URL;

export default (
  url
    ? {
        schema: "./db/schema.ts",
        out: "./db/migrations",
        dialect: "turso",
        dbCredentials: { url, authToken: process.env.DATABASE_AUTH_TOKEN },
      }
    : {
        schema: "./db/schema.ts",
        out: "./db/migrations",
        dialect: "sqlite",
        dbCredentials: { url: process.env.DATABASE_PATH ?? "./data/lekha.db" },
      }
) satisfies Config;
