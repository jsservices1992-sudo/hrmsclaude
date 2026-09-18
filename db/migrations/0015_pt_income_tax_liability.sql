-- Punjab's State Development Tax is not owed by wage at all — only by a
-- person actually liable to income tax (Punjab State Development Tax
-- Act 2018, s.4(3)). This flag lives on the band, not on the state code,
-- so `checkSlabCoverage` still sees one band covering every wage: the
-- gate is applied to the AMOUNT a matched band charges, not to whether
-- a band matches, which is what would turn "not a payer this year" into
-- a reportable coverage gap.
ALTER TABLE "pt_slabs" ADD COLUMN IF NOT EXISTS "requires_income_tax_liability" boolean NOT NULL DEFAULT false;
