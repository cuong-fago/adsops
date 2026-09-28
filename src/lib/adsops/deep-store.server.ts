/**
 * Ad group / keyword / search term layers ("deep" layers), stored month by month
 * in Neon `adsops_analytics_deep`.
 *
 * - `pullDeepChunk`: pulls ONE month window (newest missing month first) for the
 *   three layers and persists it. Each request stays well inside Vercel function
 *   limits; the browser calls it repeatedly until `done`.
 * - `readDeepLayer`: aggregates stored rows for a date range on the server and
 *   returns only the table rows + the exact covered days (never zero-fills).
 *
 * Read-only GAQL (searchStream) only — never mutates Google Ads.
 *
 * Note: `metrics.invalid_clicks` is only selectable with `customer` / `campaign`
 * in the Google Ads API, so it is never requested here (the UI shows "—").
 */
import { getSql } from "@/lib/db";
import {
  aggregateDeepRows,
  derivedMetrics,
  type CoveredRange,
  type DailyRow,
  type DeepLayerBlock,
  type DeepLayerId,
} from "./analytics.ts";
import { AdsApiError, resolveAdsConfig, searchStream, type AdsConfig, type GaqlRow } from "./google-ads.server.ts";
import {
  ANALYTICS_LOOKBACK_DAYS_MAX,
  SEARCH_TERM_LOOKBACK_CAP,
  acquireLock,
  addDaysYmd,
  asRec,
  classifyAction,
  customerIdFor,
  microsToCurrency,
  numField,
  pullMeta,
  releaseLock,
  statusCode,
  ymdInTz,
} from "./warehouse.server.ts";

const CLIENT_ID_RE = /^[a-z0-9_]+$/;
const LAYERS: DeepLayerId[] = ["ad_group", "keyword", "search_term"];
/** Max rows returned to the browser for one table (totals still cover all rows). */
const MAX_TABLE_ROWS = 500;
const TOTAL_KEYS = ["impressions", "clicks", "cost", "conversions", "conv_call", "conv_zalo", "conv_facebook_chat", "conv_form", "conv_other"];

export type DeepChunkResult = {
  ok: boolean;
  client_id?: string;
  /** Window pulled by this request (null when nothing was left to pull). */
  pulled?: { start: string; end: string } | null;
  target_start?: string;
  target_end?: string;
  /** Oldest day covered continuously back from target_end for ad groups / keywords. */
  covered_from?: string | null;
  remaining_months?: number;
  done?: boolean;
  counts?: { ad_group: number; keyword: number; search_term: number };
  note_vi?: string | null;
  error_vi?: string | null;
};

type StoredMonth = {
  layer: string;
  month: string;
  covered_start: string;
  covered_end: string;
  rows?: unknown;
};

type MonthPayload = { v: 1; conv_split: boolean; rows: DailyRow[] };

function monthOf(ymd: string): string {
  return ymd.slice(0, 7);
}

function monthStart(month: string): string {
  return `${month}-01`;
}

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

function maxYmd(a: string, b: string) {
  return a > b ? a : b;
}

function minYmd(a: string, b: string) {
  return a < b ? a : b;
}

function dayCount(start: string, end: string): number {
  if (end < start) return 0;
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
}

async function readCoverage(clientId: string, layer: DeepLayerId): Promise<Map<string, StoredMonth>> {
  const sql = await getSql();
  const rows = await sql.query<StoredMonth>(
    `select layer, month, to_char(covered_start, 'YYYY-MM-DD') as covered_start, to_char(covered_end, 'YYYY-MM-DD') as covered_end
     from adsops_analytics_deep where client_id = $1 and layer = $2`,
    [clientId, layer],
  );
  return new Map(rows.map((r) => [r.month, r]));
}

async function upsertMonth(
  clientId: string,
  layer: DeepLayerId,
  month: string,
  start: string,
  end: string,
  payload: MonthPayload,
): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `insert into adsops_analytics_deep (client_id, layer, month, rows, covered_start, covered_end, pulled_at)
     values ($1, $2, $3, $4::jsonb, $5::date, $6::date, now())
     on conflict (client_id, layer, month) do update set
       rows = excluded.rows,
       covered_start = excluded.covered_start,
       covered_end = excluded.covered_end,
       pulled_at = excluded.pulled_at`,
    [clientId, layer, month, JSON.stringify(payload), start, end],
  );
}

/** Month windows [newest → oldest] inside [targetStart, targetEnd]. */
function monthWindows(targetStart: string, targetEnd: string): Array<{ month: string; start: string; end: string }> {
  const out: Array<{ month: string; start: string; end: string }> = [];
  let m = monthOf(targetEnd);
  const stop = monthOf(targetStart);
  for (let i = 0; i < 14; i++) {
    out.push({ month: m, start: maxYmd(monthStart(m), targetStart), end: minYmd(monthEnd(m), targetEnd) });
    if (m === stop) break;
    m = prevMonth(m);
  }
  return out;
}

function covers(row: StoredMonth | undefined, start: string, end: string): boolean {
  return Boolean(row && row.covered_start <= start && row.covered_end >= end);
}

// ── GAQL (read-only) ────────────────────────────────────────────────────────

type Split = Map<string, Record<string, number>>;

async function actionNames(cfg: AdsConfig, customerId: string): Promise<Map<string, string>> {
  const rows = await searchStream(cfg, customerId, `SELECT conversion_action.id, conversion_action.name FROM conversion_action`);
  const names = new Map<string, string>();
  for (const row of rows) {
    const ca = asRec(row.conversionAction);
    if (ca.id) names.set(`customers/${customerId}/conversionActions/${ca.id}`, String(ca.name || ""));
  }
  return names;
}

function buildSplit(rows: GaqlRow[], names: Map<string, string>, keyOf: (r: GaqlRow) => string | null): Split {
  const out: Split = new Map();
  for (const row of rows) {
    const seg = asRec(row.segments);
    const bucket = classifyAction(names.get(String(seg.conversionAction || "")) || "");
    const key = keyOf(row);
    if (!key || !bucket) continue;
    const slot = out.get(key) || { conv_call: 0, conv_zalo: 0, conv_facebook_chat: 0, conv_form: 0, conv_other: 0 };
    slot[bucket] += numField(asRec(row.metrics).conversions);
    out.set(key, slot);
  }
  return out;
}

const EMPTY_SPLIT = { conv_call: 0, conv_zalo: 0, conv_facebook_chat: 0, conv_form: 0, conv_other: 0 };

function metricsOf(m: Record<string, unknown>) {
  return {
    impressions: numField(m.impressions),
    clicks: numField(m.clicks),
    cost: microsToCurrency(m.costMicros),
    conversions: numField(m.conversions),
  };
}

/** Best-effort conversion split; null when the API refuses the segment. */
async function trySplit(
  cfg: AdsConfig,
  customerId: string,
  query: string,
  names: Map<string, string> | null,
  keyOf: (r: GaqlRow) => string | null,
): Promise<Split | null> {
  if (!names) return null;
  try {
    return buildSplit(await searchStream(cfg, customerId, query), names, keyOf);
  } catch (err) {
    if (err instanceof AdsApiError && (err.kind === "QUOTA" || err.kind === "TOKEN_REVOKED")) throw err;
    return null;
  }
}

async function pullAdGroups(cfg: AdsConfig, cid: string, start: string, end: string, names: Map<string, string> | null): Promise<MonthPayload> {
  const range = `segments.date BETWEEN '${start}' AND '${end}'`;
  const [rows, split] = await Promise.all([
    searchStream(
      cfg,
      cid,
      `SELECT segments.date, campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group.status,
              metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
       FROM ad_group WHERE ${range}`,
    ),
    trySplit(
      cfg,
      cid,
      `SELECT segments.date, ad_group.id, segments.conversion_action, metrics.conversions
       FROM ad_group WHERE ${range} AND metrics.conversions > 0`,
      names,
      (r) => `${asRec(r.segments).date}|${asRec(r.adGroup).id}`,
    ),
  ]);
  return {
    v: 1,
    conv_split: Boolean(split),
    rows: rows
      .map((row) => {
        const ag = asRec(row.adGroup);
        const c = asRec(row.campaign);
        const date = String(asRec(row.segments).date || "");
        const id = String(ag.id || "");
        return {
          date,
          campaign_id: String(c.id || ""),
          campaign_name: String(c.name || ""),
          ad_group_id: id,
          ad_group_name: String(ag.name || ""),
          status: statusCode(String(ag.status || "")),
          ...metricsOf(asRec(row.metrics)),
          ...(split ? split.get(`${date}|${id}`) || EMPTY_SPLIT : {}),
        };
      })
      .filter((r) => r.date && r.ad_group_id),
  };
}

async function pullKeywords(cfg: AdsConfig, cid: string, start: string, end: string, names: Map<string, string> | null): Promise<MonthPayload> {
  const range = `segments.date BETWEEN '${start}' AND '${end}'`;
  const [rows, split] = await Promise.all([
    searchStream(
      cfg,
      cid,
      `SELECT segments.date, campaign.id, ad_group.id, ad_group.name, ad_group_criterion.criterion_id,
              ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status,
              metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
       FROM keyword_view WHERE ${range}`,
    ),
    trySplit(
      cfg,
      cid,
      `SELECT segments.date, ad_group.id, ad_group_criterion.criterion_id, segments.conversion_action, metrics.conversions
       FROM keyword_view WHERE ${range} AND metrics.conversions > 0`,
      names,
      (r) => `${asRec(r.segments).date}|${asRec(r.adGroup).id}|${asRec(r.adGroupCriterion).criterionId}`,
    ),
  ]);
  return {
    v: 1,
    conv_split: Boolean(split),
    rows: rows
      .map((row) => {
        const crit = asRec(row.adGroupCriterion);
        const kw = asRec(crit.keyword);
        const date = String(asRec(row.segments).date || "");
        const agId = String(asRec(row.adGroup).id || "");
        const kwId = String(crit.criterionId || "");
        return {
          date,
          campaign_id: String(asRec(row.campaign).id || ""),
          ad_group_id: agId,
          ad_group_name: String(asRec(row.adGroup).name || ""),
          // criterion ids are only unique inside an ad group
          keyword_id: `${agId}~${kwId}`,
          keyword_text: String(kw.text || ""),
          match_type: String(kw.matchType || "").replace(/^KEYWORD_MATCH_TYPE_/, ""),
          status: statusCode(String(crit.status || "")),
          ...metricsOf(asRec(row.metrics)),
          ...(split ? split.get(`${date}|${agId}|${kwId}`) || EMPTY_SPLIT : {}),
        };
      })
      .filter((r) => r.date && r.keyword_id),
  };
}

async function pullSearchTerms(cfg: AdsConfig, cid: string, start: string, end: string, names: Map<string, string> | null): Promise<MonthPayload> {
  const range = `segments.date BETWEEN '${start}' AND '${end}'`;
  const [rows, split] = await Promise.all([
    searchStream(
      cfg,
      cid,
      `SELECT segments.date, campaign.id, campaign.name, ad_group.id,
              search_term_view.search_term, segments.search_term_match_type,
              metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
       FROM search_term_view WHERE ${range}`,
    ),
    trySplit(
      cfg,
      cid,
      `SELECT segments.date, ad_group.id, search_term_view.search_term, segments.conversion_action, metrics.conversions
       FROM search_term_view WHERE ${range} AND metrics.conversions > 0`,
      names,
      (r) => `${asRec(r.segments).date}|${asRec(r.adGroup).id}|${asRec(r.searchTermView).searchTerm}`,
    ),
  ]);
  return {
    v: 1,
    conv_split: Boolean(split),
    rows: rows
      .map((row) => {
        const seg = asRec(row.segments);
        const c = asRec(row.campaign);
        const date = String(seg.date || "");
        const agId = String(asRec(row.adGroup).id || "");
        const q = String(asRec(row.searchTermView).searchTerm || "");
        return {
          date,
          campaign_id: String(c.id || ""),
          campaign_name: String(c.name || ""),
          ad_group_id: agId,
          query: q,
          match_type: String(seg.searchTermMatchType || "").replace(/^SEARCH_TERM_MATCH_TYPE_/, ""),
          ...metricsOf(asRec(row.metrics)),
          ...(split ? split.get(`${date}|${agId}|${q}`) || EMPTY_SPLIT : {}),
        };
      })
      .filter((r) => r.date && r.query),
  };
}

// ── public API ──────────────────────────────────────────────────────────────

function staffError(err: unknown): string {
  if (err instanceof AdsApiError) return err.adminMessage;
  const msg = err instanceof Error ? err.message : "";
  if (/adsops_analytics_deep|does not exist|relation/i.test(msg)) {
    return "Thiếu bảng adsops_analytics_deep trên Neon (migration 0007 chưa chạy).";
  }
  console.error(`[google-ads] deep chunk failed: ${String(msg).slice(0, 300)}`);
  return "Lỗi kéo nhóm / từ khoá / search term.";
}

/**
 * Pull the newest month in [targetStart, today] whose ad group / keyword rows
 * are not yet stored (the current month is always re-pulled when it is behind
 * today). One month per call. `refreshRecent` forces the current month first.
 */
export async function pullDeepChunk(
  clientId: string,
  opts: { targetStart?: string | null; refreshRecent?: boolean } = {},
): Promise<DeepChunkResult> {
  const id = clientId.trim();
  if (!CLIENT_ID_RE.test(id)) return { ok: false, error_vi: "Khách không hợp lệ." };
  const cfg = await resolveAdsConfig();
  if (!cfg.ready) {
    return { ok: false, client_id: id, error_vi: `Chưa cấu hình Google Ads API. Thiếu: ${cfg.missing.map((m) => m.label_vi).join(" ")}` };
  }
  const customerId = customerIdFor(id);
  if (customerId.length !== 10) return { ok: false, client_id: id, error_vi: "Không suy ra Customer ID từ khách." };
  const lockKey = `${id}:deep`;
  if (!(await acquireLock(lockKey, 120))) {
    return { ok: false, client_id: id, error_vi: "Đang có một lượt kéo nhóm / từ khoá khác cho tài khoản này — đợi 1–2 phút rồi bấm lại." };
  }
  try {
    const meta = await pullMeta(cfg, customerId, id);
    const today = ymdInTz(meta.timezone);
    const floor = addDaysYmd(today, -(ANALYTICS_LOOKBACK_DAYS_MAX - 1));
    const wanted = opts.targetStart && /^\d{4}-\d{2}-\d{2}$/.test(opts.targetStart) ? opts.targetStart : addDaysYmd(today, -179);
    const targetStart = maxYmd(minYmd(wanted, today), floor);
    const stFloor = addDaysYmd(today, -(SEARCH_TERM_LOOKBACK_CAP - 1));
    const windows = monthWindows(targetStart, today);

    const [agCov, kwCov] = await Promise.all([readCoverage(id, "ad_group"), readCoverage(id, "keyword")]);
    const pending = windows.filter((w) => !covers(agCov.get(w.month), w.start, w.end) || !covers(kwCov.get(w.month), w.start, w.end));
    let next = pending[0] || null;
    if (opts.refreshRecent) next = windows[0];
    if (!next) {
      return {
        ok: true,
        client_id: id,
        pulled: null,
        target_start: targetStart,
        target_end: today,
        covered_from: targetStart,
        remaining_months: 0,
        done: true,
        counts: { ad_group: 0, keyword: 0, search_term: 0 },
        note_vi: `Nhóm quảng cáo / từ khoá đã đủ ${targetStart} → ${today}.`,
        error_vi: null,
      };
    }
    // Re-pulling a month replaces it whole: keep any earlier start already stored.
    const prevStart = agCov.get(next.month)?.covered_start;
    const start = prevStart && prevStart < next.start && prevStart >= monthStart(next.month) ? prevStart : next.start;
    const end = next.end;

    let names: Map<string, string> | null = null;
    try {
      names = await actionNames(cfg, customerId);
    } catch (err) {
      if (err instanceof AdsApiError && (err.kind === "QUOTA" || err.kind === "TOKEN_REVOKED")) throw err;
    }
    const stStart = maxYmd(start, stFloor);
    const wantSt = stStart <= end;
    const [ag, kw, st] = await Promise.all([
      pullAdGroups(cfg, customerId, start, end, names),
      pullKeywords(cfg, customerId, start, end, names),
      wantSt ? pullSearchTerms(cfg, customerId, stStart, end, names) : Promise.resolve(null),
    ]);
    await upsertMonth(id, "ad_group", next.month, start, end, ag);
    await upsertMonth(id, "keyword", next.month, start, end, kw);
    if (st) await upsertMonth(id, "search_term", next.month, stStart, end, st);

    const remaining = pending.filter((w) => w.month !== next!.month);
    // Continuous coverage from today backwards.
    let coveredFrom: string | null = null;
    for (const w of windows) {
      const ok = w.month === next.month || (covers(agCov.get(w.month), w.start, w.end) && covers(kwCov.get(w.month), w.start, w.end));
      if (!ok) break;
      coveredFrom = w.start;
    }
    const done = remaining.length === 0;
    const [y, m] = next.month.split("-");
    return {
      ok: true,
      client_id: id,
      pulled: { start, end },
      target_start: targetStart,
      target_end: today,
      covered_from: coveredFrom,
      remaining_months: remaining.length,
      done,
      counts: { ad_group: ag.rows.length, keyword: kw.rows.length, search_term: st?.rows.length ?? 0 },
      note_vi: done
        ? `Đã kéo xong nhóm quảng cáo / từ khoá ${targetStart} → ${today}. Search term: ${SEARCH_TERM_LOOKBACK_CAP} ngày gần nhất.`
        : `Đã kéo nhóm / từ khoá tháng ${m}/${y} (${start} → ${end}); còn ${remaining.length} tháng.`,
      error_vi: null,
    };
  } catch (err) {
    return { ok: false, client_id: id, error_vi: staffError(err) };
  } finally {
    await releaseLock(lockKey);
  }
}

function mergeRanges(ranges: CoveredRange[]): CoveredRange[] {
  const sorted = ranges.filter((r) => r.start <= r.end).sort((a, b) => a.start.localeCompare(b.start));
  const out: CoveredRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && addDaysYmd(last.end, 1) >= r.start) {
      if (r.end > last.end) last.end = r.end;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/** Server-side aggregation for one deep layer table. Caller checks access. */
export async function readDeepLayer(
  clientId: string,
  layer: DeepLayerId,
  opts: { start: string; end: string; campaignId?: string | null; adGroupId?: string | null; onlyWithConv?: boolean },
): Promise<DeepLayerBlock> {
  const base: DeepLayerBlock = {
    layer,
    complete: false,
    missing_label: "Chưa kéo",
    rows: [],
    pmax_note: null,
    coverage: [],
    covered_days: 0,
    total_days: dayCount(opts.start, opts.end),
    totals: null,
    row_count: 0,
    truncated: false,
    search_term_cap_days: layer === "search_term" ? SEARCH_TERM_LOOKBACK_CAP : null,
    conv_split: false,
    note_vi: null,
  };
  if (!CLIENT_ID_RE.test(clientId) || !LAYERS.includes(layer) || opts.end < opts.start) return base;
  let stored: StoredMonth[] = [];
  try {
    const sql = await getSql();
    stored = await sql.query<StoredMonth>(
      `select layer, month, to_char(covered_start, 'YYYY-MM-DD') as covered_start, to_char(covered_end, 'YYYY-MM-DD') as covered_end, rows
       from adsops_analytics_deep
       where client_id = $1 and layer = $2 and covered_end >= $3::date and covered_start <= $4::date`,
      [clientId, layer, opts.start, opts.end],
    );
  } catch {
    return { ...base, note_vi: "Chưa có kho nhóm / từ khoá (bảng chưa tạo hoặc chưa kéo)." };
  }
  const coverage = mergeRanges(
    stored.map((r) => ({ start: maxYmd(r.covered_start, opts.start), end: minYmd(r.covered_end, opts.end) })),
  );
  const covered_days = coverage.reduce((n, r) => n + dayCount(r.start, r.end), 0);
  if (!covered_days) return base;
  let convSplit = true;
  const all: DailyRow[] = [];
  for (const r of stored) {
    const payload = (typeof r.rows === "string" ? JSON.parse(r.rows) : r.rows) as MonthPayload | null;
    if (!payload?.rows) continue;
    if (!payload.conv_split) convSplit = false;
    for (const row of payload.rows) {
      if (row.date >= opts.start && row.date <= opts.end && row.date >= r.covered_start && row.date <= r.covered_end) all.push(row);
    }
  }
  let filtered = all;
  if (opts.campaignId) filtered = filtered.filter((r) => String(r.campaign_id) === opts.campaignId);
  if (opts.adGroupId && layer !== "ad_group") filtered = filtered.filter((r) => String(r.ad_group_id) === opts.adGroupId);
  const block = aggregateDeepRows(layer, filtered, { ...opts, campaignId: null, adGroupId: null });
  // Totals = exactly the rows shown (before the 500-row display cap), covered days only.
  const raw: Record<string, number> = {};
  for (const row of block.rows) {
    for (const k of TOTAL_KEYS) raw[k] = (raw[k] || 0) + Number(row.metrics[k] || 0);
  }
  const totals = block.rows.length ? derivedMetrics(raw) : null;
  const complete = covered_days === base.total_days;
  return {
    ...base,
    complete,
    missing_label: complete ? undefined : "Chưa kéo hết khoảng ngày",
    rows: block.rows.slice(0, MAX_TABLE_ROWS),
    row_count: block.rows.length,
    truncated: block.rows.length > MAX_TABLE_ROWS,
    coverage,
    covered_days,
    totals,
    conv_split: convSplit,
  };
}
