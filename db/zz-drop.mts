import { sql } from "drizzle-orm";
import { db } from "@/db";
const ids = (await db.execute(sql`select id, name from companies where name like 'ZZ %'`)) as unknown as { id: string; name: string }[];
console.log("dropping:", ids.map((r) => r.name));
if (ids.length) {
  const list = ids.map((i) => `'${i.id}'`).join(",");
  const tables = (await db.execute(sql`select table_name from information_schema.columns where table_schema='public' and column_name='company_id'`)) as unknown as { table_name: string }[];
  const empTables = (await db.execute(sql`select table_name from information_schema.columns where table_schema='public' and column_name='employee_id'`)) as unknown as { table_name: string }[];
  await db.execute(sql.raw(`delete from salary_structure_lines where structure_id in (select id from salary_structures where company_id::text in (${list}))`));
  await db.execute(sql.raw(`delete from sessions where user_id in (select id from users where company_id::text in (${list}))`));
  const empSel = `select id from employees where company_id::text in (${list})`;
  for (let p = 0; p < 4; p++) for (const t of empTables) { try { await db.execute(sql.raw(`delete from "${t.table_name}" where employee_id in (${empSel})`)); } catch { /* next pass */ } }
  for (let p = 0; p < 8; p++) for (const t of tables) { try { await db.execute(sql.raw(`delete from "${t.table_name}" where company_id::text in (${list})`)); } catch { /* next pass */ } }
  await db.execute(sql.raw(`delete from companies where id::text in (${list})`));
}
console.log("remaining:", await db.execute(sql`select name from companies`));
process.exit(0);
