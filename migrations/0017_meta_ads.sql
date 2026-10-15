-- Facebook (Meta) Ads, read-only via the Marketing API (ads_read System User token).
-- Accounts live in ad_accounts with platform = 'facebook', id = 'fb_<ad account id>'.
-- Budget runway reuses ads_budget_runway; 10-day spend reuses ad_accounts.spend10_* (0016).
create table if not exists meta_insights_daily (
  client_id text not null,
  -- account | campaign | adset
  level text not null,
  object_id text not null,
  date date not null,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  -- Meta "lead" result (first present of lead / lead_grouped / onsite_web_lead / fb_pixel_lead)
  leads numeric,
  -- onsite_conversion.messaging_conversation_started_7d
  messages numeric,
  actions jsonb,
  pulled_at timestamptz not null default now(),
  primary key (client_id, level, object_id, date)
);
create index if not exists meta_insights_daily_client_date_idx on meta_insights_daily (client_id, date);

create table if not exists meta_account_state (
  client_id text primary key,
  account_id text not null,
  account_status integer,
  currency text,
  timezone_name text,
  amount_spent numeric,
  spend_cap numeric,
  balance numeric,
  checked_at timestamptz not null default now(),
  insights_through date,
  error text
);
