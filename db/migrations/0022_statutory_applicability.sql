-- Whether provident fund and ESI reach this establishment at all.
--
-- Coverage is a fact about the establishment, not about the person: the
-- EPF Act reaches establishments of twenty or more, ESI ten or more in an
-- implemented area. Without this the product deducted both from everybody
-- in a company of six — money taken from wages against no obligation.
--
-- "auto" decides from the declared headcount; the other two are for a
-- company that registered voluntarily, or that holds an exemption.
alter table companies
  add column if not exists epf_coverage text not null default 'auto',
  add column if not exists esic_coverage text not null default 'auto';

-- Per person, where the establishment's answer is not the whole story:
-- an apprentice outside the Act, somebody covered through another
-- employer. "auto" is the statutory test and is where everybody starts;
-- "no" is honoured only where the law leaves room for it.
alter table employees
  add column if not exists pf_applicability text not null default 'auto',
  add column if not exists esic_applicability text not null default 'auto',
  add column if not exists pt_applicability text not null default 'auto',
  add column if not exists tds_applicability text not null default 'auto';

-- What the structure's payslip is about. A structure used for people paid
-- a net in hand has no cost to company to show and usually no employer
-- contribution either; printing both anyway states a figure nobody agreed
-- to. This decides what is shown, never what is deducted.
alter table salary_structures
  add column if not exists pay_basis text not null default 'ctc',
  add column if not exists show_ctc_on_payslip boolean not null default true,
  add column if not exists show_employer_contribution boolean not null default true,
  add column if not exists hide_zero_components boolean not null default true;
