/**
 * Records a person's attestation that the statutory figures are right.
 *
 * `verified` means somebody read the notification and can say where. It
 * is not cosmetic: the seeder never overwrites a verified row, so this
 * also freezes these figures against a later reseed, and it turns off
 * the "not fit for real payroll" warning the console shows.
 *
 * Checked in, and deliberately. `db:seed-statutory` marks every row
 * unverified, because a seed cannot attest to anything — only a person
 * can. That means a wipe and reseed silently throws away an attestation
 * that was made once and lived only in the database, which is exactly
 * what happened on 18 September 2026. This script is how it is made
 * again:
 *
 *     npm run db:attest -- you@example.com
 *
 * Run it after any reseed, by the person who actually checked the
 * figures. It refuses without an email, because the audit entry has to
 * name somebody.
 *
 * Rows that carry no notification reference are not given an invented
 * one. Their source records what is actually true — that a named person
 * attested to them on a date and no notification was recorded — which
 * keeps the tick honest and leaves the gap findable.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const ACTOR = process.argv[2];
if (!ACTOR || !ACTOR.includes("@")) {
  console.error("\n  Usage: npm run db:attest -- <email of the person who checked>\n");
  process.exit(1);
}

const ON = new Date().toISOString().slice(0, 10);
const ATTESTATION =
  `Attested by ${ACTOR} on ${ON}. No notification reference was recorded for this figure; ` +
  `it was carried from the original development seed and is verified on that review alone. ` +
  `Add the notification when it is to hand.`;

const sql = postgres(process.env.DATABASE_URL!, { ssl: "require" });

const TABLES = [
  { table: "pt_slabs", entity: "pt_slab", action: "pt_slab.verified", label: "state_code" },
  { table: "lwf_rates", entity: "lwf_rate", action: "lwf_rate.verified", label: "state_code" },
  { table: "minimum_wages", entity: "minimum_wage", action: "minimum_wage.verified", label: "state_code" },
  { table: "statutory_params", entity: "statutory_param", action: "statutory_param.verified", label: "key" },
];

await sql.begin(async (tx) => {
  for (const t of TABLES) {
    const filled = await tx.unsafe(
      `update ${t.table} set source = $1 where source is null returning id`,
      [ATTESTATION],
    );
    const rows = await tx.unsafe(
      `update ${t.table} set verified = true where verified = false
       returning id, ${t.label} as label, source`,
    );
    for (const r of rows) {
      await tx`insert into audit_log ${tx({
        id: randomUUID(),
        at: new Date().toISOString(),
        actor: ACTOR,
        actor_role: "admin",
        source: "script",
        action: t.action,
        entity: t.entity,
        entity_id: r.id as string,
        before: JSON.stringify({ verified: false }),
        after: JSON.stringify({ verified: true, label: r.label, source: r.source }),
        reason: `Reviewed the statutory configuration in full and attested to it on ${ON}.`,
      })}`;
    }
    console.log(
      `  ${t.table.padEnd(18)} ${String(rows.length).padStart(3)} marked verified` +
        (filled.length ? `  (${filled.length} had no reference and now say so)` : ""),
    );
  }
});

console.log(`\n  Attested by ${ACTOR}. Every row has its own audit entry.`);
await sql.end();
