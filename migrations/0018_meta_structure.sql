-- Facebook structure metadata (campaign / adset / ad config), read-only via Graph GET.
-- Refreshed by the daily cron, "Kiểm tra lại" and "Kéo tài khoản Facebook". Thumbnail URLs expire, so each sync overwrites them.
create table if not exists meta_objects (
  client_id text not null,
  -- campaign | adset | ad
  level text not null,
  object_id text not null,
  campaign_id text,
  adset_id text,
  name text,
  status text,
  effective_status text,
  config jsonb,
  pulled_at timestamptz not null default now(),
  primary key (client_id, level, object_id)
);
-- Ad-level daily insights reuse meta_insights_daily (level = 'ad').
alter table meta_insights_daily add column if not exists ad_id text;
alter table meta_insights_daily add column if not exists ad_name text;
