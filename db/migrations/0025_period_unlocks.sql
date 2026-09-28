-- A closed payroll month reopened, once, for one company. An admin grants
-- it with a written reason; it lasts until it is used by a recalculation
-- or 24 hours pass, whichever is first. The ordinary lock is untouched.
create table if not exists period_unlocks (
  id text primary key,
  company_id text not null references companies(id),
  period_year integer not null,
  period_month integer not null,
  reason text not null,
  granted_by text not null,
  granted_at text not null,
  expires_at text not null,
  used_at text,
  used_by_run_id text
);
create index if not exists period_unlocks_company_idx on period_unlocks (company_id, period_year, period_month);
