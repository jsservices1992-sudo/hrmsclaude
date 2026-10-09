ALTER TABLE payroll_adjustments ADD COLUMN IF NOT EXISTS source_key text;
ALTER TABLE payroll_adjustments ADD COLUMN IF NOT EXISTS esic_treatment text;
CREATE UNIQUE INDEX IF NOT EXISTS payroll_adjustment_source_idx ON payroll_adjustments(source_key);
CREATE TABLE IF NOT EXISTS statutory_deposits (
  id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id), scheme text NOT NULL,
  state_code text NOT NULL DEFAULT '-', period_year integer NOT NULL, period_month integer NOT NULL,
  amount_paise bigint NOT NULL CHECK(amount_paise > 0), deposited_on text NOT NULL, reference text NOT NULL,
  bsr text, serial text, evidence text NOT NULL, recorded_by text NOT NULL, recorded_at text NOT NULL,
  CHECK(period_month BETWEEN 1 AND 12), CHECK(scheme IN ('tds','epf','esic','pt','lwf'))
);
CREATE UNIQUE INDEX IF NOT EXISTS statutory_deposit_reference_idx ON statutory_deposits(company_id,scheme,reference);
CREATE INDEX IF NOT EXISTS statutory_deposit_period_idx ON statutory_deposits(company_id,period_year,period_month);
CREATE TABLE IF NOT EXISTS tds_allocations (
  id text PRIMARY KEY, deposit_id text NOT NULL REFERENCES statutory_deposits(id),
  ledger_id text NOT NULL REFERENCES tds_ledger(id), amount_paise bigint NOT NULL CHECK(amount_paise > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS tds_allocation_idx ON tds_allocations(deposit_id,ledger_id);
CREATE TABLE IF NOT EXISTS compliance_registers (
  id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id), employee_id text REFERENCES employees(id),
  kind text NOT NULL, source_key text NOT NULL, period_year integer NOT NULL, period_month integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft', snapshot_json text NOT NULL, evidence text NOT NULL,
  prepared_by text NOT NULL, reviewed_by text, prepared_at text NOT NULL, posted_at text,
  CHECK(status IN ('draft','posted')), CHECK(period_month BETWEEN 0 AND 12),
  CHECK(kind IN ('eps_review','worker_coverage','overtime','bonus','worker_leave','filing_validation'))
);
CREATE UNIQUE INDEX IF NOT EXISTS compliance_register_source_idx ON compliance_registers(company_id,source_key);
CREATE INDEX IF NOT EXISTS compliance_register_kind_idx ON compliance_registers(company_id,kind,period_year);
ALTER TABLE compliance_registers ADD COLUMN IF NOT EXISTS review_evidence text;
CREATE TABLE IF NOT EXISTS rule_notifications (
  id text PRIMARY KEY, state_code text NOT NULL, subject text NOT NULL, status text NOT NULL,
  notification_ref text NOT NULL, document_url text NOT NULL, document_sha256 text NOT NULL,
  effective_from text NOT NULL, effective_to text, reviewed_by text NOT NULL, reviewed_at text NOT NULL,
  review_note text NOT NULL, monthly_floor_paise bigint,
  CHECK(subject IN ('wage_code','osh_code','minimum_wage','pt','lwf','floor_wage')),
  CHECK(status IN ('draft','notified','not_notified','superseded')),
  CHECK(monthly_floor_paise IS NULL OR monthly_floor_paise > 0)
);
CREATE INDEX IF NOT EXISTS notification_scope_idx ON rule_notifications(state_code,subject,effective_from);
