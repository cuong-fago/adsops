/**
 * Read-only optimize summary for the box bot (GET /api/bot/optimize-summary).
 * Reads only the app DB (warehouse, runway, optimization score, change log). No Google call.
 * Missing values are null — never 0.
 */
import { getSql } from "@/lib/db";
import type { AnalyticsSnap, DailyRow } from "./analytics.ts";
import { searchKey } from "./accounts-overview.types.ts";
import { OPTIMIZED_ACTIONS } from "./change-log.types.ts";

type Agg = { cost: number; clicks: number; impressions: number; conversions: number };
type Metrics = {
  cost: number | null; clicks: number | null; impressions: number | null; conversions: number | null;
  cpa: number | null; cpc: number | null; ctr: number | null; cr: number | null;
};
const KEYS = ["cost", "clicks", "impressions", "conversions", "cpa", "cpc", "ctr", "cr"] as const;

export function botAuthorized(request: Request): boolean {
  const secret = process.env.BOT_READ_TOKEN?.trim();
  if (!secret || secret.length < 32) return false;
  const got = request.headers.get("authorization") || "";
  const want = `Bearer ${secret}`;
  let diff = got.length ^ want.length;
  for (let i = 0; i < want.length; i++) diff |= (got.charCodeAt(i) || 0) ^ want.charCodeAt(i);
  return diff === 0;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const div = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : r4(a / b));

function metrics(a: Agg | null, days: number): Metrics {
  if (!a) return { cost: null, clicks: null, impressions: null, conversions: null, cpa: null, cpc: null, ctr: null, cr: null };
  const p = (v: number) => r4(v / days);
  return {
    cost: p(a.cost), clicks: p(a.clicks), impressions: p(a.impressions), conversions: p(a.conversions),
    cpa: div(a.cost, a.conversions), cpc: div(a.cost, a.clicks),
    ctr: a.impressions ? r4((a.clicks / a.impressions) * 100) : null,
    cr: a.clicks ? r4((a.conversions / a.clicks) * 100) : null,
  };
}

function pctDiff(cur: Metrics, base: Metrics): Record<string, number | null> {
  const o: Record<string, number | null> = {};
  for (const k of KEYS) {
    const c = cur[k], b = base[k];
    o[k] = c == null || b == null || b === 0 ? null : Math.round(((c - b) / b) * 1000) / 10;
  }
  return o;
}

function addDays(iso: string, d: number): string {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}

/** Sum rows in [start,end]; null when no stored row falls in the window. */
function sum(rows: DailyRow[], start: string, end: string): Agg | null {
  let hit = false;
  const a: Agg = { cost: 0, clicks: 0, impressions: 0, conversions: 0 };
  for (const r of rows) {
    if (!r.date || r.date < start || r.date > end) continue;
    hit = true;
    a.cost += Number(r.cost || 0); a.clicks += Number(r.clicks || 0);
    a.impressions += Number(r.impressions || 0); a.conversions += Number(r.conversions || 0);
  }
  return hit ? a : null;
}

function periods(rows: DailyRow[], date: string) {
  const y = metrics(sum(rows, date, date), 1);
  // 7d / 30d windows end the day before `date` (the comparison baseline).
  const d7 = metrics(sum(rows, addDays(date, -7), addDays(date, -1)), 7);
  const d30 = metrics(sum(rows, addDays(date, -30), addDays(date, -1)), 30);
  return { yesterday: y, avg_7d: d7, avg_30d: d30, diff_pct_vs_7d: pctDiff(y, d7), diff_pct_vs_30d: pctDiff(y, d30) };
}

/** Live daily budgets (read-only GAQL SELECT; not stored in the app DB). Null on any failure. */
async function liveBudgets(clientId: string): Promise<{ total: number | null; byCampaign: Map<string, number> } | null> {
  try {
    const g = await import("./google-ads.server.ts");
    const { customerIdFor } = await import("./warehouse.server.ts");
    const cfg = await g.resolveAdsConfig();
    if (!cfg.ready) return null;
    const cid = customerIdFor(clientId);
    if (cid.length !== 10) return null;
    const { searchLeaf } = await import("./warehouse.server.ts");
    const rows = await Promise.race([
      searchLeaf(cfg, cid, `SELECT campaign.id, campaign_budget.resource_name, campaign_budget.amount_micros FROM campaign WHERE campaign.status = 'ENABLED'`),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000)),
    ]);
    const byCampaign = new Map<string, number>();
    const seen = new Map<string, number>();
    for (const r of rows as Array<Record<string, Record<string, unknown>>>) {
      const amt = r.campaignBudget?.amountMicros;
      if (amt == null) continue;
      const v = Number(amt) / 1_000_000;
      byCampaign.set(String(r.campaign?.id || ""), v);
      seen.set(String(r.campaignBudget?.resourceName || r.campaign?.id), v);
    }
    return { total: seen.size ? [...seen.values()].reduce((a, b) => a + b, 0) : null, byCampaign };
  } catch {
    return null;
  }
}

const iso = (v: Date | string | null) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

export async function optimizeSummary(name: string, date: string) {
  const sql = await getSql();
  const { listRosterAccounts } = await import("./access.server");
  const { withPulledMccClients } = await import("./mcc-import.server");
  const dir = await withPulledMccClients({ clients: await listRosterAccounts() } as never, "all");
  let aliases = new Map<string, string>();
  try {
    const ar = await sql.query<{ id: string; alias: string }>(`select id, alias from ad_accounts where alias is not null and btrim(alias) <> ''`);
    aliases = new Map(ar.map((r) => [r.id, r.alias]));
  } catch { /* none */ }
  const q = searchKey(name);
  const accs = (dir as { clients: Array<{ client_id: string; display_name: string; customer_id_dashed: string; status?: string; alias?: string | null; platform?: string }> }).clients
    .filter((c) => !c.platform || c.platform === "google")
    .filter((c) => {
      const alias = c.alias || aliases.get(c.client_id) || "";
      return !q || searchKey(c.display_name).includes(q) || searchKey(alias).includes(q);
    });
  const ids = accs.map((a) => a.client_id);
  if (!ids.length) return [];

  const [wh, rw, sc, opt] = await Promise.all([
    sql.query<{ client_id: string; payload: unknown; pulled_at: Date | string | null }>(
      `select client_id, payload, pulled_at from adsops_analytics_warehouse where client_id = any($1::text[])`, [ids]).catch(() => []),
    sql.query<{ client_id: string; runway_days: number | string | null; checked_at: Date | string }>(
      `select client_id, runway_days, checked_at from ads_budget_runway where client_id = any($1::text[])`, [ids]).catch(() => []),
    import("./optimization-score.server").then((m) => m.readOptimizationScores(accs.map((a) => ({ client_id: a.client_id, label: a.display_name, customer_id_dashed: a.customer_id_dashed })))).catch(() => []),
    sql.query<{ client_id: string; last: Date | string | null }>(
      `select client_id, max(change_date_time) as last from ads_change_events
        where client_id = any($1::text[]) and action = any($2::text[]) group by client_id`, [ids, OPTIMIZED_ACTIONS]).catch(() => []),
  ]);
  const W = new Map(wh.map((r) => [r.client_id, r]));
  const R = new Map(rw.map((r) => [r.client_id, r]));
  const S = new Map(sc.map((r) => [r.client_id, r]));
  const O = new Map(opt.map((r) => [r.client_id, r.last]));
  const now = Date.now();
  const [budgets, deepSt] = await Promise.all([
    Promise.all(ids.map((id) => liveBudgets(id))),
    sql.query<{ client_id: string; rows: unknown; cs: string; ce: string }>(
      `select client_id, rows, to_char(covered_start,'YYYY-MM-DD') as cs, to_char(covered_end,'YYYY-MM-DD') as ce
         from adsops_analytics_deep where client_id = any($1::text[]) and layer = 'search_term'
          and covered_end >= $2::date and covered_start <= $3::date`, [ids, addDays(date, -6), date]).catch(() => []),
  ]);
  const B = new Map(ids.map((id, i) => [id, budgets[i]]));
  const D = new Map<string, { rows: DailyRow[]; days: number }>();
  for (const m of deepSt) {
    const raw = typeof m.rows === "string" ? JSON.parse(m.rows) : m.rows;
    const rows = (Array.isArray(raw) ? raw : (raw as { rows?: DailyRow[] })?.rows || []) as DailyRow[];
    const lo = m.cs > addDays(date, -6) ? m.cs : addDays(date, -6), hi = m.ce < date ? m.ce : date;
    const days = hi >= lo ? Math.round((Date.parse(hi) - Date.parse(lo)) / 86_400_000) + 1 : 0;
    const e = D.get(m.client_id) || { rows: [], days: 0 };
    e.rows.push(...rows); e.days += days;
    D.set(m.client_id, e);
  }

  return accs.map((a) => {
    const w = W.get(a.client_id);
    const snap = (w ? (typeof w.payload === "string" ? JSON.parse(w.payload) : w.payload) : null) as AnalyticsSnap | null;
    const daily = snap?.daily;
    const acct = periods(daily?.account || [], date);
    const bud = B.get(a.client_id) ?? null;
    const dailyBudget = bud?.total ?? null;
    const camps = new Map<string, { name: string; type: string | null; status: string | null; rows: DailyRow[] }>();
    for (const c of snap?.campaigns || []) camps.set(c.id, { name: c.name, type: c.type || null, status: c.status || null, rows: [] });
    for (const r of daily?.campaign || []) {
      if (!r.campaign_id) continue;
      const c = camps.get(r.campaign_id) || { name: r.campaign_name || r.campaign_id, type: r.campaign_type || null, status: r.status || null, rows: [] };
      c.rows.push(r);
      camps.set(r.campaign_id, c);
    }
    const campaigns = [...camps.entries()]
      .filter(([, c]) => c.rows.some((r) => r.date >= addDays(date, -30) && r.date <= date))
      .map(([id, c]) => ({ id, name: c.name, type: c.type, status: c.status, daily_budget: bud?.byCampaign.get(id) ?? null, ...periods(c.rows, date) }))
      .sort((x, y) => (y.avg_30d.cost ?? -1) - (x.avg_30d.cost ?? -1));
    const st = new Map<string, { query: string; campaign: string | null; cost: number; clicks: number; impressions: number; conversions: number }>();
    const deep = D.get(a.client_id);
    const stRows: DailyRow[] = deep && deep.days > 0 ? deep.rows : daily?.search_term || [];
    for (const r of stRows) {
      if (!r.query || r.date < addDays(date, -6) || r.date > date) continue;
      const k = `${r.query}\u0000${r.campaign_id || ""}`;
      const e = st.get(k) || { query: r.query, campaign: r.campaign_name || null, cost: 0, clicks: 0, impressions: 0, conversions: 0 };
      e.cost += Number(r.cost || 0); e.clicks += Number(r.clicks || 0); e.impressions += Number(r.impressions || 0); e.conversions += Number(r.conversions || 0);
      st.set(k, e);
    }
    const waste = [...st.values()].filter((e) => e.cost > 0 && e.conversions === 0)
      .sort((x, y) => y.cost - x.cost).slice(0, 20)
      .map((e) => ({ query: e.query, campaign: e.campaign, cost: r4(e.cost), clicks: e.clicks, impressions: e.impressions }));
    const s = S.get(a.client_id);
    const scoreRaw = s?.score ?? null;
    const last = O.get(a.client_id) ?? null;
    const r = R.get(a.client_id);
    const searchCovered = stRows.some((x) => x.date >= addDays(date, -6) && x.date <= date);
    return {
      cid: (a.customer_id_dashed.match(/\d{3}-\d{3}-\d{4}/) || [null])[0],
      client_id: a.client_id,
      name: a.alias || aliases.get(a.client_id) ? `${a.alias || aliases.get(a.client_id)} — ${a.display_name}` : a.display_name,
      status: a.status || null,
      currency: snap?.currency ?? null,
      date,
      daily_budget: dailyBudget,
      spend_vs_daily_budget_pct: dailyBudget && acct.yesterday.cost != null ? Math.round((acct.yesterday.cost / dailyBudget) * 1000) / 10 : null,
      budget_days_left: r?.runway_days == null ? null : Number(r.runway_days),
      optimization_score: scoreRaw == null ? null : Number(scoreRaw),
      days_since_last_keyword_optimization: last ? Math.floor((now - Date.parse(iso(last)!)) / 86_400_000) : null,
      last_keyword_optimization_at: iso(last),
      data_updated_at: iso(w?.pulled_at ?? null),
      data_through: snap?.warehouse_end ?? null,
      metrics: acct,
      campaigns,
      wasted_search_terms_7d: searchCovered ? waste : null,
      search_terms_covered_days_7d: deep ? Math.min(7, deep.days) : null,
    };
  });
}
