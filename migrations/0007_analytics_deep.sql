-- Ad group / keyword / search term daily rows, one row per (client, layer, month).
-- Filled month by month by the resumable deep pull (read-only Google Ads GAQL).
-- covered_start/covered_end = days actually pulled for that month; days outside
-- are "chưa kéo" (never zero-filled).
create table if not exists adsops_analytics_deep (
  client_id text not null,
  layer text not null,
  month text not null,
  rows jsonb not null,
  covered_start date not null,
  covered_end date not null,
  pulled_at timestamptz not null default now(),
  primary key (client_id, layer, month)
);
