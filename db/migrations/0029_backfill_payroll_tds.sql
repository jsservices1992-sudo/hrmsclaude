INSERT INTO "tds_ledger" ("id", "employee_id", "financial_year", "month", "tds_paise", "config_version", "source_key", "run_id", "computed_at")
SELECT 'historical:' || r.id || ':' || sm.employee_id, sm.employee_id,
  CASE WHEN r.period_month >= 4 THEN r.period_year ELSE r.period_year - 1 END,
  r.period_month, COALESCE(SUM(l.amount_paise), 0), 'historical-payroll-line',
  'payroll:' || r.id, r.id, COALESCE(r.approved_at, r.created_at)
FROM payroll_runs r
JOIN payroll_employee_summaries sm ON sm.run_id = r.id
LEFT JOIN payroll_lines l ON l.run_id = r.id AND l.employee_id = sm.employee_id AND l.code = 'TDS'
WHERE r.status IN ('approved', 'finalised', 'disbursed', 'closed')
  AND NOT EXISTS (SELECT 1 FROM payroll_runs newer WHERE newer.company_id = r.company_id AND newer.period_year = r.period_year AND newer.period_month = r.period_month AND newer.version > r.version)
GROUP BY r.id, sm.employee_id, r.period_month, r.period_year, r.approved_at, r.created_at
ON CONFLICT (employee_id, source_key) DO NOTHING;
