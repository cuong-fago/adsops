-- Google Ads optimization score (customer.optimization_score), one row per account per day
-- (account timezone). Read-only from Google; AdsOps keeps the history from the first check on.
create table if not exists ads_optimization_score (
  external_id text not null,
  date date not null,
  client_id text,
  score numeric,
  weight numeric,
  checked_at timestamptz not null default now(),
  error text,
  primary key (external_id, date)
);
create index if not exists ads_optimization_score_client_idx on ads_optimization_score (client_id, date desc);
