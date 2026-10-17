-- Google Ads keyword Quality Score snapshots (current state only; Google keeps no QS history).
-- One row per keyword per snapshot date (nightly cron + on demand when the Từ khoá tab opens).
create table if not exists google_qs_snapshot (
  client_id text not null,
  date date not null,
  ad_group_id text not null,
  criterion_id text not null,
  campaign_id text,
  campaign_name text,
  ad_group_name text,
  keyword_text text,
  match_type text,
  quality_score smallint,
  creative_quality text,
  post_click_quality text,
  predicted_ctr text,
  pulled_at timestamptz not null default now(),
  primary key (client_id, date, ad_group_id, criterion_id)
);
create index if not exists google_qs_snapshot_client_date_idx on google_qs_snapshot (client_id, date);
