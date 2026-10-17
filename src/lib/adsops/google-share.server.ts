/**
 * Google Ads impression-share metrics (read-only GAQL, SELECT only).
 *
 * Accuracy choice: share metrics are impressions / eligible impressions, and Google never exposes
 * eligible impressions. Re-weighting daily values (eligible ≈ impressions / IS per day) breaks on days
 * Google clamps to "< 10%" / "> 90%" (0.0999 / 0.9001), on days with IS but 0 impressions, and for
 * lost-IS / top-IS whose denominators differ. So we query the range aggregate (no segments.date):
 * Google computes the exact share for the range. Cached per (client, level, range) in
 * google_share_cache; ranges touching the last 2 days refresh after 6 h, older ranges are final.
 */
import { getSql } from "@/lib/db";
import { resolveAdsConfig, type GaqlRow } from "./google-ads.server.ts";
import { addDaysYmd, asRec, customerIdFor, searchLeaf, ymdInTz } from "./warehouse.server.ts";
import type { ShareCells, ShareLayer, ShareRead } from "./google-share.types.ts";

type Level = ShareLayer | "account";

/** GAQL field (camelCase in REST rows) → our key. */
const F: Record<string, [string, string]> = {
  is: ["metrics.search_impression_share", "searchImpressionShare"],
  is_lost_budget: ["metrics.search_budget_lost_impression_share", "searchBudgetLostImpressionShare"],
  is_lost_rank: ["metrics.search_rank_lost_impression_share", "searchRankLostImpressionShare"],
  top_is: ["metrics.search_top_impression_share", "searchTopImpressionShare"],
  abs_top_is: ["metrics.search_absolute_top_impression_share", "searchAbsoluteTopImpressionShare"],
  top_pct: ["metrics.top_impression_percentage", "topImpressionPercentage"],
  abs_top_pct: ["metrics.absolute_top_impression_percentage", "absoluteTopImpressionPercentage"],
  exact_is: ["metrics.search_exact_match_impression_share", "searchExactMatchImpressionShare"],
};
const KEYS: Record<Level, string[]> = {
  // The customer resource rejects search_top / search_absolute_top impression share
  // (PROHIBITED_METRIC_IN_SELECT_OR_WHERE_CLAUSE, seen in production): never request them here.
  account: ["is", "is_lost_budget", "is_lost_rank", "top_pct", "abs_top_pct", "exact_is"],
  campaign: ["is", "is_lost_budget", "is_lost_rank", "top_is", "abs_top_is", "top_pct", "abs_top_pct", "exact_is"],
  ad_group: ["is", "is_lost_rank", "top_is", "abs_top_is", "top_pct", "abs_top_pct"],
  keyword: ["is", "is_lost_rank", "top_is", "abs_top_is", "top_pct", "abs_top_pct"],
};

/** Minimal account set, used if Google rejects another account-level metric. */
const ACCOUNT_SAFE = ["is", "is_lost_budget", "is_lost_rank"];

function query(level: Level, start: string, end: string, keys: string[] = KEYS[level]): string {
  const fields = keys.map((k) => F[k][0]).join(", ");
  const where = `segments.date BETWEEN '${start}' AND '${end}' AND metrics.impressions > 0`;
  if (level === "account") return `SELECT customer.id, ${fields} FROM customer WHERE ${where}`;
  if (level === "campaign") return `SELECT campaign.id, ${fields} FROM campaign WHERE ${where}`;
  if (level === "ad_group") return `SELECT ad_group.id, ${fields} FROM ad_group WHERE ${where}`;
  return `SELECT ad_group.id, ad_group_criterion.criterion_id, ${fields} FROM keyword_view WHERE ${where}`;
}

function keyOf(level: Level, r: GaqlRow): string {
  if (level === "account") return "account";
  if (level === "campaign") return String(asRec(r.campaign).id || "");
  if (level === "ad_group") return String(asRec(r.adGroup).id || "");
  const ag = String(asRec(r.adGroup).id || "");
  const crit = String(asRec(r.adGroupCriterion).criterionId || "");
  return ag && crit ? `${ag}~${crit}` : "";
}

/** Values Google omits (non-search campaigns, PMax, Display…) stay absent → blank. */
function cellsOf(level: Level, r: GaqlRow): ShareCells {
  const m = asRec(r.metrics);
  const out: ShareCells = {};
  for (const k of KEYS[level]) {
    const raw = m[F[k][1]];
    if (raw == null || raw === "") continue;
    const v = Number(raw);
    if (Number.isFinite(v) && v >= 0 && v <= 1) out[k] = v;
  }
  return out;
}

async function fetchLevel(customerId: string, level: Level, start: string, end: string): Promise<Record<string, ShareCells>> {
  const cfg = await resolveAdsConfig();
  if (!cfg.ready) throw new Error("ads not configured");
  let rows: GaqlRow[];
  try {
    rows = await searchLeaf(cfg, customerId, query(level, start, end));
  } catch (e) {
    if (level !== "account" || !/PROHIBITED_METRIC/i.test(e instanceof Error ? e.message : String(e))) throw e;
    rows = await searchLeaf(cfg, customerId, query(level, start, end, ACCOUNT_SAFE));
  }
  const out: Record<string, ShareCells> = {};
  for (const r of rows) {
    const k = keyOf(level, r);
    if (!k) continue;
    const c = cellsOf(level, r);
    if (Object.keys(c).length) out[k] = { ...(out[k] || {}), ...c };
  }
  return out;
}


/** Cached range aggregate for one level; null when it cannot be read. */
async function levelShares(clientId: string, level: Level, start: string, end: string): Promise<Record<string, ShareCells> | null> {
  const customerId = customerIdFor(clientId);
  if (customerId.length !== 10) return null;
  const today = ymdInTz("Asia/Ho_Chi_Minh");
  const e = end > today ? today : end;
  if (e < start) return {};
  const sql = await getSql();
  const hit = await sql
    .query<{ payload: unknown; fetched_at: unknown }>(
      `select payload, fetched_at from google_share_cache where client_id = $1 and level = $2 and start_date = $3 and end_date = $4`,
      [clientId, level, start, e],
    )
    .catch(() => []);
  const recent = e >= addDaysYmd(today, -2);
  if (hit.length) {
    const age = Date.now() - new Date(String(hit[0].fetched_at instanceof Date ? hit[0].fetched_at.toISOString() : hit[0].fetched_at)).getTime();
    if (!recent || age < 6 * 3600_000) {
      const p = hit[0].payload;
      return (typeof p === "string" ? JSON.parse(p) : p) as Record<string, ShareCells>;
    }
  }
  try {
    const data = await fetchLevel(customerId, level, start, e);
    await sql.query(
      `insert into google_share_cache (client_id, level, start_date, end_date, payload) values ($1, $2, $3, $4, $5::jsonb)
       on conflict (client_id, level, start_date, end_date) do update set payload = excluded.payload, fetched_at = now()`,
      [clientId, level, start, e, JSON.stringify(data)],
    );
    return data;
  } catch {
    // Stale cache beats nothing; else unknown.
    if (hit.length) {
      const p = hit[0].payload;
      return (typeof p === "string" ? JSON.parse(p) : p) as Record<string, ShareCells>;
    }
    return null;
  }
}

export async function readShares(
  clientId: string,
  layer: ShareLayer,
  opts: { start: string; end: string; prevStart?: string | null; prevEnd?: string | null },
): Promise<ShareRead> {
  const wantAccount = layer === "campaign";
  const [cur, acc] = await Promise.all([
    levelShares(clientId, layer, opts.start, opts.end),
    wantAccount ? levelShares(clientId, "account", opts.start, opts.end) : Promise.resolve(null),
  ]);
  let prev: Record<string, ShareCells> | null = null;
  let prevAcc: Record<string, ShareCells> | null = null;
  if (opts.prevStart && opts.prevEnd) {
    [prev, prevAcc] = await Promise.all([
      levelShares(clientId, layer, opts.prevStart, opts.prevEnd),
      wantAccount ? levelShares(clientId, "account", opts.prevStart, opts.prevEnd) : Promise.resolve(null),
    ]);
  }
  return {
    layer,
    rows: cur || {},
    account: acc?.account || null,
    prev_rows: prev,
    prev_account: prevAcc?.account || null,
    error: cur == null,
  };
}
