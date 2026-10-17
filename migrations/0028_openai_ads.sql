-- ChatGPT Ads (OpenAI Advertiser API): accounts, encrypted keys, structure, daily insights.
-- AdsOps only READS from OpenAI (GET + the read-only POST /v1/conversions/insights report).
alter table ad_accounts drop constraint if exists ad_accounts_platform_chk;
alter table ad_accounts add constraint ad_accounts_platform_chk check (platform in ('google', 'facebook', 'tiktok', 'openai'));

-- One API key per OpenAI ad account. Stored AES-256-GCM encrypted (OPENAI_ADS_ENC_KEY); never returned to a browser.
create table if not exists openai_ads_keys (
  ad_account_id text primary key,
  key_enc text not null,
  -- 'form' (Admin pasted) | 'env' (OPENAI_ADS_API_KEY seed)
  source text not null,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_ok_at timestamptz,
  last_error text
);

create table if not exists openai_account_state (
  client_id text primary key,
  ad_account_id text not null,
  name text,
  currency text,
  timezone text,
  status text,
  checked_at timestamptz,
  insights_through date,
  history_from date,
  error text
);

create table if not exists openai_entities (
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

-- Daily delivery (+ conversions / attributed sales) per level. A day with no row = no delivery reported.
create table if not exists openai_insights_daily (
  client_id text not null,
  -- account | campaign | ad_group | ad
  level text not null,
  entity_id text not null,
  date date not null,
  campaign_id text,
  ad_group_id text,
  impressions numeric,
  clicks numeric,
  spend numeric,
  ctr numeric,
  cpc numeric,
  cpm numeric,
  conversions numeric,
  sales numeric,
  pulled_at timestamptz not null default now(),
  primary key (client_id, level, entity_id, date)
);
create index if not exists openai_insights_daily_client_date_idx on openai_insights_daily (client_id, level, date);
