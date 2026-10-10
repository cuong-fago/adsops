-- "Ngân sách còn lại": latest read-only check per ad account (account_budget + 7-day spend).
-- Prepaid / manual-payment accounts have no account_budget; Google does not expose their balance,
-- so kind = 'no_budget' and no remaining amount is stored (never estimated).
create table if not exists ads_budget_runway (
  client_id text primary key,
  external_id text not null,
  checked_at timestamptz not null default now(),
  ok boolean not null,
  -- account_budget | no_budget | error
  kind text not null,
  currency text,
  limit_micros bigint,
  served_micros bigint,
  remaining_micros bigint,
  infinite boolean not null default false,
  avg7_micros bigint,
  avg3_micros bigint,
  runway_days double precision,
  budget_start text,
  budget_end text,
  -- red | amber | ok | infinite | no_spend | no_budget | error
  status text not null,
  expiring boolean not null default false,
  error_vi text,
  raw jsonb
);
create index if not exists ads_budget_runway_checked_idx on ads_budget_runway (checked_at);
