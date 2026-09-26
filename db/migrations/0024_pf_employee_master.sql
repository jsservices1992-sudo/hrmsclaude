-- The EPF employee master, per the 2026 PF rule set: whether this person
-- is in the pension scheme and EDLI, and what their contribution is
-- charged on. "auto" / "company" keep today's behaviour for everybody.
alter table employees
  add column if not exists eps_applicability text not null default 'auto',
  add column if not exists edli_applicability text not null default 'auto',
  add column if not exists pf_contribution_basis text not null default 'company';
