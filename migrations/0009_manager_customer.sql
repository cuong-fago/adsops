-- Which MCC a Google Ads customer was listed from. Local only; not sent back to Google.
-- The pull button also adds this column if it is missing.
alter table ad_accounts add column if not exists manager_customer_id text;
