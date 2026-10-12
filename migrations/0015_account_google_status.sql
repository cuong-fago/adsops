-- Google's customer status per ad account (customer_client.status from the MCC pull):
-- ENABLED / SUSPENDED / CANCELED / CLOSED. Used to hide inactive accounts by default.
alter table ad_accounts add column if not exists google_status text;
alter table ad_accounts add column if not exists google_status_at timestamptz;
