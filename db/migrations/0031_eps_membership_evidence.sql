ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "eps_member" boolean;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "eps_joining_wage_paise" bigint;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "eps_revision_wage_paise" bigint;
