-- Hóa đơn Google: invoice documents (API ListInvoices read, or uploaded files) + role Kế toán.
alter table staff_users drop constraint if exists staff_users_role_chk;
alter table staff_users add constraint staff_users_role_chk check (role in ('admin', 'head_ads', 'optimizer', 'sale', 'accountant'));

create table if not exists google_invoices (
  doc_no text primary key,
  -- 'vn_tax' = Hoá đơn thuế tại Việt Nam (counted in totals); 'invoice' = Hóa đơn; 'credit_memo'; 'other'
  doc_type text not null,
  cid text,
  client_id text,
  issue_date date,
  amount numeric,
  currency text,
  source text not null,
  billing_setup text,
  file_name text,
  raw jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists google_invoices_issue_idx on google_invoices (issue_date);
create index if not exists google_invoices_cid_idx on google_invoices (cid);

-- Last API read per account (nightly ingest): ok=false + message when Google refuses (e.g. prepaid).
create table if not exists google_invoice_sync (
  cid text primary key,
  ok boolean not null,
  code text,
  message text,
  found int not null default 0,
  checked_at timestamptz not null default now()
);
