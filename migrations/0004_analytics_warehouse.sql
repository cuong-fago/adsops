-- Durable analytics warehouse snapshots (survive Vercel redeploys; public/ JSON is best-effort only).
create table if not exists adsops_analytics_warehouse (
  client_id text primary key,
  payload jsonb not null,
  pulled_at timestamptz not null default now(),
  warehouse_start date,
  warehouse_end date,
  lookback_days integer
);
create index if not exists adsops_analytics_warehouse_pulled_at_idx
  on adsops_analytics_warehouse (pulled_at desc);
