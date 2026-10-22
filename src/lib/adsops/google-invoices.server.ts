/**
 * Hóa đơn Google. Google side is read-only: one GAQL SELECT on billing_setup and
 * InvoiceService.ListInvoices (GET). Nothing is written to Google.
 */
import { getSql } from "@/lib/db";
import { AdsApiError, listInvoicesRaw, resolveAdsConfig, searchStream } from "./google-ads.server.ts";
import { loginCustomerFor } from "./mcc-list.server.ts";
import { accountTotal, cidDigits, dashCid, issueMonthEnum, normDocNo, rowCounted, type InvoiceDocType, type InvoiceRow } from "./google-invoices.ts";
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

type Setup = { resource: string; id: string; status: string; payments: string | null };

async function billingSetups(cid: string, login?: string): Promise<Setup[]> {
  const cfg = await resolveAdsConfig();
  const rows = await searchStream(
    cfg,
    cid,
    "SELECT billing_setup.resource_name, billing_setup.id, billing_setup.status, billing_setup.payments_account_info.payments_account_name FROM billing_setup",
    login,
  );
  return rows.map((r) => {
    const b = asRec(asRec(r).billingSetup);
    return {
      resource: String(b.resourceName || ""),
      id: String(b.id || ""),
      status: String(b.status || ""),
      payments: (asRec(b.paymentsAccountInfo).paymentsAccountName as string) || null,
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
  const accs = (await invoiceAccounts()).filter((a) => want.has(a.client_id));
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
  return { accounts: accs.length, checked: done, read_ok: okN, found, skipped_unsupported: skipped, left: queue.length };
}

export type InvoiceMonthRow = InvoiceRow & { account_name: string | null; customer: string | null; counted: boolean; id_key: string };
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
export type InvoiceMonth = {
  month: string;
  rows: InvoiceMonthRow[];
  accounts: InvoiceAccountSum[];
  customers: Array<{ customer: string; total: number | null; spend: number | null }>;
  total: number | null;
  spend: number | null;
  sync: Array<{ cid: string; ok: boolean; code: string | null; message: string | null; checked_at: string }>;
};

const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const sumOrNull = (xs: Array<number | null>) => (xs.some((x) => x != null) ? xs.reduce<number>((s, x) => s + (x ?? 0), 0) : null);

export async function readInvoiceMonth(ym: string): Promise<InvoiceMonth> {
  const [y, m] = ym.split("-").map(Number);
  const first = `${ym}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const sql = await getSql();
  const raw = await sql.query<Record<string, unknown>>(
    `select doc_no, doc_type, cid, client_id, issue_date, amount, currency, source, file_name from google_invoices
      where issue_date between $1 and $2 order by issue_date, doc_no`,
    [first, last],
  );
  const accs = await invoiceAccounts();
  const byId = new Map(accs.map((a) => [a.client_id, a]));
  const byCid = new Map(accs.map((a) => [a.cid, a]));
  const rows: InvoiceMonthRow[] = raw.map((r) => {
    const acc: InvoiceAccount | null = (r.client_id ? byId.get(String(r.client_id)) : undefined) || (r.cid ? byCid.get(String(r.cid)) : undefined) || null;
    return {
      doc_no: String(r.doc_no),
      doc_type: String(r.doc_type) as InvoiceDocType,
      cid: (r.cid as string) || acc?.cid || null,
      client_id: acc?.client_id || (r.client_id as string) || null,
      issue_date: iso(r.issue_date),
      amount: r.amount == null ? null : Number(r.amount),
      currency: (r.currency as string) || null,
      source: r.source === "api" ? "api" : "upload",
      file_name: (r.file_name as string) || null,
      account_name: acc?.name || null,
      customer: acc?.customer || null,
      counted: false,
      id_key: String(r.doc_no),
    };
  });
  const groups = new Map<string, InvoiceMonthRow[]>();
  for (const r of rows) {
    const k = r.client_id || `cid:${r.cid || "?"}`;
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  const ids = [...groups.keys()].filter((k) => !k.startsWith("cid:"));
  const { dailySpend } = await import("./budget-plan.server.ts");
  const spendMap = ids.length ? await dailySpend(ids, first, last).catch(() => new Map()) : new Map();
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
      spend: days.length ? days.reduce((s: number, d: { cost: number }) => s + d.cost, 0) : null,
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
  const sync = await sql
    .query<{ cid: string; ok: boolean; code: string | null; message: string | null; checked_at: unknown }>(`select cid, ok, code, message, checked_at from google_invoice_sync order by checked_at desc limit 500`)
    .catch(() => []);
  return {
    month: ym,
    rows,
    accounts,
    customers,
    total: sumOrNull(accounts.map((a) => a.total)),
    spend: sumOrNull(accounts.map((a) => a.spend)),
    sync: sync.map((s) => ({ cid: s.cid, ok: s.ok, code: s.code, message: s.message, checked_at: s.checked_at instanceof Date ? s.checked_at.toISOString() : String(s.checked_at) })),
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
};

/** Saves uploaded documents; an existing document number is skipped (dedupe), never overwritten. */
export async function saveUploaded(docs: UploadDoc[], by: string): Promise<{ saved: number; duplicates: string[] }> {
  const accs = new Map((await invoiceAccounts()).map((a) => [a.client_id, a]));
  const sql = await getSql();
  let saved = 0;
  const duplicates: string[] = [];
  for (const d of docs) {
    const acc = accs.get(d.client_id);
    if (!acc) throw new Error(`Tài khoản không hợp lệ cho chứng từ ${d.doc_no}.`);
    const res = await sql.query<{ doc_no: string }>(
      `insert into google_invoices (doc_no, doc_type, cid, client_id, issue_date, amount, currency, source, file_name, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,'upload',$8,$9) on conflict (doc_no) do nothing returning doc_no`,
      [normDocNo(d.doc_no), d.doc_type, acc.cid, acc.client_id, d.issue_date, d.amount, d.currency, d.file_name, by],
    );
    if (res.length) saved++;
    else duplicates.push(d.doc_no);
  }
  return { saved, duplicates };
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
