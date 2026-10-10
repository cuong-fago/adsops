-- Keyword optimization change log ("Nhật ký tối ưu").
-- Filled by a READ-ONLY Google Ads pull (GAQL SELECT on change_event / change_status).
-- Google only serves the last 30 days; rows stored here keep the history after that.
create table if not exists ads_change_events (
  id bigserial primary key,
  -- AdsOps ad account id (ad_accounts.id / client_id) and Google customer id (10 digits).
  client_id text not null,
  external_id text not null,
  change_date_time timestamptz not null,
  -- 'change_event' (has user + old/new values) or 'change_status' (shared lists, no user).
  source text not null default 'change_event',
  resource_type text not null,
  operation text not null,
  -- add_keyword | add_negative | remove_keyword | remove_negative | pause | enable | bid_change
  -- | other_update | shared_list_created | shared_list_changed | shared_list_removed
  -- | shared_list_attached | shared_list_detached | other
  action text not null,
  -- keyword | negative | shared_negative | other
  criterion_kind text not null,
  -- ad_group | campaign | shared
  level text not null,
  change_resource_name text not null,
  keyword_text text,
  match_type text,
  campaign_id text,
  campaign_name text,
  ad_group_id text,
  ad_group_name text,
  shared_set_name text,
  user_email text,
  client_type text,
  changed_fields text,
  old_status text,
  new_status text,
  old_bid_micros bigint,
  new_bid_micros bigint,
  raw jsonb,
  pulled_at timestamptz not null default now(),
  constraint ads_change_events_dedupe unique (external_id, change_resource_name, change_date_time, operation)
);
create index if not exists ads_change_events_client_time_idx on ads_change_events (client_id, change_date_time desc);

-- One row per pull attempt: lets the UI tell "chưa kéo" apart from "không có thay đổi".
create table if not exists ads_change_pulls (
  id bigserial primary key,
  client_id text not null,
  external_id text not null,
  pulled_at timestamptz not null default now(),
  covered_start timestamptz,
  covered_end timestamptz,
  ok boolean not null,
  row_count integer not null default 0,
  truncated boolean not null default false,
  trigger text not null default 'manual',
  actor text,
  error_vi text,
  note_vi text
);
create index if not exists ads_change_pulls_client_idx on ads_change_pulls (client_id, pulled_at desc);
