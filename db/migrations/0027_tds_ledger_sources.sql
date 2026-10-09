ALTER TABLE "tds_ledger" ADD COLUMN IF NOT EXISTS "source_key" text;
UPDATE "tds_ledger" SET "source_key" = COALESCE('payroll:' || "run_id", 'legacy:' || "id") WHERE "source_key" IS NULL;
ALTER TABLE "tds_ledger" ALTER COLUMN "source_key" SET NOT NULL;
DROP INDEX IF EXISTS "tds_ledger_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "tds_ledger_source_idx" ON "tds_ledger" ("employee_id", "source_key");
CREATE INDEX IF NOT EXISTS "tds_ledger_period_idx" ON "tds_ledger" ("employee_id", "financial_year", "month");
