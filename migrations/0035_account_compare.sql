-- "So sánh tài khoản" (staff only). Groups are many-to-many with accounts.
create table if not exists compare_groups (
  id bigserial primary key,
  name text not null,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists compare_groups_name on compare_groups (lower(name));
create table if not exists compare_group_members (
  group_id bigint not null references compare_groups(id) on delete cascade,
  client_id text not null,
  added_by text,
  added_at timestamptz not null default now(),
  primary key (group_id, client_id)
);
create index if not exists compare_group_members_client on compare_group_members (client_id);

-- Nightly monthly metrics per account × campaign type × conversion group (platform-neutral; Google first).
-- conv_group '_all': clicks / cost / primary conversions of the campaign type. Other rows: conversions of that group only.
create table if not exists compare_monthly (
  platform text not null default 'google',
  client_id text not null,
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  channel text not null,
  conv_group text not null,
  clicks double precision,
  cost double precision,
  conversions double precision,
  computed_at timestamptz not null default now(),
  primary key (client_id, month, channel, conv_group)
);
create table if not exists compare_state (
  client_id text primary key,
  platform text not null default 'google',
  months jsonb,
  conv_ok boolean not null default false,
  error text,
  computed_at timestamptz not null default now()
);
