ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "esic_disability_eligible" boolean NOT NULL DEFAULT false;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "esic_disability_certificate_ref" text;
