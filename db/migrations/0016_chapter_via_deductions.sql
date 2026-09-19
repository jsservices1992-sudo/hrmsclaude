alter table tax_declarations
  add column dependent_disability text not null default 'none',
  add column self_disability text not null default 'none',
  add column section_80ddb_paise bigint not null default 0,
  add column ddb_person_is_senior boolean not null default false,
  add column section_80eeb_paise bigint not null default 0,
  add column section_80ggc_paise bigint not null default 0;
