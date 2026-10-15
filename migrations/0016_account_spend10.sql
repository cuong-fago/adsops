-- 10-day spend check per ad account (GAQL customer metrics.cost_micros by date, read-only).
-- Accounts with zero spend over the last 10 days are hidden from staff lists and background
-- checks (never deleted); any spend brings them back on the next evaluation.
alter table ad_accounts add column if not exists spend10_micros bigint;
alter table ad_accounts add column if not exists spend10_last_date date;
alter table ad_accounts add column if not exists spend10_checked_at timestamptz;
alter table ad_accounts add column if not exists spend10_error text;
