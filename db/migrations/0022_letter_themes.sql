alter table letter_templates add column if not exists theme text not null default 'classic';
alter table letter_templates add column if not exists signatory_name text;
alter table letter_templates add column if not exists signatory_title text;

alter table letter_issues add column if not exists theme text;
alter table letter_issues add column if not exists signatory_name text;
alter table letter_issues add column if not exists signatory_title text;
alter table letter_issues add column if not exists ref_no text;
