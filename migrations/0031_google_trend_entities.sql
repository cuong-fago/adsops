-- "Cần xử lý (3 tháng)": nightly monthly metrics per entity (account channel / campaign / ad group / asset group).
-- Raw clicks / conversions (primary) / spend per month; ratios and thresholds are applied at read time.
create table if not exists google_trend_entity (
  client_id text not null,
  level text not null check (level in ('account', 'campaign', 'ad_group', 'asset_group')),
  entity_id text not null,
  campaign_id text,
  name text,
  channel text,
  -- active in all 3 complete months (like-for-like)
  like_set boolean not null,
  months jsonb not null,
  computed_at timestamptz not null default now(),
  primary key (client_id, level, entity_id)
);
create index if not exists google_trend_entity_client on google_trend_entity (client_id);

alter table google_trend_snapshot add column if not exists entity_error text;

-- Small key/value settings (Admin-editable). needs_action_thresholds = {"step":0.1,"conv":5,"clicks":100}
create table if not exists adsops_settings (
  key text primary key,
  value jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);
