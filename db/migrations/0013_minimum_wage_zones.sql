-- Ten states notify a different minimum wage for different areas.
--
-- Karnataka's Zone I highly-skilled floor is ₹31,114 a month against
-- ₹25,831 in Zone III. Storing one rate per state would compare a salary
-- in one part of the state against the floor for another — wrongly, and
-- in both directions, with no sign that anything was assumed.
--
-- So the rate carries the zone it was notified for (null where the state
-- notifies one rate statewide), and the branch carries the zone it sits
-- in. A branch in a zoned state with no zone set cannot be checked, and
-- the run says exactly that rather than guessing.
ALTER TABLE "minimum_wages" ADD COLUMN IF NOT EXISTS "zone" text;
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "minimum_wage_zone" text;

-- One rate per state, zone, skill and start date. Without this a second
-- load of the same notification silently doubles the rows and the
-- resolver picks whichever came back last.
CREATE UNIQUE INDEX IF NOT EXISTS "minimum_wages_unique_idx"
  ON "minimum_wages" ("state_code", COALESCE("zone", ''), "skill_category", "effective_from");
