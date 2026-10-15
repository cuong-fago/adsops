/**
 * Facebook (Meta) Ads — READ-ONLY Marketing API (Graph GET only, ads_read System User token in
 * META_SYSTEM_USER_TOKEN; sent as a header, never logged or returned).
 * - accounts: /me/adaccounts → ad_accounts (platform 'facebook', id fb_<account_id>) + meta_account_state
 * - insights: account / campaign / adset daily (spend, impressions, clicks, leads, messages)
 * - budget runway: spend_cap − amount_spent over avg 7-day spend → ads_budget_runway
 * - 10-day spend → ad_accounts.spend10_* (same hide rule as Google)
 */
import { getSql } from "@/lib/db";
import { addDaysYmd, ymdInTz } from "./warehouse.server.ts";
import { RUNWAY_AMBER_DAYS, RUNWAY_RED_DAYS } from "./budget-runway.types.ts";

const GRAPH = "https://graph.facebook.com/v21.0";
export const FB_PREFIX = "fb_";
export const INSIGHT_DAYS = 35;

export function isFacebookId(clientId: string): boolean {
  return clientId.startsWith(FB_PREFIX);
}
export function fbAccountId(clientId: string): string {
  return clientId.slice(FB_PREFIX.length).replace(/\D/g, "");
}

export class MetaApiError extends Error {}

export function metaConfigured(): boolean {
  return Boolean(process.env.META_SYSTEM_USER_TOKEN?.trim());
}

/** GET only. Follows paging.next. The token never appears in errors. */
async function graphGet(path: string, params: Record<string, string>, maxPages = 20): Promise<Record<string, unknown>[]> {
  const token = process.env.META_SYSTEM_USER_TOKEN?.trim();
  if (!token) throw new MetaApiError("Chưa cấu hình META_SYSTEM_USER_TOKEN trên Vercel.");
  let url: string | null = `${GRAPH}/${path}?${new URLSearchParams(params).toString()}`;
  const out: Record<string, unknown>[] = [];
  for (let page = 0; url && page < maxPages; page++) {
    const res: Response = await fetch(url, { method: "GET", headers: { authorization: `Bearer ${token}` } });
    const body = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>[]; paging?: { next?: string }; error?: { message?: string; code?: number } };
    if (!res.ok || body.error) {
      const msg = String(body.error?.message || `HTTP ${res.status}`).replace(token, "***");
      throw new MetaApiError(`Facebook API: ${msg}${body.error?.code ? ` (code ${body.error.code})` : ""}`);
    }
    if (Array.isArray(body.data)) out.push(...body.data);
    url = body.paging?.next && body.paging.next.startsWith(GRAPH) ? body.paging.next : null;
  }
  return out;
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

type Action = { action_type?: string; value?: string };
const LEAD_TYPES = ["lead", "onsite_conversion.lead_grouped", "onsite_web_lead", "offsite_conversion.fb_pixel_lead"];
const MESSAGE_TYPE = "onsite_conversion.messaging_conversation_started_7d";

/** Meta "results" for lead accounts: first present lead type (they overlap, never summed). Null = Meta reported none. */
export function leadsOf(actions: Action[] | undefined): number | null {
  const by = new Map((actions || []).map((a) => [String(a.action_type || ""), num(a.value)]));
  for (const t of LEAD_TYPES) if (by.has(t)) return by.get(t) as number;
  return null;
}
export function messagesOf(actions: Action[] | undefined): number | null {
  const a = (actions || []).find((x) => x.action_type === MESSAGE_TYPE);
  return a ? num(a.value) : null;
}

/** Meta account_status → stored platform status (ad_accounts.google_status, used by the hide rule). */
function statusOf(s: number): string {
  if (s === 1) return "ENABLED";
  if (s === 2) return "SUSPENDED";
  if (s === 100 || s === 101) return "CLOSED";
  return "ENABLED"; // unsettled / pending review / grace period: still shown
}

export type MetaAccount = { id: string; account_id: string; name: string; account_status: number; currency: string; timezone_name: string; amount_spent: number; spend_cap: number; balance: number };

export async function listMetaAccounts(): Promise<MetaAccount[]> {
  const rows = await graphGet("me/adaccounts", { fields: "account_id,name,account_status,currency,timezone_name,amount_spent,spend_cap,balance", limit: "200" });
  return rows.map((r) => ({
    id: String(r.id || ""),
    account_id: String(r.account_id || "").replace(/\D/g, ""),
    name: String(r.name || r.account_id || ""),
    account_status: num(r.account_status),
    currency: String(r.currency || "VND"),
    timezone_name: String(r.timezone_name || "Asia/Ho_Chi_Minh"),
    // VND has no minor unit: Graph amounts are already in đồng.
    amount_spent: num(r.amount_spent),
    spend_cap: num(r.spend_cap),
    balance: num(r.balance),
  })).filter((a) => a.account_id);
}

/** Upsert accounts into ad_accounts + meta_account_state. Returns the AdsOps ids. */
export async function syncMetaAccounts(accounts: MetaAccount[]): Promise<{ ids: string[]; inserted: string[] }> {
  const sql = await getSql();
  const ids: string[] = [];
  const inserted: string[] = [];
  for (const a of accounts) {
    const id = `${FB_PREFIX}${a.account_id}`;
    ids.push(id);
    const r = await sql.query<{ id: string }>(
      `insert into ad_accounts (id, platform, external_id, display_name, status)
       values ($1, 'facebook', $2, $3, $4)
       on conflict (id) do update set display_name = excluded.display_name, updated_at = now()
       returning (xmax = 0) as inserted, id`,
      [id, a.account_id, a.name, statusOf(a.account_status)],
    );
    if ((r[0] as unknown as { inserted?: boolean })?.inserted) inserted.push(id);
    await sql.query(`update ad_accounts set google_status = $2, google_status_at = now() where id = $1`, [id, statusOf(a.account_status)]).catch(() => null);
    await sql.query(
      `insert into meta_account_state (client_id, account_id, account_status, currency, timezone_name, amount_spent, spend_cap, balance, checked_at, error)
       values ($1,$2,$3,$4,$5,$6,$7,$8, now(), null)
       on conflict (client_id) do update set account_status = excluded.account_status, currency = excluded.currency,
         timezone_name = excluded.timezone_name, amount_spent = excluded.amount_spent, spend_cap = excluded.spend_cap,
         balance = excluded.balance, checked_at = now(), error = null`,
      [id, a.account_id, a.account_status, a.currency, a.timezone_name, a.amount_spent, a.spend_cap, a.balance],
    );
  }
  return { ids, inserted };
}

const INSIGHT_FIELDS = "spend,impressions,clicks,actions";

/** Daily insights for one account at account / campaign / adset level over the last INSIGHT_DAYS days. */
export async function syncMetaInsights(clientId: string, tz = "Asia/Ho_Chi_Minh"): Promise<{ rows: number; through: string }> {
  const acc = fbAccountId(clientId);
  const until = ymdInTz(tz);
  const since = addDaysYmd(until, -(INSIGHT_DAYS - 1));
  const range = JSON.stringify({ since, until });
  const levels: Array<{ level: "account" | "campaign" | "adset"; fields: string }> = [
    { level: "account", fields: INSIGHT_FIELDS },
    { level: "campaign", fields: `campaign_id,campaign_name,${INSIGHT_FIELDS}` },
    { level: "adset", fields: `campaign_id,campaign_name,adset_id,adset_name,${INSIGHT_FIELDS}` },
  ];
  const sql = await getSql();
  let total = 0;
  for (const { level, fields } of levels) {
    const data = await graphGet(`act_${acc}/insights`, { level, fields, time_increment: "1", time_range: range, limit: "500" }, 40);
    await sql.query(`delete from meta_insights_daily where client_id = $1 and level = $2 and date between $3 and $4`, [clientId, level, since, until]);
    for (const r of data) {
      const actions = (Array.isArray(r.actions) ? r.actions : []) as Action[];
      const objectId = level === "account" ? acc : level === "campaign" ? String(r.campaign_id || "") : String(r.adset_id || "");
      if (!objectId) continue;
      await sql.query(
        `insert into meta_insights_daily (client_id, level, object_id, date, campaign_id, campaign_name, adset_id, adset_name, spend, impressions, clicks, leads, messages, actions)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         on conflict (client_id, level, object_id, date) do update set spend = excluded.spend, impressions = excluded.impressions,
           clicks = excluded.clicks, leads = excluded.leads, messages = excluded.messages, actions = excluded.actions,
           campaign_name = excluded.campaign_name, adset_name = excluded.adset_name, pulled_at = now()`,
        [clientId, level, objectId, String(r.date_start || ""), r.campaign_id ? String(r.campaign_id) : null, r.campaign_name ? String(r.campaign_name) : null,
          r.adset_id ? String(r.adset_id) : null, r.adset_name ? String(r.adset_name) : null, num(r.spend), num(r.impressions), num(r.clicks),
          leadsOf(actions), messagesOf(actions), JSON.stringify(actions)],
      );
      total += 1;
    }
  }
  await sql.query(`update meta_account_state set insights_through = $2 where client_id = $1`, [clientId, until]).catch(() => null);
  return { rows: total, through: until };
}

/** 10-day spend + budget runway from stored state and account-level daily rows. */
export async function deriveMetaChecks(clientId: string, tz = "Asia/Ho_Chi_Minh"): Promise<void> {
  const sql = await getSql();
  const today = ymdInTz(tz);
  const daily = await sql.query<{ date: Date | string; spend: string | number }>(
    `select date, spend from meta_insights_daily where client_id = $1 and level = 'account' and date >= $2 order by date`,
    [clientId, addDaysYmd(today, -9)],
  );
  const ymd = (d: Date | string) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
  let s10 = 0;
  let last: string | null = null;
  for (const d of daily) { const v = num(d.spend); s10 += v; if (v > 0) last = ymd(d.date); }
  await sql.query(
    `update ad_accounts set spend10_micros = $2, spend10_last_date = $3, spend10_checked_at = now(), spend10_error = null where id = $1`,
    [clientId, Math.round(s10 * 1e6), last],
  ).catch(() => null);

  // Runway: last 7 complete days (yesterday back), same thresholds as Google.
  const avg = await sql.query<{ s7: string | number | null; s3: string | number | null }>(
    `select sum(spend) filter (where date between $2 and $3) as s7, sum(spend) filter (where date between $4 and $3) as s3
       from meta_insights_daily where client_id = $1 and level = 'account'`,
    [clientId, addDaysYmd(today, -7), addDaysYmd(today, -1), addDaysYmd(today, -3)],
  );
  const st = (await sql.query<{ account_id: string; currency: string | null; amount_spent: string | number | null; spend_cap: string | number | null }>(
    `select account_id, currency, amount_spent, spend_cap from meta_account_state where client_id = $1`, [clientId],
  ))[0];
  if (!st) return;
  const avg7 = num(avg[0]?.s7) / 7;
  const avg3 = num(avg[0]?.s3) / 3;
  const cap = num(st.spend_cap);
  const spent = num(st.amount_spent);
  let kind = "no_budget";
  let status = "no_budget";
  let remaining: number | null = null;
  let days: number | null = null;
  if (cap > 0) {
    kind = "account_budget";
    remaining = Math.max(0, cap - spent);
    if (avg7 <= 0) status = "no_spend";
    else {
      days = remaining / avg7;
      status = days < RUNWAY_RED_DAYS ? "red" : days <= RUNWAY_AMBER_DAYS ? "amber" : "ok";
    }
  }
  const m = (v: number | null) => (v == null ? null : Math.round(v * 1e6));
  await sql.query(
    `insert into ads_budget_runway (client_id, external_id, checked_at, ok, kind, currency, limit_micros, served_micros, remaining_micros, infinite,
       avg7_micros, avg3_micros, runway_days, budget_start, budget_end, status, expiring, error_vi, raw)
     values ($1,$2, now(), true, $3, $4, $5, $6, $7, false, $8, $9, $10, null, null, $11, false, null, $12)
     on conflict (client_id) do update set external_id = excluded.external_id, checked_at = now(), ok = true, kind = excluded.kind,
       currency = excluded.currency, limit_micros = excluded.limit_micros, served_micros = excluded.served_micros,
       remaining_micros = excluded.remaining_micros, infinite = false, avg7_micros = excluded.avg7_micros, avg3_micros = excluded.avg3_micros,
       runway_days = excluded.runway_days, budget_start = null, budget_end = null, status = excluded.status, expiring = false,
       error_vi = null, raw = excluded.raw`,
    [clientId, st.account_id, kind, st.currency || "VND", cap > 0 ? m(cap) : null, m(spent), m(remaining), m(avg7), m(avg3), days, status,
      JSON.stringify({ source: "meta", spend_cap: cap, amount_spent: spent })],
  );
}

async function recordError(clientId: string, msg: string) {
  const sql = await getSql();
  await sql.query(`update meta_account_state set error = $2, checked_at = now() where client_id = $1`, [clientId, msg.slice(0, 500)]).catch(() => null);
  await sql.query(`update ad_accounts set spend10_checked_at = now(), spend10_error = $2 where id = $1`, [clientId, msg.slice(0, 500)]).catch(() => null);
}

/** Full read-only refresh of one Facebook account (state + insights + runway + 10-day spend). */
export async function refreshMetaAccount(clientId: string): Promise<{ ok: boolean; error_vi: string | null }> {
  if (!isFacebookId(clientId)) return { ok: false, error_vi: "Không phải tài khoản Facebook." };
  try {
    const all = await listMetaAccounts();
    const a = all.find((x) => `${FB_PREFIX}${x.account_id}` === clientId);
    if (!a) {
      await recordError(clientId, "System User không còn quyền đọc tài khoản này.");
      return { ok: false, error_vi: "System User không còn quyền đọc tài khoản này." };
    }
    await syncMetaAccounts([a]);
    await syncMetaInsights(clientId, a.timezone_name);
    await deriveMetaChecks(clientId, a.timezone_name);
    return { ok: true, error_vi: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordError(clientId, msg);
    return { ok: false, error_vi: msg };
  }
}

/** Daily cron: every Facebook account the token can read. */
export async function refreshAllMeta(deadline: number): Promise<{ ok: boolean; accounts: number; done: number; inserted: number; errors: string[] }> {
  if (!metaConfigured()) return { ok: false, accounts: 0, done: 0, inserted: 0, errors: ["META_SYSTEM_USER_TOKEN chưa cấu hình"] };
  const errors: string[] = [];
  let accounts: MetaAccount[] = [];
  try {
    accounts = await listMetaAccounts();
  } catch (err) {
    return { ok: false, accounts: 0, done: 0, inserted: 0, errors: [err instanceof Error ? err.message : String(err)] };
  }
  const { inserted } = await syncMetaAccounts(accounts);
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < accounts.length && Date.now() < deadline) {
      const a = accounts[next++];
      const id = `${FB_PREFIX}${a.account_id}`;
      try {
        await syncMetaInsights(id, a.timezone_name);
        await deriveMetaChecks(id, a.timezone_name);
        done += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${a.account_id}: ${msg}`);
        await recordError(id, msg);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { ok: errors.length === 0, accounts: accounts.length, done, inserted: inserted.length, errors };
}

export type MetaStatus = {
  token: "missing" | "valid" | "invalid";
  /** Token length only (never the value): a 10-char value usually means "[REDACTED]" was saved. */
  token_length: number;
  error: string | null;
  accounts_visible: number | null;
  accounts_in_db: number | null;
  insights_rows: number | null;
  last_checked: string | null;
  tables_ok: boolean;
};

/** Admin diagnostic. One GET to /me/adaccounts; the token is never returned. */
export async function metaStatus(): Promise<MetaStatus> {
  const raw = process.env.META_SYSTEM_USER_TOKEN?.trim() || "";
  const out: MetaStatus = { token: raw ? "valid" : "missing", token_length: raw.length, error: null, accounts_visible: null, accounts_in_db: null, insights_rows: null, last_checked: null, tables_ok: false };
  if (raw) {
    try {
      out.accounts_visible = (await listMetaAccounts()).length;
    } catch (e) {
      out.token = "invalid";
      out.error = e instanceof Error ? e.message.replace(raw, "***") : String(e);
    }
  }
  try {
    const sql = await getSql();
    const a = await sql`select count(*)::int as n from ad_accounts where platform = 'facebook'`;
    const s = await sql`select count(*)::int as n, max(checked_at) as t from meta_account_state`;
    const i = await sql`select count(*)::int as n from meta_insights_daily`;
    out.accounts_in_db = Number(a[0]?.n ?? 0);
    out.insights_rows = Number(i[0]?.n ?? 0);
    const t = s[0]?.t as unknown;
    out.last_checked = t ? (t instanceof Date ? t.toISOString() : String(t)) : null;
    out.tables_ok = true;
  } catch (e) {
    out.error = out.error || `DB: ${e instanceof Error ? e.message : String(e)}`;
  }
  return out;
}

/**
 * First-load bootstrap: when no Facebook account is in ad_accounts yet, pull the account list once
 * (one cheap GET, lock 10 min) so accounts show before the first daily cron. Insights stay for cron/recheck.
 */
export async function ensureMetaAccounts(timeoutMs = 8000): Promise<void> {
  if (!metaConfigured()) return;
  const sql = await getSql();
  const have = await sql`select 1 from ad_accounts where platform = 'facebook' limit 1`.catch(() => null);
  if (!have || have.length) return;
  const { acquireLock } = await import("./warehouse.server.ts");
  if (!(await acquireLock("meta:bootstrap", 600))) return;
  await Promise.race([
    listMetaAccounts().then((a) => syncMetaAccounts(a)),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]).catch(() => null);
}
