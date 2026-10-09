CREATE TABLE IF NOT EXISTS fnf_tax_reviews (
  id text PRIMARY KEY,
  exit_case_id text NOT NULL REFERENCES exit_cases(id),
  company_id text NOT NULL REFERENCES companies(id),
  facts_json text NOT NULL,
  input_digest text NOT NULL,
  evidence text NOT NULL,
  recorded_by text NOT NULL,
  recorded_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS fnf_tax_review_exit_idx ON fnf_tax_reviews(exit_case_id, recorded_at);
