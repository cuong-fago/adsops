-- Shared negative keyword lists: Google's change_event has no SHARED_SET / SHARED_CRITERION type and
-- change_status only says "list changed at T" (no user, no keyword). AdsOps keeps a snapshot of each
-- negative list's keywords (read-only GAQL on shared_criterion) and diffs it on every pull to know
-- which negatives were added since the previous pull.
create table if not exists ads_shared_negative_snapshot (
  external_id text not null,
  shared_set text not null,
  criterion text not null,
  keyword_text text,
  match_type text,
  first_seen_at timestamptz not null default now(),
  primary key (external_id, criterion)
);
create index if not exists ads_shared_negative_snapshot_set_idx on ads_shared_negative_snapshot (external_id, shared_set);

-- One row per list once a snapshot exists (an empty list is still a baseline).
create table if not exists ads_shared_negative_baseline (
  external_id text not null,
  shared_set text not null,
  taken_at timestamptz not null default now(),
  primary key (external_id, shared_set)
);
