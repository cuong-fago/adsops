/**
 * Google Ads keyword Quality Score snapshots + wasted search-term spend. Read-only GAQL (SELECT only).
 *
 * QS is current state only (Google keeps no history): snapshot daily (nightly cron) and on demand when
 * the Từ khoá tab / overview opens and today's snapshot is missing.
 *
 * Waste: search_term_view range aggregate (no segments.date) with conversions, all_conversions and
 * search_term_view.status (EXCLUDED / ADDED), cached per range in google_share_cache (level 'st_waste').
 * The stored deep search-term rows have neither all_conversions nor status, hence the separate query.
 */
import { getSql } from "@/lib/db";
import { AdsApiError, resolveAdsConfig, type AdsConfig, type GaqlRow } from "./google-ads.server.ts";
import { SEARCH_TERM_LOOKBACK_CAP, acquireLock, addDaysYmd, asRec, customerIdFor, numField, releaseLock, searchLeaf, ymdInTz } from "./warehouse.server.ts";
import { QS_LOW, WASTE_MIN_CLICKS, type QsCell, type QsComponent, type QsLowRow, type QsRead, type WasteBlock, type WasteRead, type WasteTerm } from "./google-qs.types.ts";

const TZ = "Asia/Ho_Chi_Minh";
const comp = (v: unknown): QsComponent | null => {
  const s = String(v || "").replace(/^QUALITY_SCORE_BUCKET_/, "");
  return s === "BELOW_AVERAGE" || s === "AVERAGE" || s === "ABOVE_AVERAGE" ? s : null;
};
const ymd = (d: unknown) => (d == null ? null : (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10));

/** One snapshot for today (replaces today's rows). Throws on API errors. */
export async function snapshotQs(cfg: AdsConfig, customerId: string, clientId: string): Promise<number> {
  const rows = await searchLeaf(
    cfg,
    customerId,
    `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.criterion_id,
            ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
            ad_group_criterion.quality_info.quality_score, ad_group_criterion.quality_info.creative_quality_score,
            ad_group_criterion.quality_info.post_click_quality_score, ad_group_criterion.quality_info.search_predicted_ctr
     FROM ad_group_criterion
     WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE
       AND ad_group_criterion.status != 'REMOVED' AND ad_group.status != 'REMOVED' AND campaign.status != 'REMOVED'`,
  );
  const date = ymdInTz(TZ);
  const sql = await getSql();
  const list: unknown[][] = [];
  for (const r of rows as GaqlRow[]) {
    const crit = asRec(r.adGroupCriterion);
    const qi = asRec(crit.qualityInfo);
    const agId = String(asRec(r.adGroup).id || "");
    const cid = String(crit.criterionId || "");
    if (!agId || !cid) continue;
    const qsRaw = qi.qualityScore;
    const qs = qsRaw == null || qsRaw === "" ? null : Number(qsRaw);
    list.push([clientId, date, agId, cid, String(asRec(r.campaign).id || "") || null, String(asRec(r.campaign).name || "") || null,
      String(asRec(r.adGroup).name || "") || null, String(asRec(crit.keyword).text || "") || null,
      String(asRec(crit.keyword).matchType || "").replace(/^KEYWORD_MATCH_TYPE_/, "") || null,
      qs != null && Number.isFinite(qs) && qs >= 1 && qs <= 10 ? qs : null,
      comp(qi.creativeQualityScore), comp(qi.postClickQualityScore), comp(qi.searchPredictedCtr)]);
  }
  await sql.query(`delete from google_qs_snapshot where client_id = $1 and date = $2`, [clientId, date]);
  for (let i = 0; i < list.length; i += 200) {
    const batch = list.slice(i, i + 200);
    const params: unknown[] = [];
    const values = batch.map((row) => `(${row.map((v) => { params.push(v); return `$${params.length}`; }).join(",")})`).join(",");
    await sql.query(
      `insert into google_qs_snapshot (client_id, date, ad_group_id, criterion_id, campaign_id, campaign_name, ad_group_name, keyword_text, match_type,
         quality_score, creative_quality, post_click_quality, predicted_ctr) values ${values}
       on conflict (client_id, date, ad_group_id, criterion_id) do nothing`,
      params,
    );
  }
  return list.length;
}

/** Nightly hook: never breaks the warehouse pull (quota / token errors bubble). */
export async function snapshotQsSafe(cfg: AdsConfig, customerId: string, clientId: string): Promise<void> {
  try {
    await snapshotQs(cfg, customerId, clientId);
  } catch (err) {
    if (err instanceof AdsApiError && (err.kind === "QUOTA" || err.kind === "TOKEN_REVOKED")) throw err;
  }
}

async function latestDate(clientId: string): Promise<string | null> {
  const sql = await getSql();
  const r = await sql.query<{ d: unknown }>(`select max(date) as d from google_qs_snapshot where client_id = $1`, [clientId]).catch(() => []);
  return ymd(r[0]?.d);
}

/** On demand: snapshot today if missing (one GAQL call, per-account lock). */
export async function ensureQs(clientId: string): Promise<void> {
  const customerId = customerIdFor(clientId);
  if (customerId.length !== 10) return;
  if ((await latestDate(clientId)) === ymdInTz(TZ)) return;
  const cfg = await resolveAdsConfig();
  if (!cfg.ready) return;
  const key = `${clientId}:qs`;
  if (!(await acquireLock(key, 120))) return;
  try {
    await snapshotQs(cfg, customerId, clientId);
  } catch {
    /* keep the older snapshot */
  } finally {
    await releaseLock(key);
  }
}

export async function readQs(clientId: string, start: string, end: string): Promise<QsRead> {
  const date = await latestDate(clientId);
  const out: QsRead = { snapshot_date: date, rows: {}, weighted_qs: null, weighted_basis: null, low: [], partial: false };
  if (!date) return out;
  const sql = await getSql();
  const snap = await sql.query<{ ad_group_id: string; criterion_id: string; quality_score: unknown; creative_quality: string | null; post_click_quality: string | null; predicted_ctr: string | null }>(
    `select ad_group_id, criterion_id, quality_score, creative_quality, post_click_quality, predicted_ctr from google_qs_snapshot where client_id = $1 and date = $2`,
    [clientId, date],
  );
  for (const s of snap) {
    out.rows[`${s.ad_group_id}~${s.criterion_id}`] = {
      qs: s.quality_score == null ? null : Number(s.quality_score),
      creative: comp(s.creative_quality), post_click: comp(s.post_click_quality), ctr: comp(s.predicted_ctr),
    } satisfies QsCell;
  }
  // Range spend / impressions per keyword from the stored keyword layer.
  const { readDeepLayer } = await import("./deep-store.server.ts");
  const kw = await readDeepLayer(clientId, "keyword", { start, end }).catch(() => null);
  if (!kw || !kw.rows.length) return out;
  out.partial = !kw.complete || kw.truncated;
  let w = 0, wi = 0, ti = 0;
  const low: QsLowRow[] = [];
  for (const r of kw.rows) {
    const m = r.metrics as Record<string, number>;
    const impr = Number(m.impressions || 0);
    ti += impr;
    const c = out.rows[r.id];
    if (!c || c.qs == null) continue;
    if (impr > 0) { w += c.qs * impr; wi += impr; }
    const cost = Number(m.cost || 0);
    if (c.qs <= QS_LOW && cost > 0) {
      low.push({ id: r.id, keyword: r.name, match_type: r.match_type_label || r.match_type || null, campaign_name: r.campaign_name || null, ad_group_name: r.ad_group_name || null,
        qs: c.qs, cost, impressions: impr, clicks: Number(m.clicks || 0), conversions: Number(m.conversions || 0), creative: c.creative, post_click: c.post_click, ctr: c.ctr });
    }
  }
  out.weighted_qs = wi > 0 ? w / wi : null;
  out.weighted_basis = wi > 0 ? { impressions: wi, total_impressions: ti } : null;
  out.low = low.sort((a, b) => b.cost - a.cost).slice(0, 20);
  return out;
}

// ── Wasted search-term spend ─────────────────────────────────────────────────────────

async function fetchWaste(customerId: string, start: string, end: string): Promise<WasteBlock> {
  const cfg = await resolveAdsConfig();
  if (!cfg.ready) throw new Error("ads not configured");
  const rows = await searchLeaf(
    cfg,
    customerId,
    `SELECT campaign.name, ad_group.name, search_term_view.search_term, search_term_view.status,
            metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.all_conversions
     FROM search_term_view WHERE segments.date BETWEEN '${start}' AND '${end}' AND metrics.cost_micros > 0`,
  );
  let total = 0, waste = 0, n = 0;
  const terms: WasteTerm[] = [];
  for (const r of rows as GaqlRow[]) {
    const m = asRec(r.metrics);
    const cost = numField(m.costMicros) / 1e6;
    total += cost;
    if (numField(m.conversions) > 0 || numField(m.allConversions) > 0) continue;
    waste += cost;
    n += 1;
    const clicks = numField(m.clicks);
    if (clicks < WASTE_MIN_CLICKS) continue;
    const st = String(asRec(r.searchTermView).status || "");
    terms.push({
      term: String(asRec(r.searchTermView).searchTerm || ""),
      campaign_name: String(asRec(r.campaign).name || ""),
      ad_group_name: String(asRec(r.adGroup).name || ""),
      clicks, impressions: numField(m.impressions), cost,
      excluded: st === "EXCLUDED" || st === "ADDED_EXCLUDED",
      added: st === "ADDED" || st === "ADDED_EXCLUDED",
    });
  }
  return { total_cost: total, waste_cost: waste, waste_terms: n, top: terms.sort((a, b) => b.cost - a.cost).slice(0, 50) };
}

async function wasteFor(clientId: string, start: string, end: string): Promise<WasteBlock | null> {
  const customerId = customerIdFor(clientId);
  if (customerId.length !== 10) return null;
  const sql = await getSql();
  const hit = await sql.query<{ payload: unknown; fetched_at: unknown }>(
    `select payload, fetched_at from google_share_cache where client_id = $1 and level = 'st_waste' and start_date = $2 and end_date = $3`,
    [clientId, start, end],
  ).catch(() => []);
  const today = ymdInTz(TZ);
  const recent = end >= addDaysYmd(today, -2);
  const parse = (p: unknown) => (typeof p === "string" ? JSON.parse(p) : p) as WasteBlock;
  if (hit.length) {
    const at = hit[0].fetched_at instanceof Date ? hit[0].fetched_at.getTime() : Date.parse(String(hit[0].fetched_at));
    if (!recent || Date.now() - at < 6 * 3600_000) return parse(hit[0].payload);
  }
  try {
    const data = await fetchWaste(customerId, start, end);
    await sql.query(
      `insert into google_share_cache (client_id, level, start_date, end_date, payload) values ($1, 'st_waste', $2, $3, $4::jsonb)
       on conflict (client_id, level, start_date, end_date) do update set payload = excluded.payload, fetched_at = now()`,
      [clientId, start, end, JSON.stringify(data)],
    ).catch(() => null);
    return data;
  } catch {
    return hit.length ? parse(hit[0].payload) : null;
  }
}

export async function readWaste(clientId: string, start: string, end: string, prev: { start: string; end: string } | null): Promise<WasteRead> {
  const today = ymdInTz(TZ);
  const floor = addDaysYmd(today, -(SEARCH_TERM_LOOKBACK_CAP - 1));
  const e = end > today ? today : end;
  const s = start < floor ? floor : start;
  const out: WasteRead = { cur: null, prev: null, start: s, end: e, clamped_start: s !== start ? s : null, error: false };
  if (e < s) return out;
  out.cur = await wasteFor(clientId, s, e);
  out.error = out.cur == null;
  // Previous period only when it is fully inside Google's search-term window (else no honest compare).
  if (prev && prev.start >= floor && prev.end >= prev.start) out.prev = await wasteFor(clientId, prev.start, prev.end);
  return out;
}
