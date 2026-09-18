-- A company on a different notified schedule than the general one — a
-- factory, a shop, construction, security — needs its own minimum wage
-- floor, not the state's general-employment figure every other company
-- there is checked against.
--
-- Null stays the shared, instance-wide row. A non-null company_id is
-- that company's own, and is preferred over the shared row wherever
-- both could answer the same state, zone and skill on the same date —
-- see applicableMinimumWage in lib/payroll/compensation.ts.
ALTER TABLE "minimum_wages" ADD COLUMN IF NOT EXISTS "company_id" text REFERENCES "companies"("id");
CREATE INDEX IF NOT EXISTS "minimum_wages_company_idx" ON "minimum_wages" ("company_id");
