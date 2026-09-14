import type { Client } from "@libsql/client";

/**
 * Append-only enforcement for the audit log — PRD §3.15, FR-AUD-1:
 * "Entries cannot be edited or deleted by any role, including tenant
 * administrators."
 *
 * A convention that the application only ever inserts is not that. The
 * guarantee has to sit below the application, where a bug, a console
 * session or a compromised admin account cannot route around it.
 */

export const AUDIT_TRIGGERS = [
  {
    name: "audit_log_no_update",
    sql: `CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only: entries cannot be edited');
END;`,
  },
  {
    name: "audit_log_no_delete",
    sql: `CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only: entries cannot be deleted');
END;`,
  },
  {
    name: "access_log_no_update",
    sql: `CREATE TRIGGER access_log_no_update BEFORE UPDATE ON access_log
BEGIN
  SELECT RAISE(ABORT, 'access_log is append-only: entries cannot be edited');
END;`,
  },
  {
    name: "access_log_no_delete",
    sql: `CREATE TRIGGER access_log_no_delete BEFORE DELETE ON access_log
BEGIN
  SELECT RAISE(ABORT, 'access_log is append-only: entries cannot be deleted');
END;`,
  },
];

export async function createAuditTriggers(client: Client): Promise<void> {
  for (const trigger of AUDIT_TRIGGERS) {
    await client.execute(`DROP TRIGGER IF EXISTS ${trigger.name}`);
    await client.execute(trigger.sql);
  }
}

/**
 * Only the development seed calls this, and only to wipe a throwaway
 * database. There is deliberately no application path that drops these.
 */
export async function dropAuditTriggers(client: Client): Promise<void> {
  for (const trigger of AUDIT_TRIGGERS) {
    await client.execute(`DROP TRIGGER IF EXISTS ${trigger.name}`);
  }
}

export async function auditTriggersPresent(client: Client): Promise<boolean> {
  const result = await client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN (${AUDIT_TRIGGERS.map(() => "?").join(",")})`,
    args: AUDIT_TRIGGERS.map((t) => t.name),
  });
  return result.rows.length === AUDIT_TRIGGERS.length;
}
