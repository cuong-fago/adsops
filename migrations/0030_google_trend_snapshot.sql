-- Nightly Google "Xu hướng 3T" snapshot per account (like-for-like per channel type). Staff only.
create table if not exists google_trend_snapshot (
  client_id text primary key,
  -- last complete month evaluated, YYYY-MM
  month text,
  -- 'worse' | 'stable' | 'better' | 'low' | 'none' | 'error'
  verdict text not null,
  score double precision,
  payload jsonb,
  error text,
  computed_at timestamptz not null default now()
);
