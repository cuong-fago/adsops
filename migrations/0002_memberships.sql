-- AdsOps access: ops sees all tools; sale/client only see report KPIs for granted accounts.
create table if not exists memberships (
  id text primary key,
  user_id text,
  email text not null,
  role text not null,
  client_id text,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists memberships_user_id_idx on memberships (user_id);
create index if not exists memberships_email_idx on memberships (email);
