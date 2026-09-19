create table if not exists workflow_department_owners (
  id text primary key,
  company_id text not null references companies(id),
  department text not null,
  owner_email text not null,
  created_at text not null
);

create unique index if not exists workflow_dept_owner_idx
  on workflow_department_owners (company_id, department, owner_email);
create index if not exists workflow_dept_owner_company_idx
  on workflow_department_owners (company_id);
