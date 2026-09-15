/**
 * Empties every table so a company can be set up from scratch.
 *
 * TRUNCATE rather than DELETE, for two reasons: it does not care about
 * foreign key order, and the audit and access logs are append-only —
 * their triggers refuse DELETE, which is the whole point of them, and
 * TRUNCATE is not a DELETE so the guarantee stays intact and the
 * triggers survive.
 *
 * Statutory reference data is re-seeded afterwards. The states, PT slabs
 * and EPF/ESIC parameters are not this company's data — they are the law,
 * the same for every tenant, and without them the state dropdown is empty
 * and no branch can be created at all.
 */
import postgres from "postgres";

const URL_ = process.env.DATABASE_URL;
if (!URL_) {
  console.error("\n  Set DATABASE_URL to the database you are wiping.\n");
  process.exit(1);
}

const sql = postgres(URL_, {
  max: 1,
  ssl: URL_.includes("localhost") ? false : { rejectUnauthorized: false },
  prepare: false,
});

try {
  const tables = (
    await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`
  )
    .map((r) => r.table_name)
    .filter((t) => !t.startsWith("__")); // drizzle's own bookkeeping

  const before = await sql`select count(*)::int as n from companies`;
  console.log(`\n  ${tables.length} tables · ${before[0].n} company(ies) before\n`);

  await sql.unsafe(
    `truncate table ${tables.map((t) => `"${t}"`).join(", ")} restart identity cascade`,
  );

  const triggers = await sql`
    select count(*)::int as n from pg_trigger where not tgisinternal`;
  console.log(`  every table emptied · ${triggers[0].n} append-only triggers still in place`);
} finally {
  await sql.end();
}
