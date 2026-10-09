import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as core from "./schema";
import * as compliance from "./compliance-schema";

export const requiredColumns = Object.values({ ...core, ...compliance })
  .filter(value => is(value, PgTable))
  .flatMap(table => {
    const config = getTableConfig(table);
    return config.columns.map(column => ({ table_name: config.name, column_name: column.name }));
  });

/** Inspect metadata only; do not infer readiness from the table count. */
export function schemaReadiness(columns: { table_name: string; column_name: string }[]) {
  const present = new Set(columns.map(c => `${c.table_name}.${c.column_name}`));
  const missing = requiredColumns.filter(c => !present.has(`${c.table_name}.${c.column_name}`))
    .map(c => `${c.table_name}.${c.column_name}`).sort();
  return { ready: missing.length === 0, missing };
}
