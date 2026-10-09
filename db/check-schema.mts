import postgres from "postgres";
import { schemaReadiness } from "./schema-readiness";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required for the read-only schema check");
const target = new URL(url);
const client = postgres(url, { max: 1, prepare: false, connect_timeout: 10,
  ssl: ["localhost", "127.0.0.1"].includes(target.hostname) ? false : "require" });
try {
  const columns = await client<{ table_name: string; column_name: string }[]>`
    select table_name, column_name from information_schema.columns where table_schema = 'public'`;
  const result = schemaReadiness(columns);
  if (!result.ready) {
    console.error("Database schema is behind this release. Back up, then run npm run db:migrate.");
    console.error(result.missing.join("\n"));
    process.exitCode = 1;
  } else console.log("Database schema is compatible with this release.");
} finally { await client.end(); }
