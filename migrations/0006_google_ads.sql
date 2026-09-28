-- Google Ads API (read-only) connection for AdsOps.
-- The refresh token is stored AES-256-GCM encrypted (key derived from
-- BETTER_AUTH_SECRET) and is never returned to the browser.
create table if not exists adsops_google_ads_credential (
  id text primary key,
  google_email text,
  refresh_token_enc text not null,
  scope text,
  connected_by text,
  connected_at timestamptz not null default now(),
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_message text
);

-- Short-lived per-account lock so concurrent page views trigger one refresh.
create table if not exists adsops_ads_refresh_lock (
  client_id text primary key,
  locked_until timestamptz not null
);
