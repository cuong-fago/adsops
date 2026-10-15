/**
 * Account activity from stored data only (no Google call):
 * - ad_accounts.google_status: MCC pull (customer_client.status), or NOT_ENABLED stored when a
 *   check got CUSTOMER_NOT_ENABLED
 * - spend: ads_budget_runway.avg7_micros (fresh <= 3 days) and the analytics warehouse daily
 *   account rows (fresh when warehouse_end >= today - 2)
 * - latest budget / score errors
 * A whole MCC failing with the same non-account error is a system problem: shown and flagged.
 * Unknown (no data, no errors) counts as active: we never hide what we know nothing about.
 */
import { getSql } from "@/lib/db";
import {
  INACTIVE_GOOGLE, REASON_GOOGLE, REASON_NO_SPEND, REASON_NO_SPEND_10, REASON_UNREADABLE, SPEND10_FRESH_MS, errorKind, type AccountActivity,
} from "./account-activity.types.ts";

const DAY = 86_400_000;
const isoOf = (v: Date | string | null | undefined) => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v));

export async function readActivity(ids: string[]): Promise<Map<string, AccountActivity>> {
  const out = new Map<string, AccountActivity>();
  const uniq = [...new Set(ids)];
  const status = new Map<string, string>();
  const mccOf = new Map<string, string>();
  const runway = new Map<string, { avg: number | null; err: string | null }>();
  const score = new Map<string, string | null>();
  const wh = new Map<string, number | null>();
  const s10 = new Map<string, { micros: number | null; last: string | null; at: string | null; err: string | null }>();
  if (uniq.length) {
    const sql = await getSql();
    await sql
      .query<{ id: string; google_status: string | null; manager_customer_id: string | null }>(
        `select id, google_status, manager_customer_id from ad_accounts where id = any($1::text[])`,
        [uniq],
      )
      .then((r) => {
        for (const x of r) {
          if (x.google_status) status.set(x.id, x.google_status.toUpperCase());
          if (x.manager_customer_id) mccOf.set(x.id, x.manager_customer_id);
        }
      })
      .catch(() => null);
    // 10-day spend (migration 0016; ignored if the columns are not there yet).
    await sql
      .query<{ id: string; m: string | number | null; last: Date | string | null; at: Date | string | null; err: string | null }>(
        `select id, spend10_micros as m, spend10_last_date as last, spend10_checked_at as at, spend10_error as err from ad_accounts where id = any($1::text[])`,
        [uniq],
      )
      .then((r) => {
        for (const x of r) s10.set(x.id, { micros: x.m == null ? null : Number(x.m), last: x.last ? isoOf(x.last).slice(0, 10) : null, at: x.at ? isoOf(x.at) : null, err: x.err });
      })
      .catch(() => null);
    await sql
      .query<{ client_id: string; avg7_micros: string | number | null; checked_at: Date | string; ok: boolean; error_vi: string | null }>(
        `select client_id, avg7_micros, checked_at, ok, error_vi from ads_budget_runway where client_id = any($1::text[])`,
        [uniq],
      )
      .then((r) => {
        for (const x of r) {
          const fresh = Date.now() - Date.parse(isoOf(x.checked_at)) < 3 * DAY;
          runway.set(x.client_id, {
            avg: x.ok && fresh && x.avg7_micros != null ? Number(x.avg7_micros) / 1e6 : null,
            err: x.ok ? null : x.error_vi,
          });
        }
      })
      .catch(() => null);
    await sql
      .query<{ client_id: string; error: string | null; score: string | null }>(
        `select distinct on (client_id) client_id, error, score from ads_optimization_score
         where client_id = any($1::text[]) order by client_id, date desc`,
        [uniq],
      )
      .then((r) => {
        for (const x of r) score.set(x.client_id, x.error && x.score == null ? x.error : null);
      })
      .catch(() => null);
    await sql
      .query<{ client_id: string; fresh: boolean; spend7: string | number | null }>(
        `select w.client_id, (w.warehouse_end >= current_date - 2) as fresh,
           (select coalesce(sum((d->>'cost')::numeric), 0) from jsonb_array_elements(coalesce(w.payload->'daily'->'account', '[]'::jsonb)) d
             where (d->>'date')::date >= current_date - 7) as spend7
         from adsops_analytics_warehouse w where w.client_id = any($1::text[])`,
        [uniq],
      )
      .then((r) => {
        for (const x of r) wh.set(x.client_id, x.fresh ? Number(x.spend7 || 0) : Number(x.spend7 || 0) > 0 ? Number(x.spend7) : null);
      })
      .catch(() => null);
  }

  // Systemic failure: >= 3 accounts of one MCC and >= 80% of them with the same non-account error.
  const byMcc = new Map<string, { total: number; kinds: Map<string, number> }>();
  const errOf = (id: string) => runway.get(id)?.err || score.get(id) || null;
  for (const id of uniq) {
    const mcc = mccOf.get(id) || "";
    if (!mcc) continue;
    const g = byMcc.get(mcc) || { total: 0, kinds: new Map() };
    g.total += 1;
    const k = errorKind(errOf(id));
    if (k && k !== "not_enabled") g.kinds.set(k, (g.kinds.get(k) || 0) + 1);
    byMcc.set(mcc, g);
  }
  const systemicMcc = new Map<string, string>();
  for (const [mcc, g] of byMcc) {
    for (const [k, n] of g.kinds) {
      if (g.total >= 3 && n / g.total >= 0.8) {
        systemicMcc.set(mcc, `Lỗi chung cho ${n}/${g.total} tài khoản của MCC ${mcc.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3")} (${k === "no_access" ? "không có quyền qua MCC" : "lỗi hệ thống"}) — kiểm tra kết nối, không ẩn.`);
      }
    }
  }

  for (const id of uniq) {
    const gs = status.get(id) || null;
    const rw = runway.get(id);
    const err = errOf(id);
    const kind = errorKind(err);
    const systemic = systemicMcc.get(mccOf.get(id) || "") && kind && kind !== "not_enabled" ? systemicMcc.get(mccOf.get(id) || "")! : null;
    const spends = [rw?.avg ?? null, wh.has(id) ? (wh.get(id) as number | null) : null].filter((v): v is number => v != null);
    const spendKnown = spends.length > 0;
    const spent = spends.some((v) => v > 0);
    const sp = s10.get(id);
    const base = {
      google_status: gs, avg7: rw?.avg ?? null, error: err, systemic,
      spend10: sp?.micros != null ? sp.micros / 1e6 : null, spend10_last_date: sp?.last ?? null, spend10_checked_at: sp?.at ?? null,
    };
    // 10-day rule: a fresh, successful check decides (spend > 0 → shown, 0 → hidden).
    const s10Fresh = Boolean(sp?.at && !sp.err && sp.micros != null && Date.now() - Date.parse(sp.at) < SPEND10_FRESH_MS);
    let act: AccountActivity;
    if ((gs && INACTIVE_GOOGLE.has(gs)) || kind === "not_enabled") act = { ...base, state: "inactive", reason: REASON_GOOGLE };
    else if (systemic) act = { ...base, state: "unknown", reason: null };
    else if (s10Fresh && (sp!.micros as number) > 0) act = { ...base, state: "active", reason: null };
    else if (s10Fresh) act = { ...base, state: "inactive", reason: REASON_NO_SPEND_10 };
    else if (kind === "no_access" && !spent) act = { ...base, state: "inactive", reason: REASON_GOOGLE };
    else if (spendKnown && !spent) act = { ...base, state: "inactive", reason: REASON_NO_SPEND };
    else if (!spendKnown && rw?.err && score.get(id)) act = { ...base, state: "inactive", reason: REASON_UNREADABLE };
    else if (spent && (!gs || gs === "ENABLED")) act = { ...base, state: "active", reason: null };
    else act = { ...base, state: "unknown", reason: null };
    out.set(id, act);
  }
  return out;
}

/** Background checks and crons: drop accounts known to be inactive (manual buttons still work). */
export async function activeOnly(ids: string[]): Promise<string[]> {
  const m = await readActivity(ids).catch(() => new Map<string, AccountActivity>());
  return ids.filter((id) => m.get(id)?.state !== "inactive");
}

/** A check got CUSTOMER_NOT_ENABLED: remember it on the account (cleared by the next MCC pull). */
export async function markNotEnabled(clientId: string): Promise<void> {
  try {
    const sql = await getSql();
    await sql.query(`update ad_accounts set google_status = 'NOT_ENABLED', google_status_at = now() where id = $1`, [clientId]);
  } catch {
    /* column missing */
  }
}

/** Daily MCC status refresh (one customer_client query per MCC): true if it ran. */
export async function refreshMccStatusIfStale(cfg: import("./google-ads.server.ts").AdsConfig): Promise<{ ran: boolean; accounts?: number; errors?: number }> {
  const sql = await getSql();
  try {
    const r = await sql.query<{ at: Date | string | null }>(`select max(google_status_at) as at from ad_accounts where google_status is not null and google_status <> 'NOT_ENABLED'`);
    const at = Date.parse(isoOf(r[0]?.at)) || 0;
    if (Date.now() - at < 20 * 60 * 60 * 1000) return { ran: false };
  } catch {
    return { ran: false };
  }
  const { listAllMccChildren } = await import("./mcc-list.server.ts");
  const { importMccAccounts } = await import("./mcc-import.server.ts");
  const listed = await listAllMccChildren(cfg);
  const ads = listed.children.filter((c) => !c.manager && c.customer_id !== c.mcc_customer_id);
  const imported = await importMccAccounts(ads.map((c) => ({ customer_id: c.customer_id, display_name: c.name, status: c.status, manager_customer_id: c.mcc_customer_id })));
  // Newly discovered accounts: evaluate the 10-day spend rule now.
  if (imported.inserted.length) {
    const { refreshSpend10 } = await import("./spend10.server.ts");
    await refreshSpend10(imported.inserted, cfg, { force: true, deadline: Date.now() + 10_000 }).catch(() => null);
  }
  return { ran: true, accounts: ads.length, errors: listed.errors.length };
}
