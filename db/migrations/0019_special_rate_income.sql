create table if not exists tax_special_rate_declarations (
  id text primary key,
  employee_id text not null references employees(id),
  financial_year integer not null,
  stcg_specified_paise bigint not null default 0,
  stcg_other_paise bigint not null default 0,
  ltcg_specified_paise bigint not null default 0,
  ltcg_general_paise bigint not null default 0,
  current_year_stcl_paise bigint not null default 0,
  current_year_ltcl_paise bigint not null default 0,
  brought_forward_stcl_paise bigint not null default 0,
  brought_forward_ltcl_paise bigint not null default 0,
  vda_paise bigint not null default 0,
  lottery_paise bigint not null default 0,
  horse_race_paise bigint not null default 0,
  online_gaming_paise bigint not null default 0,
  dtaa_special_rate_paise bigint not null default 0,
  updated_by text,
  updated_at text not null
);

create unique index if not exists tax_special_rate_idx
  on tax_special_rate_declarations (employee_id, financial_year);
