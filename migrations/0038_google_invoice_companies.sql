-- Hóa đơn Google theo công ty: account -> payments profile history (read from billing_setup), company names/MST,
-- buyer name/MST parsed from documents.
create table if not exists google_account_company_history (
  cid text not null,
  setup_id text not null,
  status text not null,
  payments_account_id text,
  payments_account_name text,
  profile_id text,
  profile_name text,
  -- From billing_setup.start_date_time / end_date_time (inclusive dates). null = Google gave none.
  valid_from date,
  valid_to date,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (cid, setup_id)
);
create index if not exists google_account_company_history_profile_idx on google_account_company_history (profile_id);

create table if not exists google_companies (
  profile_id text primary key,
  profile_name text,
  display_name text,
  mst text,
  -- 'manual' (set by Admin/Kế toán) or 'invoice' (auto-filled from a parsed VN tax invoice)
  mst_source text,
  mst_doc text,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists google_billing_sync (
  cid text primary key,
  ok boolean not null,
  message text,
  setups int not null default 0,
  checked_at timestamptz not null default now()
);

alter table google_invoices add column if not exists buyer_name text;
alter table google_invoices add column if not exists buyer_mst text;
