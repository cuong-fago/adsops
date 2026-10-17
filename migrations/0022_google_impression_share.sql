-- Google Ads impression-share metrics (read-only GAQL), cached per date range.
-- Share metrics are ratios over "eligible impressions", which Google never exposes, so they cannot be
-- summed or averaged across days. We query the range aggregate (no segments.date) and cache the
-- payload per (client, level, range), like meta_reach_cache.
create table if not exists google_share_cache (
  client_id text not null,
  -- account | campaign | ad_group | keyword
  level text not null,
  start_date date not null,
  end_date date not null,
  -- row key (campaign id / ad group id / "<ad group>~<criterion>" / "account") → { metric: value }
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (client_id, level, start_date, end_date)
);
