-- An approver sending a calculated run back, with the reason. Cleared when
-- the run is calculated again; the audit log keeps every one.
alter table payroll_runs
  add column if not exists rejected_by text,
  add column if not exists rejected_at text,
  add column if not exists rejection_remarks text;
