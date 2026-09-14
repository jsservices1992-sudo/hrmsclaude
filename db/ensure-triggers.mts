/**
 * Create the append-only triggers on the audit and access logs.
 *
 * `drizzle-kit push` creates tables, not triggers, and a deployment
 * whose companies all arrive through self-serve registration never runs
 * `db:bootstrap` — so without this there is a path to a live instance
 * whose audit log an administrator could quietly edit. Idempotent, so
 * running it after every schema push costs nothing.
 *
 *   DATABASE_URL=… npm run db:triggers
 */

import postgres from "postgres";
import { createAuditTriggers, auditTriggersPresent, APPEND_ONLY_TABLES } from "./triggers";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("\n  Set DATABASE_URL to the database you are protecting.\n");
  process.exit(1);
}

const sql = postgres(url, {
  max: 1,
  ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : "require",
  prepare: false,
});

await createAuditTriggers(sql);

if (!(await auditTriggersPresent(sql))) {
  console.error("\n  Triggers could not be created. The audit log is editable.\n");
  process.exit(1);
}

await sql.end();
console.log(`  ${APPEND_ONLY_TABLES.length} tables are append-only.`);
