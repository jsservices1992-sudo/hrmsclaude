import type { Sql } from "postgres";

/**
 * Append-only enforcement for the audit and access logs — PRD §3.15,
 * FR-AUD-1: "Entries cannot be edited or deleted by any role, including
 * tenant administrators."
 *
 * A convention that the application only ever inserts is not that. The
 * guarantee has to sit below the application, where a bug, a console
 * session or a compromised administrator account cannot route around
 * it.
 *
 * Postgres has no statement-level RAISE inside a trigger body the way
 * SQLite does, so this is a trigger function that raises an exception,
 * attached BEFORE UPDATE OR DELETE on each table. Same guarantee,
 * different mechanism.
 */

export const APPEND_ONLY_TABLES = ["audit_log", "access_log"] as const;

const FUNCTION_NAME = "lekha_refuse_mutation";

const CREATE_FUNCTION = `
CREATE OR REPLACE FUNCTION ${FUNCTION_NAME}() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: entries cannot be edited or deleted', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
`;

function triggerName(table: string) {
  return `${table}_append_only`;
}

export async function createAuditTriggers(sql: Sql): Promise<void> {
  await sql.unsafe(CREATE_FUNCTION);
  for (const table of APPEND_ONLY_TABLES) {
    const name = triggerName(table);
    await sql.unsafe(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
    await sql.unsafe(
      `CREATE TRIGGER ${name} BEFORE UPDATE OR DELETE ON ${table}
       FOR EACH ROW EXECUTE FUNCTION ${FUNCTION_NAME}()`,
    );
  }
}

/**
 * Only a development reset calls this. There is deliberately no
 * application path that drops these.
 */
export async function dropAuditTriggers(sql: Sql): Promise<void> {
  for (const table of APPEND_ONLY_TABLES) {
    await sql.unsafe(`DROP TRIGGER IF EXISTS ${triggerName(table)} ON ${table}`);
  }
}

export async function auditTriggersPresent(sql: Sql): Promise<boolean> {
  const rows = await sql<{ tgname: string }[]>`
    SELECT tgname FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname = ANY(${APPEND_ONLY_TABLES.map(triggerName)})
  `;
  return rows.length === APPEND_ONLY_TABLES.length;
}
