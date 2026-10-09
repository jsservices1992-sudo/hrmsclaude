ALTER TABLE "fnf_settlements" ALTER COLUMN "sla_days" SET DEFAULT 2;
ALTER TABLE "fnf_settlements" ADD COLUMN IF NOT EXISTS "paid_at" text;
ALTER TABLE "fnf_settlements" ADD COLUMN IF NOT EXISTS "payment_reference" text;
ALTER TABLE "fnf_settlements" ADD COLUMN IF NOT EXISTS "computation_version" integer NOT NULL DEFAULT 1;
