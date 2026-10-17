-- Business outcomes per account per month (entered by staff or imported from CSV/XLSX; AdsOps data only).
-- campaign = '' is the account total; other values are an optional per-campaign breakdown (free text name or id).
create table if not exists adsops_outcomes (
  client_id text not null,
  month text not null,
  campaign text not null default '',
  valid_leads numeric,
  closed_customers numeric,
  revenue numeric,
  note text,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (client_id, month, campaign)
);
create index if not exists adsops_outcomes_month_idx on adsops_outcomes (month);
-- Extra KPI targets on the monthly plan.
alter table adsops_budget_plan add column if not exists target_cac numeric;
alter table adsops_budget_plan add column if not exists target_roas numeric;
