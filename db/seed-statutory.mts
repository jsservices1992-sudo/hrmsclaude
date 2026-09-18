/**
 * Loads India's statutory reference data: the states and union
 * territories, their professional tax slabs and labour welfare fund
 * rates, and the EPF/ESIC parameters.
 *
 * This is not demo data and not one tenant's configuration — it is the
 * law of the land, the same for every company on the instance, and the
 * application is unusable without it. A branch cannot be created
 * without picking a state; payroll cannot price PT, LWF, PF or ESIC
 * without the rest. A deployment that has had its schema pushed but not
 * this seeded looks broken in a way that points nowhere: an empty
 * dropdown with a "State is required" error under it.
 *
 *   npm run db:seed-statutory
 *
 * Safe to run again. Jurisdictions are upserted; slabs and rates are
 * replaced per state — except where somebody has marked a row
 * `verified`, which means they checked it against the Act and their
 * work is not something a re-run gets to overwrite.
 *
 * IMPORTANT: every slab and rate here is seeded `verified: false`. They
 * are indicative figures, not a compliance source. Check each against
 * the state Act before a real payroll run.
 */

import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray, and } from "drizzle-orm";
import * as s from "./schema";
import {
  JURISDICTIONS,
  PT_SLABS,
  LWF_RATES,
  LWF_SOURCES,
  MINIMUM_WAGES,
  PT_SOURCES,
  STATUTORY_PARAMS,
} from "./statutory-data";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("\n  Set DATABASE_URL to the database you are seeding.\n");
  process.exit(1);
}

/* Far enough back that any plausible payroll date resolves against it.
   These figures are the ones in force now; when a state revises a slab
   the new row is added with its own date and this one is closed off. */
const EFFECTIVE_FROM = "2020-04-01";

const client = postgres(DB_URL, {
  max: 1,
  ssl: DB_URL.includes("localhost") || DB_URL.includes("127.0.0.1") ? false : "require",
  prepare: false,
});
const db = drizzle(client, { schema: s });

try {
  await db
    .insert(s.jurisdictions)
    .values(
      JURISDICTIONS.map((j) => ({
        stateCode: j.code,
        name: j.name,
        kind: j.kind,
        ptApplicable: j.pt,
        lwfApplicable: j.lwf,
        verificationNote: j.note ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: s.jurisdictions.stateCode,
      set: {
        name: s.jurisdictions.name,
        kind: s.jurisdictions.kind,
        ptApplicable: s.jurisdictions.ptApplicable,
        lwfApplicable: s.jurisdictions.lwfApplicable,
      },
    });
  console.log(`  jurisdictions      ${JURISDICTIONS.length}`);

  /* A row somebody marked verified was checked against the Act by a
     person. Re-seeding the state it belongs to would quietly undo that,
     so the whole state is left alone and named in the output. */
  const verifiedPt = new Set(
    (await db.select({ stateCode: s.ptSlabs.stateCode }).from(s.ptSlabs).where(eq(s.ptSlabs.verified, true)))
      .map((r) => r.stateCode),
  );
  const ptStates = [...new Set(PT_SLABS.map((r) => r.state))].filter((c) => !verifiedPt.has(c));

  if (ptStates.length > 0) {
    await db.delete(s.ptSlabs).where(
      and(inArray(s.ptSlabs.stateCode, ptStates), eq(s.ptSlabs.verified, false)),
    );
    await db.insert(s.ptSlabs).values(
      PT_SLABS.filter((r) => ptStates.includes(r.state)).map((r) => ({
        id: randomUUID(),
        stateCode: r.state,
        minPaise: r.min,
        maxPaise: r.max,
        amountPaise: r.amount,
        overrideMonth: r.overrideMonth ?? null,
        overrideAmountPaise: r.overrideAmount ?? null,
        gender: r.gender ?? ("all" as const),
        annualCapPaise: r.annualCap ?? 250000,
        effectiveFrom: EFFECTIVE_FROM,
        effectiveTo: null,
        verified: false,
        source: PT_SOURCES[r.state] ?? null,
      })),
    );
  }
  console.log(`  pt slabs           ${PT_SLABS.filter((r) => ptStates.includes(r.state)).length}`);

  const verifiedLwf = new Set(
    (await db.select({ stateCode: s.lwfRates.stateCode }).from(s.lwfRates).where(eq(s.lwfRates.verified, true)))
      .map((r) => r.stateCode),
  );
  const lwfStates = [...new Set(LWF_RATES.map((r) => r.state))].filter((c) => !verifiedLwf.has(c));

  if (lwfStates.length > 0) {
    await db.delete(s.lwfRates).where(
      and(inArray(s.lwfRates.stateCode, lwfStates), eq(s.lwfRates.verified, false)),
    );
    await db.insert(s.lwfRates).values(
      LWF_RATES.filter((r) => lwfStates.includes(r.state)).map((r) => ({
        id: randomUUID(),
        stateCode: r.state,
        employeePaise: r.employee,
        employerPaise: r.employer,
        employeePercentBps: r.employeePercentBps ?? null,
        employerMultiple: r.employerMultiple ?? null,
        frequency: r.frequency,
        deductionMonths: r.months.join(","),
        source: LWF_SOURCES[r.state] ?? null,
        minEstablishmentHeadcount: r.minHeadcount ?? null,
        employerMinimumPaise: r.employerMinimum ?? null,
        governmentPaise: r.government ?? null,
        excludeAboveWagePaise: r.excludeAboveWage ?? null,
        excludedCategories: r.excludedCategories?.join(",") ?? null,
        effectiveFrom: EFFECTIVE_FROM,
        effectiveTo: null,
        verified: false,
      })),
    );
  }
  console.log(`  lwf rates          ${LWF_RATES.filter((r) => lwfStates.includes(r.state)).length}`);

  /* Minimum wages, for the states anybody has entered. A verified row is
     somebody's own checked figure and is never overwritten. */
  const mwStates = [...new Set(MINIMUM_WAGES.map((w) => w.state))];
  if (mwStates.length > 0) {
    const verifiedMw = new Set(
      (
        await db
          .select({ stateCode: s.minimumWages.stateCode })
          .from(s.minimumWages)
          .where(eq(s.minimumWages.verified, true))
      ).map((r) => r.stateCode),
    );
    const toSeed = MINIMUM_WAGES.filter((w) => !verifiedMw.has(w.state));
    if (toSeed.length > 0) {
      await db.delete(s.minimumWages).where(
        and(
          inArray(s.minimumWages.stateCode, [...new Set(toSeed.map((w) => w.state))]),
          eq(s.minimumWages.verified, false),
        ),
      );
      await db.insert(s.minimumWages).values(
        toSeed.map((w) => ({
          id: randomUUID(),
          stateCode: w.state,
          zone: w.zone,
          skillCategory: w.skill,
          monthlyPaise: w.monthlyPaise,
          effectiveFrom: w.effectiveFrom,
          effectiveTo: null,
          verified: false,
          source: w.source,
        })),
      );
    }
    console.log(`  minimum wages      ${toSeed.length}`);
  }

  /* Central parameters carry no per-state verification, so these are
     simply replaced at this effective date. */
  await db.delete(s.statutoryParams).where(
    and(
      inArray(s.statutoryParams.key, STATUTORY_PARAMS.map((p) => p.key)),
      eq(s.statutoryParams.effectiveFrom, EFFECTIVE_FROM),
    ),
  );
  await db.insert(s.statutoryParams).values(
    STATUTORY_PARAMS.map((p) => ({
      id: randomUUID(),
      key: p.key,
      value: p.value,
      unit: p.unit,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      note: p.note,
      source: "source" in p ? p.source : null,
    })),
  );
  console.log(`  statutory params   ${STATUTORY_PARAMS.length}`);

  const skipped = [...verifiedPt, ...verifiedLwf];
  if (skipped.length > 0) {
    console.log(`\n  Left alone (verified by hand): ${[...new Set(skipped)].join(", ")}`);
  }
  console.log(
    "\n  Done. Every slab and rate is marked unverified — check each against" +
      "\n  the state Act before running real payroll.\n",
  );
} finally {
  await client.end();
}
