-- Google Ads conversions per conversion action (read-only GAQL, segments.conversion_action*),
-- at campaign / ad_group / keyword level per day. The conversion_action segment cannot be combined
-- with impressions / clicks / cost, so this is a separate pull from the warehouse.
create table if not exists google_conv_action_daily (
  client_id text not null,
  customer_id text not null,
  date date not null,
  -- campaign | ad_group | keyword
  level text not null,
  campaign_id text not null default '',
  ad_group_id text not null default '',
  criterion_id text not null default '',
  action_id text not null,
  action_name text,
  category text,
  conversions numeric not null default 0,
  value numeric not null default 0,
  all_conversions numeric not null default 0,
  pulled_at timestamptz not null default now(),
  primary key (client_id, level, date, campaign_id, ad_group_id, criterion_id, action_id)
);
create index if not exists google_conv_action_daily_client_date_idx on google_conv_action_daily (client_id, level, date);

-- Days actually fetched (all three levels), so "no rows" can be told apart from "not pulled".
create table if not exists google_conv_action_days (
  client_id text not null,
  date date not null,
  pulled_at timestamptz not null default now(),
  primary key (client_id, date)
);
