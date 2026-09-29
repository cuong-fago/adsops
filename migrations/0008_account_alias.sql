-- Local display alias per ad account (Google Ads customer).
-- Not sent to Google Ads. Re-pulls update display_name only and leave alias alone.
-- Empty / null means the picker shows the Google name, as before.
alter table ad_accounts add column if not exists alias text;
