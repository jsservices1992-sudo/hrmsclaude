DROP INDEX IF EXISTS minimum_wages_unique_idx;
CREATE UNIQUE INDEX IF NOT EXISTS minimum_wages_scoped_unique_idx
  ON minimum_wages(COALESCE(company_id, ''), state_code, COALESCE(zone, ''), skill_category, effective_from);
