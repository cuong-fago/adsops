/**
 * Google Ads conversions per conversion action, read-only GAQL (SELECT only).
 * segments.conversion_action* cannot be combined with impressions / clicks / cost, so this is
 * its own pull. Stored per day in google_conv_action_daily; fetched days in google_conv_action_days.
 */
import { getSql } from "@/lib/db";
import { AdsApiError, resolveAdsConfig, type AdsConfig, type GaqlRow } from "./google-ads.server.ts";
import { ANALYTICS_LOOKBACK_DAYS_MAX, acquireLock, addDaysYmd, asRec, customerIdFor, numField, releaseLock, searchLeaf, ymdInTz } from "./warehouse.server.ts";
import type { ActionCells, ConvActionInfo, ConvActionLayer, ConvActionRead } from "./google-conv-actions.types.ts";

const FIELDS = "segments.date, segments.conversion_action, segments.conversion_action_name, segments.conversion_action_category, metrics.conversions, metrics.conversions_value, metrics.all_conversions";

const QUERIES: Record<ConvActionLayer, (range: string) => string> = {
  campaign: (range) => `SELECT campaign.id, ${FIELDS} FROM campaign WHERE ${range} AND metrics.all_conversions > 0`,
  ad_group: (range) => `SELECT campaign.id, ad_group.id, ${FIELDS} FROM ad_group WHERE ${range} AND metrics.all_conversions > 0`,
  keyword: (range) =>
    `SELECT campaign.id, ad_group.id, ad_group_criterion.criterion_id, ${FIELDS} FROM keyword_view WHERE ${range} AND metrics.all_conversions > 0`,
};

const actionIdOf = (resource: unknown): string => {
  const s = String(resource || "");
  const m = /conversionActions\/(\d+)/.exec(s);
  return m ? m[1] : s;
};
const catOf = (raw: unknown): string | null => {
  const s = String(raw || "").replace(/^CONVERSION_ACTION_CATEGORY_/, "");
  return s && s !== "UNSPECIFIED" && s !== "UNKNOWN" ? s : null;
};

/**
 * Pull all three levels for [start, end] and replace that range. Marks the days as fetched.
 * Throws on API errors (callers decide whether it is best-effort).
 */
export async function pullConvActions(cfg: AdsConfig, customerId: string, clientId: string, start: string, end: string): Promise<{ rows: number }> {
  if (end < start) return { rows: 0 };
  const range = `segments.date BETWEEN '${start}' AND '${end}'`;
  const levels: ConvActionLayer[] = ["campaign", "ad_group", "keyword"];
  const fetched = await Promise.all(levels.map((l) => searchLeaf(cfg, customerId, QUERIES[l](range)).then((rows) => ({ level: l, rows }))));
  const sql = await getSql();
  let total = 0;
  for (const { level, rows } of fetched) {
    await sql.query(`delete from google_conv_action_daily where client_id = $1 and level = $2 and date between $3 and $4`, [clientId, level, start, end]);
    // GAQL can return the same key twice across pages for some segments: merge before insert.
    const merged = new Map<string, unknown[]>();
    for (const r of rows as GaqlRow[]) {
      const seg = asRec(r.segments);
      const m = asRec(r.metrics);
      const date = String(seg.date || "");
      const actionId = actionIdOf(seg.conversionAction);
      if (!date || !actionId) continue;
      const campaignId = String(asRec(r.campaign).id || "");
      const adGroupId = level === "campaign" ? "" : String(asRec(r.adGroup).id || "");
      const criterionId = level === "keyword" ? String(asRec(r.adGroupCriterion).criterionId || "") : "";
      const key = [date, campaignId, adGroupId, criterionId, actionId].join("|");
      const prev = merged.get(key);
      const conv = numField(m.conversions), value = numField(m.conversionsValue), all = numField(m.allConversions);
      if (prev) {
        prev[11] = Number(prev[11]) + conv; prev[12] = Number(prev[12]) + value; prev[13] = Number(prev[13]) + all;
      } else {
        merged.set(key, [clientId, customerId, date, level, campaignId, adGroupId, criterionId, actionId,
          String(seg.conversionActionName || "") || null, catOf(seg.conversionActionCategory), null, conv, value, all]);
      }
    }
    const list = [...merged.values()].map((v) => [...v.slice(0, 10), ...v.slice(11)]);
    for (let i = 0; i < list.length; i += 200) {
      const batch = list.slice(i, i + 200);
      const params: unknown[] = [];
      const values = batch.map((row) => `(${row.map((v) => { params.push(v); return `$${params.length}`; }).join(",")})`).join(",");
      await sql.query(
        `insert into google_conv_action_daily (client_id, customer_id, date, level, campaign_id, ad_group_id, criterion_id, action_id, action_name, category, conversions, value, all_conversions)
         values ${values}
         on conflict (client_id, level, date, campaign_id, ad_group_id, criterion_id, action_id) do update set
           action_name = excluded.action_name, category = excluded.category, conversions = excluded.conversions,
           value = excluded.value, all_conversions = excluded.all_conversions, pulled_at = now()`,
        params,
      );
      total += batch.length;
    }
  }
  await sql.query(
    `insert into google_conv_action_days (client_id, date)
     select $1, d::date from generate_series($2::date, $3::date, interval '1 day') d
     on conflict (client_id, date) do update set pulled_at = now()`,
    [clientId, start, end],
  );
  return { rows: total };
}

/** Best-effort hook for the warehouse pulls (never breaks them; quota / token errors bubble). */
export async function pullConvActionsSafe(cfg: AdsConfig, customerId: string, clientId: string, start: string, end: string): Promise<void> {
  try {
    await pullConvActions(cfg, customerId, clientId, start, end);
  } catch (err) {
    if (err instanceof AdsApiError && (err.kind === "QUOTA" || err.kind === "TOKEN_REVOKED")) throw err;
  }
}

async function fetchedDays(clientId: string, start: string, end: string): Promise<Set<string>> {
  const sql = await getSql();
  const r = await sql.query<{ d: unknown }>(
    `select date as d from google_conv_action_days where client_id = $1 and date between $2 and $3`, [clientId, start, end],
  ).catch(() => []);
  return new Set(r.map((x) => (x.d instanceof Date ? x.d.toISOString() : String(x.d)).slice(0, 10)));
}

/** Longest run of not-fetched days in [start, end] (one query covers it). */
function missingSpan(have: Set<string>, start: string, end: string): { start: string; end: string } | null {
  let first: string | null = null;
  let last: string | null = null;
  for (let d = start; d <= end; d = addDaysYmd(d, 1)) {
    if (!have.has(d)) { if (!first) first = d; last = d; }
  }
  return first && last ? { start: first, end: last } : null;
}

/**
 * On demand: fetch any not-yet-fetched days in [start, end] (clamped to the warehouse floor).
 * One lock per account; at most ~one GAQL round per call.
 */
export async function ensureConvActions(clientId: string, start: string, end: string): Promise<"done" | "filled" | "busy" | "error" | "skipped"> {
  const customerId = customerIdFor(clientId);
  if (customerId.length !== 10) return "skipped";
  const today = ymdInTz("Asia/Ho_Chi_Minh");
  const floor = addDaysYmd(today, -(ANALYTICS_LOOKBACK_DAYS_MAX - 1));
  const s = start < floor ? floor : start;
  const e = end > today ? today : end;
  if (e < s) return "done";
  const span = missingSpan(await fetchedDays(clientId, s, e), s, e);
  if (!span) return "done";
  const cfg = await resolveAdsConfig();
  if (!cfg.ready) return "skipped";
  const key = `${clientId}:convact`;
  if (!(await acquireLock(key, 120))) return "busy";
  try {
    await pullConvActions(cfg, customerId, clientId, span.start, span.end);
    return "filled";
  } catch {
    return "error";
  } finally {
    await releaseLock(key);
  }
}

function keyExpr(layer: ConvActionLayer): string {
  return layer === "campaign" ? "campaign_id" : layer === "ad_group" ? "ad_group_id" : "ad_group_id || '~' || criterion_id";
}

async function readCells(clientId: string, layer: ConvActionLayer, start: string, end: string, campaignId?: string | null, adGroupId?: string | null) {
  const sql = await getSql();
  const params: unknown[] = [clientId, layer, start, end];
  let scope = "";
  if (campaignId) { params.push(campaignId); scope += ` and campaign_id = $${params.length}`; }
  if (adGroupId && layer !== "campaign") { params.push(adGroupId); scope += ` and ad_group_id = $${params.length}`; }
  const r = await sql.query<{ k: string; action_id: string; name: string | null; category: string | null; c: unknown; v: unknown; a: unknown }>(
    `select ${keyExpr(layer)} as k, action_id, max(action_name) as name, max(category) as category,
            sum(conversions) as c, sum(value) as v, sum(all_conversions) as a
       from google_conv_action_daily where client_id = $1 and level = $2 and date between $3 and $4${scope}
      group by 1, 2`,
    params,
  );
  const rows: Record<string, ActionCells> = {};
  const actions = new Map<string, ConvActionInfo>();
  for (const x of r) {
    const c = Number(x.c || 0), v = Number(x.v || 0), a = Number(x.a || 0);
    (rows[x.k] ||= {})[x.action_id] = [c, v, a];
    const info = actions.get(x.action_id) || { id: x.action_id, name: x.name || x.action_id, category: x.category, conversions: 0, value: 0, all_conversions: 0 };
    info.conversions += c; info.value += v; info.all_conversions += a;
    if (x.name) info.name = x.name;
    actions.set(x.action_id, info);
  }
  return { rows, actions };
}

const dayCount = (s: string, e: string) => Math.round((Date.parse(e) - Date.parse(s)) / 86_400_000) + 1;

export async function readConvActions(
  clientId: string,
  layer: ConvActionLayer,
  opts: { start: string; end: string; campaignId?: string | null; adGroupId?: string | null; prevStart?: string | null; prevEnd?: string | null },
): Promise<ConvActionRead> {
  const cur = await readCells(clientId, layer, opts.start, opts.end, opts.campaignId, opts.adGroupId);
  const have = await fetchedDays(clientId, opts.start, opts.end);
  let prev: Awaited<ReturnType<typeof readCells>> | null = null;
  let prevHave: Set<string> | null = null;
  if (opts.prevStart && opts.prevEnd) {
    prev = await readCells(clientId, layer, opts.prevStart, opts.prevEnd, opts.campaignId, opts.adGroupId);
    prevHave = await fetchedDays(clientId, opts.prevStart, opts.prevEnd);
    // Actions seen only in the previous period still appear as filter options.
    for (const [id, a] of prev.actions) if (!cur.actions.has(id)) cur.actions.set(id, { ...a, conversions: 0, value: 0, all_conversions: 0 });
  }
  return {
    layer,
    actions: [...cur.actions.values()].sort((a, b) => b.conversions - a.conversions || a.name.localeCompare(b.name)),
    rows: cur.rows,
    covered_days: have.size,
    total_days: dayCount(opts.start, opts.end),
    prev_rows: prev ? prev.rows : null,
    prev_covered_days: prevHave ? prevHave.size : null,
    prev_total_days: opts.prevStart && opts.prevEnd ? dayCount(opts.prevStart, opts.prevEnd) : null,
  };
}
