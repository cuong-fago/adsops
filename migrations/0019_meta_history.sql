-- Earliest date for which Meta insights were actually fetched (all 4 levels), so a period can be
-- called "covered" even when an account had no delivery. NULL = only the recent 35-day window.
alter table meta_account_state add column if not exists history_from date;
