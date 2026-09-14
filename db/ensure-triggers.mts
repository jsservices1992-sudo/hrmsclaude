/**
 * Create the append-only triggers on the audit and access logs.
 *
 * `drizzle-kit push` creates tables, not triggers, and a deployment
 * whose companies all arrive through self-serve registration never runs
 * `db:bootstrap` — so without this there is a path to a live instance
 * whose audit log an administrator could quietly edit. Idempotent, so
 * running it after every schema push costs nothing.
 *
 *   DATABASE_URL=… DATABASE_AUTH_TOKEN=… npm run db:triggers
 */

import { createClient } from "@libsql/client";
import { createAuditTriggers, auditTriggersPresent, AUDIT_TRIGGERS } from "./triggers";

const url =
  process.env.DATABASE_URL ?? `file:${process.env.DATABASE_PATH ?? "data/lekha.db"}`;

const client = createClient(
  process.env.DATABASE_AUTH_TOKEN
    ? { url, authToken: process.env.DATABASE_AUTH_TOKEN }
    : { url },
);

await createAuditTriggers(client);

if (!(await auditTriggersPresent(client))) {
  console.error("\n  Triggers could not be created. The audit log is editable.\n");
  process.exit(1);
}

client.close();
console.log(`  ${AUDIT_TRIGGERS.length} append-only triggers in place.`);
