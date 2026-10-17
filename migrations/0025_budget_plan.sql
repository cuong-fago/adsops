-- Monthly budget plan per account (AdsOps's own data; never written to Google / Meta).
create table if not exists adsops_budget_plan (
  client_id text not null,
  -- YYYY-MM
  month text not null,
  planned_budget numeric not null,
  target_conv numeric,
  target_cpl numeric,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (client_id, month)
);
