-- Web push (opt-in per user). Subscriptions belong to a principal (staff_users.id / `admin:<email>` / client_users.id).
create table if not exists push_subscriptions (
  endpoint text primary key,
  principal_kind text not null check (principal_kind in ('staff', 'client')),
  principal_id text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  fail_count int not null default 0
);
create index if not exists push_subscriptions_principal_idx on push_subscriptions (principal_kind, principal_id);

create table if not exists push_prefs (
  principal_kind text not null,
  principal_id text not null,
  budget boolean not null default false,
  conv_drop boolean not null default false,
  invoices boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (principal_kind, principal_id)
);

-- Dedupe: one row per (alert, account, window). Rows older than 60 days may be pruned.
create table if not exists push_sent (
  key text primary key,
  sent_at timestamptz not null default now()
);

-- Daily account conversions for the "sharp drop" alert (read-only GAQL, last 14 complete days).
create table if not exists push_conv_check (
  client_id text primary key,
  checked_at timestamptz not null default now(),
  last7 double precision,
  prev7 double precision,
  error text
);
