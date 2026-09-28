-- AdsOps role / ad-account permission model (Phase 1+2).
--   staff_users        internal Fago staff (Google OAuth), role per email.
--                      cuong@fagogroup.vn is a hard-coded super admin in code.
--   client_users       customer-side logins (username + password), SEPARATE
--                      from Better Auth's "user" table. No self sign-up.
--   client_sessions    opaque session tokens (sha256 stored), deleted on
--                      logout / revoke / user delete -> immediate effect.
--   customers          company above ad accounts.
--   ad_accounts        platform ad accounts (google now), customer + sale owner.
--   account_grants     principal -> ad account (the ONLY source of visibility
--                      for every role except admin).
--   grant_requests     sale / head_ads request, admin approves / rejects.
--   permission_audit_log  who changed what for whom, when.

create table if not exists staff_users (
  id text primary key,
  email text not null,
  role text not null,
  display_name text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_users_role_chk check (role in ('admin', 'head_ads', 'optimizer', 'sale'))
);
create unique index if not exists staff_users_email_uidx on staff_users (lower(email));

create table if not exists customers (
  id text primary key,
  name text not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ad_accounts (
  id text primary key,
  platform text not null default 'google',
  external_id text,
  display_name text not null,
  customer_id text references customers (id) on delete set null,
  sale_staff_id text references staff_users (id) on delete set null,
  status text,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_accounts_platform_chk check (platform in ('google', 'facebook', 'tiktok'))
);
create index if not exists ad_accounts_customer_idx on ad_accounts (customer_id);
create index if not exists ad_accounts_sale_idx on ad_accounts (sale_staff_id);

create table if not exists client_users (
  id text primary key,
  username text not null,
  email text,
  display_name text,
  customer_id text references customers (id) on delete set null,
  role text not null default 'client_staff',
  password_hash text not null,
  failed_logins integer not null default 0,
  locked_until timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  constraint client_users_role_chk check (role in ('client_owner', 'client_staff'))
);
create unique index if not exists client_users_username_uidx on client_users (lower(username));

create table if not exists client_sessions (
  token_hash text primary key,
  client_user_id text not null references client_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  user_agent text
);
create index if not exists client_sessions_user_idx on client_sessions (client_user_id);

create table if not exists account_grants (
  id text primary key,
  principal_kind text not null,
  principal_id text not null,
  ad_account_id text not null,
  granted_by text,
  created_at timestamptz not null default now(),
  constraint account_grants_kind_chk check (principal_kind in ('staff', 'client'))
);
create unique index if not exists account_grants_uidx
  on account_grants (principal_kind, principal_id, ad_account_id);
create index if not exists account_grants_account_idx on account_grants (ad_account_id);

create table if not exists grant_requests (
  id text primary key,
  requested_by text not null,
  requester_role text not null,
  target_kind text not null,
  target_id text not null,
  ad_account_ids jsonb not null default '[]'::jsonb,
  note text,
  status text not null default 'pending',
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  constraint grant_requests_status_chk check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  constraint grant_requests_kind_chk check (target_kind in ('staff', 'client'))
);
create index if not exists grant_requests_status_idx on grant_requests (status, created_at desc);

create table if not exists permission_audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  target_kind text,
  target_id text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists permission_audit_log_at_idx on permission_audit_log (at desc);

create table if not exists adsops_kv (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

-- ── Carry over legacy Google-login memberships (0002) ───────────────────────
-- ops -> optimizer, sale -> sale. The super admin is hard-coded, never a row.
insert into staff_users (id, email, role, created_by)
select 'stf_' || md5(lower(m.email)),
       lower(m.email),
       case when bool_or(m.role = 'ops') then 'optimizer' else 'sale' end,
       'migration:0005'
from memberships m
where m.role in ('ops', 'sale')
  and lower(m.email) <> 'cuong@fagogroup.vn'
group by lower(m.email)
on conflict do nothing;

-- Per-account legacy grants keep exactly what those people could see before.
insert into account_grants (id, principal_kind, principal_id, ad_account_id, granted_by)
select 'grt_' || md5('staff:' || s.id || ':' || m.client_id), 'staff', s.id, m.client_id, 'migration:0005'
from memberships m
join staff_users s on lower(s.email) = lower(m.email)
where m.client_id is not null and m.role in ('ops', 'sale')
on conflict do nothing;

-- Legacy ops saw every account; the runtime seed grants them the accounts that
-- exist at first sync (explicit rows), then deletes this key. New accounts
-- after that are admin-only until granted.
insert into adsops_kv (key, value)
select 'legacy_ops_emails', coalesce(jsonb_agg(distinct lower(email)), '[]'::jsonb)
from memberships
where role = 'ops' and lower(email) <> 'cuong@fagogroup.vn'
on conflict (key) do nothing;

insert into permission_audit_log (actor, action, target_kind, target_id, detail)
select 'migration:0005', 'staff.migrated', 'staff', s.id,
       jsonb_build_object('email', s.email, 'role', s.role)
from staff_users s
where s.created_by = 'migration:0005';

-- Google-login "client" memberships are not carried over: customers now use
-- admin-created username/password logins (client_users). Logged for admin.
insert into permission_audit_log (actor, action, target_kind, target_id, detail)
select 'migration:0005', 'legacy_client_membership_not_migrated', 'email', lower(email),
       jsonb_build_object('client_id', client_id)
from memberships
where role = 'client';
