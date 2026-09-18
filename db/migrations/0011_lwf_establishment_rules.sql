-- The labour welfare fund is not a per-employee rate table.
--
-- Madhya Pradesh sets a minimum the employer owes per establishment per
-- half-year (₹2,500) regardless of how few people work there; Delhi does
-- not apply the Act below five employees at all; Madhya Pradesh and
-- Chhattisgarh exclude managerial and supervisory staff above ₹10,000 a
-- month. None of that can be said with an employee rate and an employer
-- rate, so these columns say it.

ALTER TABLE "lwf_rates" ADD COLUMN IF NOT EXISTS "min_establishment_headcount" integer;
ALTER TABLE "lwf_rates" ADD COLUMN IF NOT EXISTS "employer_minimum_paise" bigint;
ALTER TABLE "lwf_rates" ADD COLUMN IF NOT EXISTS "government_paise" bigint;
ALTER TABLE "lwf_rates" ADD COLUMN IF NOT EXISTS "exclude_above_wage_paise" bigint;
ALTER TABLE "lwf_rates" ADD COLUMN IF NOT EXISTS "excluded_categories" text;

-- Null rather than a default: nobody has said whether these jobs are
-- managerial, and "other" would be an answer we invented.
ALTER TABLE "grades" ADD COLUMN IF NOT EXISTS "lwf_category" text;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "lwf_category" text;
