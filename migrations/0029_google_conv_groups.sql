-- Manual override of the standard conversion group per Google account + conversion action.
-- Auto classification lives in code; a row here wins. AdsOps never writes to Google.
create table if not exists google_conv_group_map (
  client_id text not null,
  conversion_action_id text not null,
  group_key text not null check (group_key in ('call', 'zalo', 'messenger', 'form', 'purchase', 'other')),
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (client_id, conversion_action_id)
);
