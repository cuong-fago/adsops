-- Facebook purchase values (action_values) per daily row; messaging + purchase counts come from the existing actions jsonb.
alter table meta_insights_daily add column if not exists action_values jsonb;
-- Earliest date from which every stored day was pulled with action_values (grows contiguously, like fields_v2_from).
alter table meta_account_state add column if not exists fields_v3_from date;
