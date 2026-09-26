-- Gratuity: whether 4 years and 240 days counts as five years' continuous
-- service. Some High Courts read s.2A of the Payment of Gratuity Act that
-- way; the statute says five years. Off unless a company decides, after
-- legal review, to apply it — it is never assumed.
alter table companies
  add column if not exists gratuity_four_years_240_days boolean not null default false;

-- Employer NPS. What the employer puts into the employee's NPS Tier I
-- account, as basis points of basic + DA (1000 = 10%). Zero means the
-- employer does not contribute, which is where everybody starts.
alter table employees
  add column if not exists employer_nps_bps integer not null default 0,
  add column if not exists pran text;
