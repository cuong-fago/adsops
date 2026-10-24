/**
 * Hóa đơn Google. Google side is read-only: one GAQL SELECT on billing_setup and
 * InvoiceService.ListInvoices (GET). Nothing is written to Google.
 */
import { getSql } from "@/lib/db";
import { AdsApiError, listInvoicesRaw, resolveAdsConfig, searchStream } from "./google-ads.server.ts";
import { loginCustomerFor } from "./mcc-list.server.ts";
import { accountTotal, cidDigits, companyAt, dashCid, issueMonthEnum, normDocNo, normMst, rowCounted, setupDate, type CompanyPeriod, type InvoiceDocType, type InvoiceRow } from "./google-invoices.ts";
import { asRec } from "./warehouse.server.ts";

export type InvoiceAccount = { client_id: string; name: string; cid: string; customer: string | null };

const isGoogle = (id: string) => !id.startsWith("fb_") && !id.startsWith("oa_") && !id.startsWith("tt_");

/** Every Google account (not scoped by Sale assignment): Admin and Kế toán only, enforced by callers. */
export async function invoiceAccounts(): Promise<InvoiceAccount[]> {
  const { listRosterAccounts } = await import("./access.server");
  const { withPulledMccClients } = await import("./mcc-import.server");
  const { cidOf } = await import("./google-ads-link.ts");
  const roster = await listRosterAccounts();
  const dir = await withPulledMccClients({ access: {} as never, clients: roster, mcc: null } as never, "all");
  const sql = await getSql();
  const cust = await sql
    .query<{ id: string; name: string | null }>(`select a.id, c.name from ad_accounts a left join customers c on c.id = a.customer_id`)
    .catch(() => [] as { id: string; name: string | null }[]);
  const custBy = new Map(cust.map((r) => [r.id, r.name]));
  const out = new Map<string, InvoiceAccount>();
  for (const c of (dir as { clients: Array<{ client_id: string; display_name: string; alias?: string; customer_id_dashed?: string }> }).clients) {
    if (!c.client_id || !isGoogle(c.client_id) || out.has(c.client_id)) continue;
    const cid = cidOf(c.customer_id_dashed || "", c.client_id);
    if (!cid) continue;
    out.set(c.client_id, { client_id: c.client_id, name: c.alias || c.display_name || dashCid(cid), cid, customer: custBy.get(c.client_id) ?? null });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

type Setup = {
  resource: string;
  id: string;
  status: string;
  payments: string | null;
  payments_account_id: string | null;
  profile_id: string | null;
  profile_name: string | null;
  valid_from: string | null;
  valid_to: string | null;
};

async function billingSetups(cid: string, login?: string): Promise<Setup[]> {
  const cfg = await resolveAdsConfig();
  const rows = await searchStream(
    cfg,
    cid,
    "SELECT billing_setup.resource_name, billing_setup.id, billing_setup.status, billing_setup.start_date_time, billing_setup.end_date_time, billing_setup.payments_account_info.payments_account_id, billing_setup.payments_account_info.payments_account_name, billing_setup.payments_account_info.payments_profile_id, billing_setup.payments_account_info.payments_profile_name FROM billing_setup",
    login,
  );
  return rows.map((r) => {
    const b = asRec(asRec(r).billingSetup);
    const pi = asRec(b.paymentsAccountInfo);
    const str = (v: unknown) => (v == null || v === "" ? null : String(v));
    return {
      resource: String(b.resourceName || ""),
      id: String(b.id || ""),
      status: String(b.status || ""),
      payments: str(pi.paymentsAccountName),
      payments_account_id: str(pi.paymentsAccountId),
      profile_id: str(pi.paymentsProfileId),
      profile_name: str(pi.paymentsProfileName),
      valid_from: setupDate(b.startDateTime),
      valid_to: setupDate(b.endDateTime, true),
    };
  });
}

export type ProbeResult = {
  cid: string;
  month: string;
  ok: boolean;
  message: string;
  google_codes: string[];
  setups: Setup[];
  calls: Array<{ billing_setup: string; ok: boolean; count: number; message: string | null; google_codes: string[]; raw: string | null }>;
};

const errText = (e: unknown) => (e instanceof AdsApiError ? e.adminMessage : e instanceof Error ? e.message : String(e)).slice(0, 600);
const errCodes = (e: unknown) => (e instanceof AdsApiError ? e.googleCodes : []);

/** Admin probe: billing setups + ListInvoices for one account/month; raw Google JSON returned as-is. */
export async function probeInvoices(cidRaw: string, ym: string): Promise<ProbeResult> {
  const cid = cidDigits(cidRaw);
  const mo = issueMonthEnum(ym);
  if (!cid || !mo) throw new Error("CID hoặc tháng không hợp lệ.");
  const base: ProbeResult = { cid, month: ym, ok: false, message: "", google_codes: [], setups: [], calls: [] };
  const cfg = await resolveAdsConfig();
  const login = await loginCustomerFor(cfg, cid).catch(() => undefined);
  try {
    base.setups = await billingSetups(cid, login);
  } catch (e) {
    return { ...base, message: `Không đọc được billing setup: ${errText(e)}`, google_codes: errCodes(e) };
  }
  if (!base.setups.length) return { ...base, message: "Google không trả billing setup nào cho tài khoản này, nên không gọi được ListInvoices." };
  for (const s of base.setups) {
    if (!s.resource) continue;
    try {
      const raw = await listInvoicesRaw(cfg, cid, s.resource, mo.year, mo.month, login);
      const inv = Array.isArray(asRec(raw).invoices) ? (asRec(raw).invoices as unknown[]) : [];
      base.calls.push({ billing_setup: s.resource, ok: true, count: inv.length, message: null, google_codes: [], raw: JSON.stringify(raw, null, 2).slice(0, 30_000) });
    } catch (e) {
      base.calls.push({ billing_setup: s.resource, ok: false, count: 0, message: errText(e), google_codes: errCodes(e), raw: null });
    }
  }
  const okCalls = base.calls.filter((c) => c.ok);
  const n = okCalls.reduce((s, c) => s + c.count, 0);
  base.ok = okCalls.length > 0;
  base.google_codes = [...new Set(base.calls.flatMap((c) => c.google_codes))];
  base.message = base.ok
    ? n
      ? `Google trả ${n} chứng từ cho tháng ${ym}.`
      : `Google trả lời thành công nhưng không có chứng từ nào cho tháng ${ym}.`
    : base.calls[0]?.message || "ListInvoices không thành công.";
  await recordSync(cid, base.ok, base.google_codes[0] || null, base.message, n);
  return base;
}

async function recordSync(cid: string, ok: boolean, code: string | null, message: string, found: number) {
  const sql = await getSql();
  await sql
    .query(
      `insert into google_invoice_sync (cid, ok, code, message, found, checked_at) values ($1,$2,$3,$4,$5, now())
       on conflict (cid) do update set ok = excluded.ok, code = excluded.code, message = excluded.message, found = excluded.found, checked_at = now()`,
      [cid, ok, code, message.slice(0, 600), found],
    )
    .catch(() => {});
}

const microsAmt = (v: unknown) => (v == null || v === "" ? null : Number(v) / 1e6);

/** Pull invoices for one account and months; upserts API rows (uploaded rows are never overwritten). */
export async function ingestAccount(acc: InvoiceAccount, months: string[]): Promise<{ found: number; ok: boolean; message: string; code: string | null }> {
  const cfg = await resolveAdsConfig();
  const login = await loginCustomerFor(cfg, acc.cid).catch(() => undefined);
  let setups: Setup[];
  try {
    setups = (await billingSetups(acc.cid, login)).filter((s) => s.resource && s.status === "APPROVED");
  } catch (e) {
    const r = { found: 0, ok: false, message: errText(e), code: errCodes(e)[0] || null };
    await recordSync(acc.cid, false, r.code, r.message, 0);
    return r;
  }
  if (!setups.length) {
    await recordSync(acc.cid, false, "NO_BILLING_SETUP", "Không có billing setup đã duyệt.", 0);
    return { found: 0, ok: false, message: "Không có billing setup đã duyệt.", code: "NO_BILLING_SETUP" };
  }
  const sql = await getSql();
  let found = 0;
  let lastErr: { message: string; code: string | null } | null = null;
  let anyOk = false;
  for (const s of setups) {
    for (const ym of months) {
      const mo = issueMonthEnum(ym)!;
      try {
        const raw = await listInvoicesRaw(cfg, acc.cid, s.resource, mo.year, mo.month, login);
        anyOk = true;
        for (const iv of Array.isArray(asRec(raw).invoices) ? (asRec(raw).invoices as unknown[]) : []) {
          const r = asRec(iv);
          const id = String(r.id || "");
          if (!id) continue;
          const type: InvoiceDocType = r.type === "CREDIT_MEMO" ? "credit_memo" : r.type === "INVOICE" ? "invoice" : "other";
          // Amount for this account when the invoice covers several accounts; else the invoice total.
          const mine = (Array.isArray(r.accountSummaries) ? (r.accountSummaries as unknown[]) : [])
            .map(asRec)
            .find((a) => cidDigits(String(a.customer || "").replace(/^customers\//, "")) === acc.cid);
          const amount = mine && mine.billedAmountMicros != null ? microsAmt(mine.billedAmountMicros) : microsAmt(r.totalAmountMicros);
          await sql.query(
            `insert into google_invoices (doc_no, doc_type, cid, client_id, issue_date, amount, currency, source, billing_setup, raw)
             values ($1,$2,$3,$4,$5,$6,$7,'api',$8,$9::jsonb)
             on conflict (doc_no) do update set doc_type = excluded.doc_type, issue_date = excluded.issue_date, amount = excluded.amount,
               currency = excluded.currency, raw = excluded.raw, updated_at = now()
             where google_invoices.source = 'api'`,
            [normDocNo(id), type, acc.cid, acc.client_id, typeof r.issueDate === "string" ? r.issueDate : null, amount, (r.currencyCode as string) || null, s.resource, JSON.stringify(r).replace(/\\u0000/g, "")],
          );
          found++;
        }
      } catch (e) {
        lastErr = { message: errText(e), code: errCodes(e)[0] || null };
      }
    }
  }
  const ok = anyOk;
  const message = ok ? `Đọc được ${found} chứng từ.` : lastErr?.message || "Không đọc được.";
  await recordSync(acc.cid, ok, ok ? null : lastErr?.code || null, message, found);
  return { found, ok, message, code: ok ? null : lastErr?.code || null };
}

/** Google refuses these for the billing type; re-check weekly only. */
const PERMANENT = new Set(["NOT_INVOICED_CUSTOMER", "BILLING_SETUP_NOT_ON_MONTHLY_INVOICING", "NO_BILLING_SETUP"]);

function ymOf(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/** Nightly: this and last month for active Google accounts, within the deadline. */
export async function refreshInvoices(ids: string[], deadline: number) {
  const want = new Set(ids);
  const all = await invoiceAccounts();
  // Account -> company mapping for every Google account first (one cheap GAQL each), then documents.
  const companies = await syncCompanies(all, Math.min(deadline, Date.now() + 150_000)).catch((e) => ({ error: errText(e) }));
  const accs = all.filter((a) => want.has(a.client_id));
  const sql = await getSql();
  const sync = await sql
    .query<{ cid: string; ok: boolean; code: string | null; checked_at: Date | string }>(`select cid, ok, code, checked_at from google_invoice_sync`)
    .catch(() => []);
  const syncBy = new Map(sync.map((r) => [r.cid, r]));
  const now = new Date();
  const months = [ymOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))), ymOf(now)];
  const todo = accs.filter((a) => {
    const s = syncBy.get(a.cid);
    if (!s || s.ok || !s.code || !PERMANENT.has(s.code)) return true;
    return Date.now() - new Date(s.checked_at).getTime() > 7 * 86400_000;
  });
  let done = 0, okN = 0, found = 0, skipped = accs.length - todo.length;
  const queue = [...todo];
  const seen = new Set<string>();
  const worker = async () => {
    for (;;) {
      if (Date.now() > deadline) return;
      const a = queue.shift();
      if (!a) return;
      if (seen.has(a.cid)) continue;
      seen.add(a.cid);
      const r = await ingestAccount(a, months).catch(() => ({ ok: false, found: 0 }));
      done++;
      if (r.ok) okN++;
      found += r.found;
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { companies, accounts: accs.length, checked: done, read_ok: okN, found, skipped_unsupported: skipped, left: queue.length };
}

// ---------- Account -> company (payments profile) mapping ----------

/** Read billing_setup (GAQL SELECT) for every account and store the history. Read-only to Google. */
export async function syncCompanies(accs: InvoiceAccount[], deadline: number) {
  const sql = await getSql();
  const cfg = await resolveAdsConfig();
  const queue = [...new Map(accs.map((a) => [a.cid, a])).values()];
  let ok = 0, failed = 0, setups = 0;
  const worker = async () => {
    for (;;) {
      if (Date.now() > deadline) return;
      const a = queue.shift();
      if (!a) return;
      try {
        const login = await loginCustomerFor(cfg, a.cid).catch(() => undefined);
        const list = await billingSetups(a.cid, login);
        for (const b of list) {
          if (!b.id) continue;
          await sql.query(
            `insert into google_account_company_history (cid, setup_id, status, payments_account_id, payments_account_name, profile_id, profile_name, valid_from, valid_to)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             on conflict (cid, setup_id) do update set status = excluded.status, payments_account_id = excluded.payments_account_id,
               payments_account_name = excluded.payments_account_name, profile_id = excluded.profile_id, profile_name = excluded.profile_name,
               valid_from = excluded.valid_from, valid_to = excluded.valid_to, last_seen = now()`,
            [a.cid, b.id, b.status, b.payments_account_id, b.payments, b.profile_id, b.profile_name, b.valid_from, b.valid_to],
          );
          if (b.profile_id) {
            await sql.query(
              `insert into google_companies (profile_id, profile_name) values ($1,$2)
               on conflict (profile_id) do update set profile_name = coalesce(excluded.profile_name, google_companies.profile_name)`,
              [b.profile_id, b.profile_name],
            );
          }
        }
        setups += list.length;
        ok++;
        await sql.query(
          `insert into google_billing_sync (cid, ok, message, setups, checked_at) values ($1, true, null, $2, now())
           on conflict (cid) do update set ok = true, message = null, setups = excluded.setups, checked_at = now()`,
          [a.cid, list.length],
        );
      } catch (e) {
        failed++;
        await sql
          .query(
            `insert into google_billing_sync (cid, ok, message, setups, checked_at) values ($1, false, $2, 0, now())
             on conflict (cid) do update set ok = false, message = excluded.message, checked_at = now()`,
            [a.cid, errText(e)],
          )
          .catch(() => {});
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  const filled = await autofillMst().catch(() => 0);
  return { accounts: accs.length, ok, failed, setups, left: queue.length, mst_filled: filled };
}

async function loadPeriods(): Promise<Map<string, CompanyPeriod[]>> {
  const sql = await getSql();
  const rows = await sql
    .query<{ cid: string; status: string; profile_id: string | null; profile_name: string | null; valid_from: unknown; valid_to: unknown }>(
      `select cid, status, profile_id, profile_name, valid_from, valid_to from google_account_company_history`,
    )
    .catch(() => []);
  const out = new Map<string, CompanyPeriod[]>();
  for (const r of rows) {
    const l = out.get(r.cid) || [];
    l.push({ profile_id: r.profile_id, profile_name: r.profile_name, status: r.status, valid_from: iso(r.valid_from), valid_to: iso(r.valid_to) });
    out.set(r.cid, l);
  }
  return out;
}

export type GoogleCompany = { profile_id: string; profile_name: string | null; display_name: string | null; mst: string | null; mst_source: string | null; mst_doc: string | null };

async function loadCompanies(): Promise<Map<string, GoogleCompany>> {
  const sql = await getSql();
  const rows = await sql
    .query<GoogleCompany>(`select profile_id, profile_name, display_name, mst, mst_source, mst_doc from google_companies`)
    .catch(() => [] as GoogleCompany[]);
  return new Map(rows.map((r) => [r.profile_id, r]));
}

/** Fill a company's empty MST from the newest VN tax invoice attributed to it. Never overwrites a set MST. */
export async function autofillMst(): Promise<number> {
  const sql = await getSql();
  const [periods, companies] = await Promise.all([loadPeriods(), loadCompanies()]);
  const docs = await sql.query<{ doc_no: string; cid: string | null; issue_date: unknown; buyer_mst: string }>(
    `select doc_no, cid, issue_date, buyer_mst from google_invoices where doc_type = 'vn_tax' and buyer_mst is not null order by issue_date desc`,
  );
  const done = new Set<string>();
  let n = 0;
  for (const d of docs) {
    const p = d.cid ? companyAt(periods.get(d.cid) || [], iso(d.issue_date)) : null;
    if (!p?.profile_id || done.has(p.profile_id)) continue;
    done.add(p.profile_id);
    const c = companies.get(p.profile_id);
    if (c?.mst) continue;
    const r = await sql.query<{ profile_id: string }>(
      `update google_companies set mst = $2, mst_source = 'invoice', mst_doc = $3, updated_at = now() where profile_id = $1 and mst is null returning profile_id`,
      [p.profile_id, d.buyer_mst, d.doc_no],
    );
    n += r.length;
  }
  return n;
}

export async function saveCompany(profileId: string, displayName: string | null, mst: string | null, by: string) {
  const sql = await getSql();
  const r = await sql.query<{ profile_id: string }>(
    `update google_companies set display_name = $2, mst = $3, mst_source = case when $3::text is null then null else 'manual' end,
       mst_doc = null, updated_by = $4, updated_at = now() where profile_id = $1 returning profile_id`,
    [profileId, displayName, mst, by],
  );
  if (!r.length) throw new Error("Không tìm thấy hồ sơ thanh toán này.");
}

// ---------- Month view ----------

export type InvoiceMonthRow = InvoiceRow & {
  account_name: string | null;
  customer: string | null;
  counted: boolean;
  id_key: string;
  buyer_name: string | null;
  buyer_mst: string | null;
  company_id: string | null;
  company: string | null;
  company_mst: string | null;
  mst_mismatch: boolean;
};
export type InvoiceAccountSum = {
  client_id: string | null;
  cid: string | null;
  name: string;
  customer: string | null;
  total: number | null;
  basis: "vn_tax" | "invoice" | null;
  spend: number | null;
  spend_days: number;
};
export type CompanyAccountSum = { client_id: string | null; cid: string | null; name: string; total: number | null; basis: "vn_tax" | "invoice" | null; spend: number | null; docs: number };
export type CompanySum = {
  profile_id: string | null;
  name: string;
  profile_name: string | null;
  display_name: string | null;
  mst: string | null;
  mst_source: string | null;
  total: number | null;
  fallback: boolean;
  spend: number | null;
  docs: number;
  accounts: CompanyAccountSum[];
};
export type InvoiceWarning =
  | { kind: "no_docs"; client_id: string; cid: string; name: string; company: string | null; spend: number }
  | { kind: "mst_mismatch"; doc_no: string; cid: string | null; name: string | null; buyer_mst: string; company: string | null; company_mst: string | null }
  | { kind: "no_company"; client_id: string | null; cid: string | null; name: string; docs: number };
export type InvoiceMonth = {
  month: string;
  rows: InvoiceMonthRow[];
  accounts: InvoiceAccountSum[];
  customers: Array<{ customer: string; total: number | null; spend: number | null }>;
  companies: CompanySum[];
  company_list: GoogleCompany[];
  warnings: InvoiceWarning[];
  total: number | null;
  spend: number | null;
  sync: Array<{ cid: string; ok: boolean; code: string | null; message: string | null; checked_at: string }>;
  mapping: { checked_at: string | null; accounts: number; failed: number; mapped: number };
};

const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const sumOrNull = (xs: Array<number | null>) => (xs.some((x) => x != null) ? xs.reduce<number>((s, x) => s + (x ?? 0), 0) : null);

export async function readInvoiceMonth(ym: string): Promise<InvoiceMonth> {
  const [y, m] = ym.split("-").map(Number);
  const first = `${ym}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const sql = await getSql();
  const raw = await sql.query<Record<string, unknown>>(
    `select doc_no, doc_type, cid, client_id, issue_date, amount, currency, source, file_name, buyer_name, buyer_mst from google_invoices
      where issue_date between $1 and $2 order by issue_date, doc_no`,
    [first, last],
  );
  const [accs, periods, companyMap] = await Promise.all([invoiceAccounts(), loadPeriods(), loadCompanies()]);
  const byId = new Map(accs.map((a) => [a.client_id, a]));
  const byCid = new Map(accs.map((a) => [a.cid, a]));
  const companyName = (id: string | null) => {
    if (!id) return null;
    const c = companyMap.get(id);
    return c?.display_name || c?.profile_name || id;
  };
  const rows: InvoiceMonthRow[] = raw.map((r) => {
    const acc: InvoiceAccount | null = (r.client_id ? byId.get(String(r.client_id)) : undefined) || (r.cid ? byCid.get(String(r.cid)) : undefined) || null;
    const cid = (r.cid as string) || acc?.cid || null;
    const date = iso(r.issue_date);
    const per = cid ? companyAt(periods.get(cid) || [], date) : null;
    const company_id = per?.profile_id || null;
    const company_mst = company_id ? companyMap.get(company_id)?.mst || null : null;
    const buyer_mst = normMst(r.buyer_mst);
    return {
      doc_no: String(r.doc_no),
      doc_type: String(r.doc_type) as InvoiceDocType,
      cid,
      client_id: acc?.client_id || (r.client_id as string) || null,
      issue_date: date,
      amount: r.amount == null ? null : Number(r.amount),
      currency: (r.currency as string) || null,
      source: r.source === "api" ? "api" : "upload",
      file_name: (r.file_name as string) || null,
      account_name: acc?.name || null,
      customer: acc?.customer || null,
      counted: false,
      id_key: String(r.doc_no),
      buyer_name: (r.buyer_name as string) || null,
      buyer_mst,
      company_id,
      company: companyName(company_id),
      company_mst,
      mst_mismatch: Boolean(buyer_mst && company_mst && normMst(company_mst) !== buyer_mst),
    };
  });
  const groups = new Map<string, InvoiceMonthRow[]>();
  for (const r of rows) {
    const k = r.client_id || `cid:${r.cid || "?"}`;
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  // Spend for every Google account (the "spend but no document" warning needs all of them).
  const { dailySpend } = await import("./budget-plan.server.ts");
  const allIds = [...new Set([...accs.map((a) => a.client_id), ...[...groups.keys()].filter((k) => !k.startsWith("cid:"))])];
  const spendMap: Map<string, Array<{ date: string; cost: number }>> = allIds.length ? await dailySpend(allIds, first, last).catch(() => new Map()) : new Map();
  const accounts: InvoiceAccountSum[] = [];
  for (const [k, list] of groups) {
    const t = accountTotal(list);
    for (const r of list) r.counted = rowCounted(r, t.basis);
    const days = k.startsWith("cid:") ? [] : spendMap.get(k) || [];
    const acc = byId.get(k);
    accounts.push({
      client_id: k.startsWith("cid:") ? null : k,
      cid: acc?.cid || list[0].cid,
      name: acc?.name || (list[0].cid ? dashCid(list[0].cid) : "Chưa gán tài khoản"),
      customer: acc?.customer || null,
      total: t.total,
      basis: t.basis,
      spend: days.length ? days.reduce((s, d) => s + d.cost, 0) : null,
      spend_days: days.length,
    });
  }
  accounts.sort((a, b) => a.name.localeCompare(b.name, "vi"));
  const custMap = new Map<string, InvoiceAccountSum[]>();
  for (const a of accounts) {
    const c = a.customer || "Chưa gán khách hàng";
    custMap.set(c, [...(custMap.get(c) || []), a]);
  }
  const customers = [...custMap.entries()].map(([customer, l]) => ({ customer, total: sumOrNull(l.map((x) => x.total)), spend: sumOrNull(l.map((x) => x.spend)) }));

  // ---- By company: documents by the company valid on their issue date; spend day by day the same way.
  type Cell = { client_id: string | null; cid: string | null; name: string; rows: InvoiceMonthRow[]; spend: number | null };
  const cells = new Map<string, Cell>(); // `${company}|${account}`
  const cell = (company: string, acctKey: string, init: () => Omit<Cell, "rows" | "spend">) => {
    const k = `${company}|${acctKey}`;
    let c = cells.get(k);
    if (!c) { c = { ...init(), rows: [], spend: null }; cells.set(k, c); }
    return c;
  };
  for (const r of rows) {
    const acctKey = r.client_id || `cid:${r.cid || "?"}`;
    cell(r.company_id || "", acctKey, () => ({ client_id: r.client_id, cid: r.cid, name: r.account_name || (r.cid ? dashCid(r.cid) : "Chưa gán tài khoản") })).rows.push(r);
  }
  for (const a of accs) {
    const days = spendMap.get(a.client_id) || [];
    for (const d of days) {
      if (!(d.cost > 0)) continue;
      const per = companyAt(periods.get(a.cid) || [], d.date);
      const c = cell(per?.profile_id || "", a.client_id, () => ({ client_id: a.client_id, cid: a.cid, name: a.name }));
      c.spend = (c.spend ?? 0) + d.cost;
    }
  }
  const compAgg = new Map<string, CompanyAccountSum[]>();
  for (const [k, c] of cells) {
    const company = k.slice(0, k.indexOf("|"));
    const t = accountTotal(c.rows);
    compAgg.set(company, [...(compAgg.get(company) || []), { client_id: c.client_id, cid: c.cid, name: c.name, total: t.total, basis: t.basis, spend: c.spend, docs: c.rows.length }]);
  }
  const companies: CompanySum[] = [...compAgg.entries()].map(([id, list]) => {
    const c = id ? companyMap.get(id) : undefined;
    list.sort((a, b) => a.name.localeCompare(b.name, "vi"));
    return {
      profile_id: id || null,
      name: id ? companyName(id)! : "Chưa xác định công ty",
      profile_name: c?.profile_name || null,
      display_name: c?.display_name || null,
      mst: c?.mst || null,
      mst_source: c?.mst_source || null,
      total: sumOrNull(list.map((x) => x.total)),
      fallback: list.some((x) => x.basis === "invoice"),
      spend: sumOrNull(list.map((x) => x.spend)),
      docs: list.reduce((s, x) => s + x.docs, 0),
      accounts: list,
    };
  });
  companies.sort((a, b) => (a.profile_id ? 0 : 1) - (b.profile_id ? 0 : 1) || a.name.localeCompare(b.name, "vi"));

  // ---- Warnings
  const warnings: InvoiceWarning[] = [];
  const withDocs = new Set(rows.map((r) => r.client_id).filter(Boolean));
  for (const a of accs) {
    const spend = (spendMap.get(a.client_id) || []).reduce((s, d) => s + (d.cost > 0 ? d.cost : 0), 0);
    if (spend > 0 && !withDocs.has(a.client_id)) {
      const per = companyAt(periods.get(a.cid) || [], last);
      warnings.push({ kind: "no_docs", client_id: a.client_id, cid: a.cid, name: a.name, company: companyName(per?.profile_id || null), spend });
    }
  }
  for (const r of rows) {
    if (r.mst_mismatch && r.buyer_mst) warnings.push({ kind: "mst_mismatch", doc_no: r.doc_no, cid: r.cid, name: r.account_name, buyer_mst: r.buyer_mst, company: r.company, company_mst: r.company_mst });
  }
  const noCo = companies.find((c) => !c.profile_id);
  for (const a of noCo?.accounts || []) if (a.docs) warnings.push({ kind: "no_company", client_id: a.client_id, cid: a.cid, name: a.name, docs: a.docs });

  const sync = await sql
    .query<{ cid: string; ok: boolean; code: string | null; message: string | null; checked_at: unknown }>(`select cid, ok, code, message, checked_at from google_invoice_sync order by checked_at desc limit 500`)
    .catch(() => []);
  const bs = await sql
    .query<{ n: number; failed: number; last: unknown }>(`select count(*)::int as n, count(*) filter (where not ok)::int as failed, max(checked_at) as last from google_billing_sync`)
    .catch(() => [] as { n: number; failed: number; last: unknown }[]);
  const tsIso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
  return {
    month: ym,
    rows,
    accounts,
    customers,
    companies,
    company_list: [...companyMap.values()].sort((a, b) => (a.display_name || a.profile_name || "").localeCompare(b.display_name || b.profile_name || "", "vi")),
    warnings,
    total: sumOrNull(accounts.map((a) => a.total)),
    spend: sumOrNull(accounts.map((a) => a.spend)),
    sync: sync.map((s) => ({ cid: s.cid, ok: s.ok, code: s.code, message: s.message, checked_at: tsIso(s.checked_at) || "" })),
    mapping: { checked_at: tsIso(bs[0]?.last), accounts: bs[0]?.n ?? 0, failed: bs[0]?.failed ?? 0, mapped: periods.size },
  };
}

export type UploadDoc = {
  doc_no: string;
  doc_type: InvoiceDocType;
  client_id: string;
  issue_date: string;
  amount: number;
  currency: string | null;
  file_name: string | null;
  buyer_name: string | null;
  buyer_mst: string | null;
};

/** Saves uploaded documents; an existing document number is skipped (dedupe), never overwritten. */
export async function saveUploaded(docs: UploadDoc[], by: string): Promise<{ saved: number; duplicates: string[]; mst_filled: number }> {
  const accs = new Map((await invoiceAccounts()).map((a) => [a.client_id, a]));
  const sql = await getSql();
  let saved = 0;
  const duplicates: string[] = [];
  for (const d of docs) {
    const acc = accs.get(d.client_id);
    if (!acc) throw new Error(`Tài khoản không hợp lệ cho chứng từ ${d.doc_no}.`);
    const res = await sql.query<{ doc_no: string }>(
      `insert into google_invoices (doc_no, doc_type, cid, client_id, issue_date, amount, currency, source, file_name, created_by, buyer_name, buyer_mst)
       values ($1,$2,$3,$4,$5,$6,$7,'upload',$8,$9,$10,$11) on conflict (doc_no) do nothing returning doc_no`,
      [normDocNo(d.doc_no), d.doc_type, acc.cid, acc.client_id, d.issue_date, d.amount, d.currency, d.file_name, by, d.buyer_name, normMst(d.buyer_mst)],
    );
    if (res.length) saved++;
    else duplicates.push(d.doc_no);
  }
  const mst_filled = saved ? await autofillMst().catch(() => 0) : 0;
  if (saved) {
    const { notifyInvoicesUploaded } = await import("./push.server.ts");
    await notifyInvoicesUploaded(saved, docs.filter((d) => !duplicates.includes(d.doc_no)).map((d) => d.issue_date));
  }
  return { saved, duplicates, mst_filled };
}

export async function deleteUploaded(docNo: string): Promise<boolean> {
  const sql = await getSql();
  const r = await sql.query<{ doc_no: string }>(`delete from google_invoices where doc_no = $1 and source = 'upload' returning doc_no`, [normDocNo(docNo)]);
  return r.length > 0;
}

/** Which of these document numbers already exist (upload preview). */
export async function existingDocNos(nos: string[]): Promise<string[]> {
  if (!nos.length) return [];
  const sql = await getSql();
  const r = await sql.query<{ doc_no: string }>(`select doc_no from google_invoices where doc_no = any($1::text[])`, [nos.map(normDocNo)]);
  return r.map((x) => x.doc_no);
}

/** Company (payments profile) valid for an account on a date, for the ingest summary. */
export async function companiesFor(items: Array<{ cid: string | null; date: string | null }>): Promise<Array<{ id: string; name: string; mst: string | null } | null>> {
  const [periods, companies] = await Promise.all([loadPeriods(), loadCompanies()]);
  return items.map(({ cid, date }) => {
    const per = cid ? companyAt(periods.get(cid) || [], date) : null;
    if (!per?.profile_id) return null;
    const c = companies.get(per.profile_id);
    return { id: per.profile_id, name: c?.display_name || c?.profile_name || per.profile_name || per.profile_id, mst: c?.mst || null };
  });
}

export type DownloadGuideRow = { cid: string; name: string; customer: string | null; spend: number; spend_days: number; manager_chain: string | null; docs: number; vn_tax_docs: number; doc_nos: string[] };

/**
 * Download guide for the box automation: Google accounts with spend > 0 in the month, their
 * manager (MCC) chain as recorded in ad_accounts, and which billing documents are already stored.
 */
export async function downloadGuide(month: string): Promise<DownloadGuideRow[]> {
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const accs = await invoiceAccounts();
  const { dailySpend } = await import("./budget-plan.server.ts");
  const sp = await dailySpend(accs.map((a) => a.client_id), from, to);
  const sql = await getSql();
  const aa = await sql
    .query<{ id: string; external_id: string | null; manager_customer_id: string | null; display_name: string | null }>(`select id, external_id, manager_customer_id, display_name from ad_accounts`)
    .catch(() => []);
  const d10 = (v: unknown) => String(v ?? "").replace(/\D/g, "");
  const mgr = new Map<string, string>();
  const nm = new Map<string, string>();
  for (const r of aa) {
    const k = d10(r.external_id).length === 10 ? d10(r.external_id) : d10(r.id).length === 10 ? d10(r.id) : "";
    const p = d10(r.manager_customer_id);
    if (p.length === 10) { mgr.set(r.id, p); if (k) mgr.set(k, p); }
    if (k && r.display_name) nm.set(k, r.display_name);
  }
  const chain = (cid: string, id: string) => {
    const out: string[] = [];
    const seen = new Set<string>([cid]);
    let cur = mgr.get(id) || mgr.get(cid);
    while (cur && !seen.has(cur) && out.length < 6) {
      seen.add(cur);
      out.push(nm.get(cur) ? `${dashCid(cur)} (${nm.get(cur)})` : dashCid(cur));
      cur = mgr.get(cur);
    }
    return out.length ? out.join(" > ") : null;
  };
  const docs = await sql.query<{ cid: string; doc_no: string; doc_type: string }>(
    `select cid, doc_no, doc_type from google_invoices where issue_date between $1 and $2`, [from, to],
  );
  const out: DownloadGuideRow[] = [];
  for (const a of accs) {
    const byDay = new Map<string, number>();
    for (const d of sp.get(a.client_id) || []) byDay.set(d.date, Math.max(byDay.get(d.date) || 0, d.cost));
    const spend = [...byDay.values()].reduce((s, v) => s + v, 0);
    if (!(spend > 0)) continue;
    const mine = docs.filter((d) => d.cid === a.cid);
    out.push({ cid: dashCid(a.cid), name: a.name, customer: a.customer, spend: Math.round(spend), spend_days: [...byDay.values()].filter((v) => v > 0).length, manager_chain: chain(a.cid, a.client_id), docs: mine.length, vn_tax_docs: mine.filter((d) => d.doc_type === "vn_tax").length, doc_nos: mine.map((d) => d.doc_no) });
  }
  return out.sort((p, q) => q.spend - p.spend);
}
