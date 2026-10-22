-- Admin-saved Google Ads UI deep link per Google account: only the numeric ocid is kept.
create table if not exists google_ads_links (
  cid text primary key check (cid ~ '^[0-9]{10}$'),
  ocid text not null check (ocid ~ '^[0-9]{4,20}$'),
  updated_by text,
  updated_at timestamptz not null default now()
);
-- Rock Kitchen & Bar (444-791-2752)
insert into google_ads_links (cid, ocid, updated_by) values ('4447912752', '8188564074', 'seed')
on conflict (cid) do nothing;
