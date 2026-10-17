-- Facebook delivery + video metrics (read-only Graph GET). Additive per-day values only;
-- CPM / link CTR / cost per link click are derived from sums. Reach is NOT additive across days:
-- it is fetched per range (time_increment=all_days) into meta_reach_cache, never summed.
alter table meta_insights_daily add column if not exists inline_link_clicks bigint;
alter table meta_insights_daily add column if not exists video_p25 numeric;
alter table meta_insights_daily add column if not exists video_p50 numeric;
alter table meta_insights_daily add column if not exists video_p75 numeric;
alter table meta_insights_daily add column if not exists video_p100 numeric;
alter table meta_insights_daily add column if not exists video_thruplay numeric;
-- 3-second video views (action video_view) and landing page views, also inside actions jsonb.
alter table meta_insights_daily add column if not exists video_3s numeric;
alter table meta_insights_daily add column if not exists landing_page_views numeric;

-- Earliest day re-pulled with the new fields (contiguous up to today). Older stored days are
-- upgraded by the backfill in 30-day chunks.
alter table meta_account_state add column if not exists fields_v2_from date;

create table if not exists meta_reach_cache (
  client_id text not null,
  level text not null,
  object_id text not null,
  start_date date not null,
  end_date date not null,
  reach numeric,
  frequency numeric,
  fetched_at timestamptz not null default now(),
  primary key (client_id, level, object_id, start_date, end_date)
);
create index if not exists meta_reach_cache_range_idx on meta_reach_cache (client_id, start_date, end_date);
