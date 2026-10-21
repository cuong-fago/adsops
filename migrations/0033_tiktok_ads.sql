-- TikTok Ads (TikTok API for Business v1.3): OAuth tokens, advertisers, structure, daily insights.
-- AdsOps only READS from TikTok (GET endpoints + the OAuth token exchange). Platform 'tiktok', id tt_<advertiser_id>.

-- One row per authorization (one TikTok for Business user). Token AES-256-GCM encrypted; never returned to a browser.
create table if not exists tiktok_tokens (
  id bigserial primary key,
  token_enc text not null,
  -- fingerprint (sha256 prefix) to update the same authorization instead of duplicating it
  token_fp text not null unique,
  scope jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_ok_at timestamptz,
  last_error text
);

-- Short-lived OAuth state (CSRF) for the connect flow.
create table if not exists tiktok_oauth_states (
  state text primary key,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists tiktok_account_state (
  client_id text primary key,
  advertiser_id text not null,
  token_id bigint references tiktok_tokens(id) on delete set null,
  name text,
  currency text,
  timezone text,
  status text,
  checked_at timestamptz,
  insights_through date,
  history_from date,
  error text
);

create table if not exists tiktok_entities (
  client_id text not null,
  -- campaign | ad_group | ad
  level text not null,
  entity_id text not null,
  campaign_id text,
  ad_group_id text,
  name text,
  status text,
  raw jsonb,
  updated_at timestamptz not null default now(),
  primary key (client_id, level, entity_id)
);

-- Daily delivery per level. A day with no row = no delivery reported. NULL = not returned (never 0).
create table if not exists tiktok_insights_daily (
  client_id text not null,
  -- account | campaign | ad_group | ad
  level text not null,
  entity_id text not null,
  date date not null,
  campaign_id text,
  ad_group_id text,
  spend numeric,
  impressions numeric,
  reach numeric,
  clicks numeric,
  conversions numeric,
  video_play_actions numeric,
  video_watched_2s numeric,
  video_watched_6s numeric,
  video_views_p100 numeric,
  leads numeric,
  pulled_at timestamptz not null default now(),
  primary key (client_id, level, entity_id, date)
);
create index if not exists tiktok_insights_daily_client_date_idx on tiktok_insights_daily (client_id, level, date);
