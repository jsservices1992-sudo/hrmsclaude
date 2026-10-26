create table if not exists demo_requests (
  id text primary key,
  name text not null,
  email text not null,
  phone text,
  company text not null,
  employees text,
  plan text,
  message text,
  status text not null default 'new',
  created_at text not null
);

create index if not exists demo_requests_created_idx on demo_requests (created_at);
