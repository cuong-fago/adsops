-- Google's change_status returns nothing for keywords added to shared negative lists, so AdsOps
-- watches each list's member_count (one cheap read-only GAQL per account) and records an
-- increase as "Thêm phủ định vào danh sách dùng chung" at the time it is detected.
create table if not exists ads_shared_set_counts (
  external_id text not null,
  shared_set text not null,
  name text,
  member_count integer not null,
  checked_at timestamptz not null default now(),
  primary key (external_id, shared_set)
);
