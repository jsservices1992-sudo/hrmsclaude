alter table users
  add column reset_token text,
  add column reset_token_expires_at text;

create unique index if not exists users_reset_token_idx on users (reset_token);
