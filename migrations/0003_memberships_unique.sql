-- One grant per email + role + account. Ops rows use NULL client_id (Postgres
-- treats NULLs as distinct, so duplicate ops invites are still blocked in code).
create unique index if not exists memberships_email_role_client_uidx
  on memberships (email, role, client_id);
