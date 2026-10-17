-- "Báo cáo khách hàng": saved client reports (snapshot of AdsOps data), share links, schedules.
-- Only AdsOps data; nothing here writes to Google / Meta.
create table if not exists adsops_client_reports (
  id bigserial primary key,
  -- 'group' (customers.id) or 'account' (ad_accounts.id)
  scope_kind text not null,
  scope_id text not null,
  title text not null,
  -- week | month | custom
  period_kind text not null,
  start_date text not null,
  end_date text not null,
  -- Accounts frozen at creation; every viewer must be allowed on ALL of them.
  account_ids text[] not null,
  -- draft | sent
  status text not null default 'draft',
  -- Snapshot; null = not generated yet (scheduled drafts are generated lazily on first open).
  data jsonb,
  -- { good, issues, plan, edited }
  notes jsonb not null default '{}'::jsonb,
  -- { show_work, show_appendix }
  options jsonb not null default '{}'::jsonb,
  auto boolean not null default false,
  generated_at timestamptz,
  sent_at timestamptz,
  sent_by text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists adsops_client_reports_scope_idx on adsops_client_reports (scope_kind, scope_id, start_date desc);
create unique index if not exists adsops_client_reports_auto_uq on adsops_client_reports (scope_kind, scope_id, period_kind, start_date) where auto;

-- Share links: only a SHA-256 of the token is stored. Read-only, one report, expiring, revocable.
create table if not exists adsops_report_links (
  id bigserial primary key,
  report_id bigint not null references adsops_client_reports(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  last_viewed_at timestamptz,
  views integer not null default 0
);
create index if not exists adsops_report_links_report_idx on adsops_report_links (report_id);

-- Auto drafts: weekly / monthly per client group or account (created by the daily cron, data filled on open).
create table if not exists adsops_report_schedules (
  scope_kind text not null,
  scope_id text not null,
  frequency text not null check (frequency in ('weekly', 'monthly')),
  enabled boolean not null default true,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (scope_kind, scope_id)
);
