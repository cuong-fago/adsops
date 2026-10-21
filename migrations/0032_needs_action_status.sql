-- "Cần xử lý (3 tháng)": status per problem row. Key = account|level|entity|channel|metric|month T.
create table if not exists needs_action_status (
  key text primary key,
  client_id text not null,
  level text not null,
  entity_id text not null,
  channel text not null,
  metric text not null,
  month text not null,
  status text not null check (status in ('new', 'doing', 'done')),
  note text,
  -- metric value (month T) when marked done; the row comes back if it worsens beyond the threshold vs this
  value_at_done double precision,
  updated_by text,
  updated_at timestamptz not null default now()
);
create index if not exists needs_action_status_client on needs_action_status (client_id);
create table if not exists needs_action_status_log (
  id bigserial primary key,
  key text not null,
  client_id text not null,
  status text not null,
  note text,
  changed_by text,
  changed_at timestamptz not null default now()
);
create index if not exists needs_action_status_log_key on needs_action_status_log (key);
