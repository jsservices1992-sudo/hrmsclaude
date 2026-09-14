/**
 * Create the schema, using the same driver the application uses.
 *
 * `drizzle-kit push` opens its own connection and, against a managed
 * Postgres, was hanging on "Pulling schema from database" rather than
 * failing with anything actionable. The application's own connection
 * works — the health endpoint proves it from the deployment — so this
 * runs the generated DDL through that same driver instead, and then
 * puts the append-only triggers in place.
 *
 * Idempotent: existing tables are left alone, so running it twice is
 * safe and running it against a half-created database finishes the job.
 *
 *   npm run db:migrate        (reads DATABASE_URL from .env.local)
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { createAuditTriggers, auditTriggersPresent, APPEND_ONLY_TABLES } from "./triggers";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "\n  DATABASE_URL is not set." +
      "\n  Put it in .env.local as a single line:" +
      "\n    DATABASE_URL=postgresql://user:password@host/dbname\n",
  );
  process.exit(1);
}

const isLocal = url.includes("localhost") || url.includes("127.0.0.1");
const sql = postgres(url, {
  max: 1,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  prepare: false,
  connect_timeout: 30,
});

/** Never print the credential, only where it points. */
const host = url.replace(/^.*@/, "").replace(/\/.*$/, "");
console.log(`\n  Connecting to ${host} …`);

try {
  await sql`select 1`;
} catch (error) {
  console.error(`\n  Could not connect: ${(error as Error).message}\n`);
  process.exit(1);
}

const dir = join(import.meta.dirname, "migrations");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
if (files.length === 0) {
  console.error("\n  No migration files. Run `npm run db:generate` first.\n");
  process.exit(1);
}

let created = 0;
let existed = 0;

for (const file of files) {
  const body = await readFile(join(dir, file), "utf8");
  /* drizzle separates statements with its own marker; fall back to
     semicolons at the end of a line for hand-written files. */
  const statements = body
    .split(/--> statement-breakpoint|;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    try {
      await sql.unsafe(statement);
      created += 1;
    } catch (error) {
      const code = (error as { code?: string }).code;
      /* 42P07 duplicate table, 42710 duplicate object: already there,
         which is the normal case on a re-run. */
      if (code === "42P07" || code === "42710") {
        existed += 1;
        continue;
      }
      console.error(`\n  Failed on:\n    ${statement.slice(0, 120)}…`);
      console.error(`  ${(error as Error).message}\n`);
      process.exit(1);
    }
  }
}

await createAuditTriggers(sql);
if (!(await auditTriggersPresent(sql))) {
  console.error("\n  Triggers could not be created. The audit log would be editable.\n");
  process.exit(1);
}

const [{ count }] = await sql<{ count: number }[]>`
  select count(*)::int as count from information_schema.tables
  where table_schema = 'public'
`;

await sql.end();

console.log(
  `  ${count} tables in place` +
    (existed ? ` (${created} statements applied, ${existed} already existed)` : "") +
    `\n  ${APPEND_ONLY_TABLES.length} tables are append-only\n`,
);
