create table if not exists letter_templates (
  id text primary key,
  company_id text not null references companies(id),
  type text not null,
  mode text not null,
  body_text text,
  file_key text,
  file_name text,
  file_extension text,
  updated_by text,
  updated_at text not null
);

create unique index if not exists letter_template_idx on letter_templates (company_id, type);

create table if not exists letter_issues (
  id text primary key,
  employee_id text not null references employees(id),
  company_id text not null references companies(id),
  type text not null,
  mode text not null,
  text text,
  file_key text,
  file_name text,
  file_extension text,
  issued_by text not null,
  issued_at text not null
);

create index if not exists letter_issue_emp_idx on letter_issues (employee_id);
