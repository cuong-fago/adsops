/**
 * Google Ads analytics warehouse (Neon `adsops_analytics_warehouse`).
 *
 * - `pullAnalyticsWarehouse`: explicit full pull (default 180 days) — admin / head_ads / optimizer.
 * - `refreshWarehouseOnView`: pull-on-view with a 15-minute cache. Pulls only the
 *   recent window (account + campaign layers) and merges it into the stored payload.
 *
 * Read-only GAQL (searchStream) only — never mutates Google Ads. Numbers come
 * only from the API; days without rows are never filled with zero.
 */
import { getSql } from "@/lib/db";
import type { AnalyticsSnap, BudgetPace, ConvGroup, DailyRow } from "./analytics.ts";
import type { Json } from "./connect.types.ts";
import {
  AdsApiError,
  digits,
  resolveAdsConfig,
  searchStream,
  type AdsConfig,
  type GaqlRow,
} from "./google-ads.server.ts";

export const ANALYTICS_LOOKBACK_DAYS_DEFAULT = 180;
export const ANALYTICS_LOOKBACK_DAYS_MAX = 365;
/** Pull-on-view cache: a stored pull younger than this is served as-is. */
export const LIVE_CACHE_MINUTES = 15;
/** Days re-pulled by the on-view refresh (covers late conversion attribution). */
const RECENT_WINDOW_DAYS = 14;
/** When an account has no stored data at all, the on-view refresh seeds this many days. */
const SEED_WINDOW_DAYS = 90;
/** Search-term layer is heavy; pull a shorter window. */
const SEARCH_TERM_LOOKBACK_CAP = 90;

const CLIENT_ID_RE = /^[a-z0-9_]+$/;

const KNOWN: Record<string, { client_id: string; display_name: string }> = {
  "6810292395": { client_id: "tkqc_6810292395", display_name: "GrowVi" },
  "2204136068": { client_id: "fago_group", display_name: "Cty TNHH Giải Pháp Thương Mại Fago Group (006)" },
};

export type PullAnalyticsWarehouseResult = {
  ok: boolean;
  client_id?: string;
  analytics?: AnalyticsSnap | null;
  lookback_days?: number;
  warehouse_start?: string | null;
  warehouse_end?: string | null;
  day_count?: number;
  pulled_at?: string | null;
  layers?: { account: number; campaign: number; ad_group: number; keyword: number; search_term: number };
  persisted_neon?: boolean;
  persisted_fs?: boolean;
  error_vi?: string | null;
  note_vi?: string | null;
};

export type RefreshState = "fresh" | "refreshed" | "not_configured" | "busy" | "error";

export type RefreshResult = {
  state: RefreshState;
  /** Staff/admin-only text. Never forward to client roles. */
  message_vi: string;
  pulled_at: string | null;
  error_kind?: string;
};

// ── helpers ─────────────────────────────────────────────────────────────────

function ymdInTz(tz: string, d = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Asia/Saigon", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Saigon", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  }
}

function addDaysYmd(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function customerIdFor(clientId: string): string {
  if (clientId === "fago_group") return "2204136068";
  const known = Object.entries(KNOWN).find(([, v]) => v.client_id === clientId);
  if (known) return known[0];
  return digits(clientId.replace(/^tkqc_/, ""));
}

function asRec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function numField(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function microsToCurrency(micros: unknown): number {
  return numField(micros) / 1_000_000;
}

type ConvBucket = "conv_call" | "conv_zalo" | "conv_facebook_chat" | "conv_form" | "conv_other";

/** Existing AdsOps mapping: conversion action name → Gọi / Zalo / Facebook chat / Form / Khác. */
export function classifyAction(name: string): ConvBucket | null {
  const n = name.toLowerCase();
  if (!name.trim()) return null;
  if (/^all conversions$/i.test(name.trim())) return null;
  if (/page\s*view|lượt xem trang|website visit/i.test(n)) return null;
  if (/gọi|goi điện|call|phone|điện thoại|dien thoai/i.test(n)) return "conv_call";
  if (/zalo/i.test(n)) return "conv_zalo";
  if (/facebook|messenger|fb\s*chat/i.test(n)) return "conv_facebook_chat";
  if (/form|đăng ký|dang ky|submit|lead form/i.test(n)) return "conv_form";
  return "conv_other";
}

const METRIC_DEFS = [
  { id: "cost", label: "Chi tiêu" },
  { id: "impressions", label: "Hiển thị" },
  { id: "clicks", label: "Click" },
  { id: "invalid_clicks", label: "Click không hợp lệ" },
  { id: "invalid_click_rate", label: "Tỷ lệ click không hợp lệ" },
  { id: "cpc", label: "CPC" },
  { id: "conversions", label: "Chuyển đổi" },
  { id: "conv_other", label: "Chuyển đổi Google" },
  { id: "cost_per_conversion", label: "Chi phí/chuyển đổi" },
  { id: "ctr", label: "CTR" },
  { id: "cr", label: "CR" },
];

function emptyConv(): Record<ConvBucket, number> {
  return { conv_call: 0, conv_zalo: 0, conv_facebook_chat: 0, conv_form: 0, conv_other: 0 };
}

function channelType(raw: string): string {
  const t = String(raw || "").toUpperCase();
  if (t.includes("PERFORMANCE_MAX")) return "PERFORMANCE_MAX";
  if (t.includes("SEARCH")) return "SEARCH";
  if (t.includes("DISPLAY")) return "DISPLAY";
  if (t.includes("VIDEO")) return "VIDEO";
  if (t.includes("SHOPPING")) return "SHOPPING";
  if (t.includes("DEMAND_GEN")) return "DEMAND_GEN";
  return t || "UNKNOWN";
}

function statusCode(raw: string): string {
  const s = String(raw || "").toUpperCase();
  if (s.includes("ENABLED")) return "ENABLED";
  if (s.includes("PAUSED")) return "PAUSED";
  if (s.includes("REMOVED")) return "REMOVED";
  return s || "UNKNOWN";
}

function saigonYmd(): string {
  return ymdInTz("Asia/Saigon");
}

function stubBudgetPace(clientId: string, timezone: string, currency: string): BudgetPace {
  return {
    module: "budget_pace",
    client_id: clientId,
    separate_from_guard: true,
    blocks_propose: true,
    status: "missing",
    missing_label: "Chưa kéo ngân sách 1 ngày",
    firing: false,
    today: saigonYmd(),
    timezone,
    currency,
    hours_elapsed: 0,
    tickets: [],
    ok: [],
    email: {
      channel: "email",
      to: [],
      subject: "",
      body: "",
      status: "skipped",
      not_merged_with_guard: true,
      sent: false,
      note: "Budget pace tách Guard — chưa kéo trong phiên kho phân tích.",
    },
    formula: "remaining / hours_remaining",
  };
}

// ── storage ─────────────────────────────────────────────────────────────────

type StoredRow = { payload: AnalyticsSnap; pulled_at: string | null };

async function readStored(clientId: string): Promise<StoredRow | null> {
  try {
    const sql = await getSql();
    const rows = await sql.query<{ payload: unknown; pulled_at: string | null }>(
      `select payload, to_char(pulled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as pulled_at
       from adsops_analytics_warehouse where client_id = $1 limit 1`,
      [clientId],
    );
    const row = rows[0];
    if (!row?.payload) return null;
    const payload = (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) as AnalyticsSnap;
    return { payload, pulled_at: row.pulled_at };
  } catch {
    return null;
  }
}

async function persistNeon(snap: AnalyticsSnap, lookback: number | null): Promise<void> {
  try {
    const sql = await getSql();
    await sql.query(
      `insert into adsops_analytics_warehouse
         (client_id, payload, pulled_at, warehouse_start, warehouse_end, lookback_days)
       values ($1, $2::jsonb, now(), $3::date, $4::date, $5)
       on conflict (client_id) do update set
         payload = excluded.payload,
         pulled_at = excluded.pulled_at,
         warehouse_start = excluded.warehouse_start,
         warehouse_end = excluded.warehouse_end,
         lookback_days = coalesce(excluded.lookback_days, adsops_analytics_warehouse.lookback_days)`,
      [snap.client_id, JSON.stringify(snap), snap.warehouse_start, snap.warehouse_end, lookback],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[google-ads] warehouse persist failed client=${snap.client_id}: ${msg.slice(0, 300)}`);
    if (/adsops_analytics_warehouse|does not exist|relation/i.test(msg)) {
      throw new Error("Thiếu bảng adsops_analytics_warehouse trên Neon (migration chưa chạy).");
    }
    throw new Error("Không lưu được kho phân tích vào Neon.");
  }
}

export async function readAnalyticsWarehouseFromNeon(clientId: string): Promise<Json | null> {
  if (!CLIENT_ID_RE.test(clientId)) return null;
  const row = await readStored(clientId);
  return (row?.payload as unknown as Json) ?? null;
}

/** Committed snapshot (server-data/adsops/analytics/<id>.json), used as a merge base. */
async function readSnapshotFile(clientId: string): Promise<AnalyticsSnap | null> {
  try {
    const { resolveDataDir } = await import("./access.server.ts");
    const dir = resolveDataDir();
    if (!dir) return null;
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const raw = await readFile(join(dir, "analytics", `${clientId}.json`), "utf8");
    const snap = JSON.parse(raw) as AnalyticsSnap;
    return snap && snap.daily ? snap : null;
  } catch {
    return null;
  }
}

async function acquireLock(clientId: string, seconds: number): Promise<boolean> {
  try {
    const sql = await getSql();
    const rows = await sql.query<{ client_id: string }>(
      `insert into adsops_ads_refresh_lock (client_id, locked_until)
       values ($1, now() + ($2 || ' seconds')::interval)
       on conflict (client_id) do update set locked_until = excluded.locked_until
       where adsops_ads_refresh_lock.locked_until < now()
       returning client_id`,
      [clientId, String(seconds)],
    );
    return rows.length > 0;
  } catch {
    // Lock table missing (migration pending): allow the refresh rather than never refreshing.
    return true;
  }
}

async function releaseLock(clientId: string): Promise<void> {
  try {
    const sql = await getSql();
    await sql.query(`delete from adsops_ads_refresh_lock where client_id = $1`, [clientId]);
  } catch {
    /* ignore */
  }
}

function failureBackoff(): Map<string, { until: number; message: string }> {
  const g = globalThis as typeof globalThis & { __adsopsAdsBackoff__?: Map<string, { until: number; message: string }> };
  g.__adsopsAdsBackoff__ ??= new Map();
  return g.__adsopsAdsBackoff__;
}

// ── pulls ───────────────────────────────────────────────────────────────────

type Meta = { displayName: string; currency: string; timezone: string };

async function pullMeta(cfg: AdsConfig, customerId: string, clientId: string): Promise<Meta> {
  const rows = await searchStream(
    cfg,
    customerId,
    `SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1`,
  );
  const c = asRec(rows[0]?.customer);
  return {
    displayName: String(c.descriptiveName || "") || KNOWN[customerId]?.display_name || clientId,
    currency: String(c.currencyCode || "VND"),
    timezone: String(c.timeZone || "Asia/Saigon"),
  };
}

type Core = {
  actionNames: Map<string, string>;
  actionsByBucket: Record<ConvBucket, string[]>;
  campaigns: AnalyticsSnap["campaigns"];
  account: DailyRow[];
  campaign: DailyRow[];
};

function convSplit(rows: GaqlRow[], names: Map<string, string>, keyOf: (r: GaqlRow) => string | null) {
  const out = new Map<string, Record<ConvBucket, number>>();
  for (const row of rows) {
    const seg = asRec(row.segments);
    const resource = String(seg.conversionAction || "");
    const name = names.get(resource) || String(seg.conversionActionName || "");
    const bucket = classifyAction(name);
    const key = keyOf(row);
    if (!key || !bucket) continue;
    const slot = out.get(key) || emptyConv();
    slot[bucket] += numField(asRec(row.metrics).conversions);
    out.set(key, slot);
  }
  return out;
}

/** Account + campaign daily layers, campaign list, conversion split. Read-only. */
async function pullCore(cfg: AdsConfig, customerId: string, start: string, end: string): Promise<Core> {
  const range = `segments.date BETWEEN '${start}' AND '${end}'`;
  const [actionRows, campRows, accRows, accConvRows, campDailyRows, campConvRows] = await Promise.all([
    searchStream(cfg, customerId, `SELECT conversion_action.id, conversion_action.name, conversion_action.status FROM conversion_action`),
    searchStream(
      cfg,
      customerId,
      `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type FROM campaign WHERE campaign.status != 'REMOVED'`,
    ),
    searchStream(
      cfg,
      customerId,
      `SELECT segments.date, metrics.impressions, metrics.clicks, metrics.invalid_clicks, metrics.cost_micros, metrics.conversions
       FROM customer WHERE ${range}`,
    ),
    searchStream(
      cfg,
      customerId,
      `SELECT segments.date, segments.conversion_action, metrics.conversions FROM customer WHERE ${range} AND metrics.conversions > 0`,
    ),
    searchStream(
      cfg,
      customerId,
      `SELECT segments.date, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
              metrics.impressions, metrics.clicks, metrics.invalid_clicks, metrics.cost_micros, metrics.conversions
       FROM campaign WHERE ${range}`,
    ),
    searchStream(
      cfg,
      customerId,
      `SELECT segments.date, campaign.id, segments.conversion_action, metrics.conversions
       FROM campaign WHERE ${range} AND metrics.conversions > 0`,
    ),
  ]);

  const actionNames = new Map<string, string>();
  const actionsByBucket: Record<ConvBucket, string[]> = { conv_call: [], conv_zalo: [], conv_facebook_chat: [], conv_form: [], conv_other: [] };
  for (const row of actionRows) {
    const ca = asRec(row.conversionAction);
    const name = String(ca.name || "");
    const id = String(ca.id || "");
    if (id) actionNames.set(`customers/${customerId}/conversionActions/${id}`, name);
    const bucket = classifyAction(name);
    if (bucket && String(ca.status || "") !== "REMOVED" && !actionsByBucket[bucket].includes(name)) actionsByBucket[bucket].push(name);
  }

  const accConv = convSplit(accConvRows, actionNames, (r) => String(asRec(r.segments).date || "") || null);
  const account: DailyRow[] = accRows
    .map((row) => {
      const date = String(asRec(row.segments).date || "");
      const m = asRec(row.metrics);
      return {
        date,
        impressions: numField(m.impressions),
        clicks: numField(m.clicks),
        invalid_clicks: numField(m.invalidClicks),
        cost: microsToCurrency(m.costMicros),
        conversions: numField(m.conversions),
        ...(accConv.get(date) || emptyConv()),
      };
    })
    .filter((r) => r.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  const campConv = convSplit(campConvRows, actionNames, (r) => {
    const date = String(asRec(r.segments).date || "");
    const cid = String(asRec(r.campaign).id || "");
    return date && cid ? `${date}|${cid}` : null;
  });
  const catalog = new Map<string, AnalyticsSnap["campaigns"][number]>();
  for (const row of campRows) {
    const c = asRec(row.campaign);
    const id = String(c.id || "");
    if (!id) continue;
    const type = channelType(String(c.advertisingChannelType || ""));
    catalog.set(id, { id, name: String(c.name || ""), type, status: statusCode(String(c.status || "")), pmax: type === "PERFORMANCE_MAX" });
  }
  const campaign: DailyRow[] = campDailyRows
    .map((row) => {
      const date = String(asRec(row.segments).date || "");
      const c = asRec(row.campaign);
      const m = asRec(row.metrics);
      const cid = String(c.id || "");
      const type = channelType(String(c.advertisingChannelType || ""));
      const status = statusCode(String(c.status || ""));
      if (cid && !catalog.has(cid)) {
        // Removed campaigns that still have spend in the window keep their real status.
        catalog.set(cid, { id: cid, name: String(c.name || ""), type, status, pmax: type === "PERFORMANCE_MAX" });
      }
      return {
        date,
        campaign_id: cid,
        campaign_name: String(c.name || ""),
        campaign_type: type,
        status,
        impressions: numField(m.impressions),
        clicks: numField(m.clicks),
        invalid_clicks: numField(m.invalidClicks),
        cost: microsToCurrency(m.costMicros),
        conversions: numField(m.conversions),
        ...(campConv.get(`${date}|${cid}`) || emptyConv()),
      };
    })
    .filter((r) => r.date && r.campaign_id)
    .sort((a, b) => a.date.localeCompare(b.date));

  return { actionNames, actionsByBucket, campaigns: [...catalog.values()], account, campaign };
}

type Deep = {
  adGroups: NonNullable<AnalyticsSnap["ad_groups"]>;
  ad_group: DailyRow[];
  keyword: DailyRow[];
  search_term: DailyRow[];
  notes: string[];
};

/** Ad group / keyword / search term layers (best effort). Read-only. */
async function pullDeep(cfg: AdsConfig, customerId: string, start: string, end: string, stStart: string): Promise<Deep> {
  const notes: string[] = [];
  const safe = async (label: string, fn: () => Promise<GaqlRow[]>): Promise<GaqlRow[]> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AdsApiError && (err.kind === "QUOTA" || err.kind === "TOKEN_REVOKED")) throw err;
      notes.push(`Chưa kéo được lớp ${label}.`);
      return [];
    }
  };
  const [agMeta, agDaily, kwDaily, stDaily] = await Promise.all([
    safe("nhóm quảng cáo", () =>
      searchStream(cfg, customerId, `SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id FROM ad_group WHERE ad_group.status != 'REMOVED'`),
    ),
    safe("nhóm quảng cáo", () =>
      searchStream(
        cfg,
        customerId,
        `SELECT segments.date, campaign.id, ad_group.id, ad_group.name, ad_group.status,
                metrics.impressions, metrics.clicks, metrics.invalid_clicks, metrics.cost_micros, metrics.conversions
         FROM ad_group WHERE segments.date BETWEEN '${start}' AND '${end}'`,
      ),
    ),
    safe("từ khoá", () =>
      searchStream(
        cfg,
        customerId,
        `SELECT segments.date, campaign.id, ad_group.id, ad_group_criterion.criterion_id,
                ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status,
                metrics.impressions, metrics.clicks, metrics.invalid_clicks, metrics.cost_micros, metrics.conversions
         FROM keyword_view WHERE segments.date BETWEEN '${start}' AND '${end}'`,
      ),
    ),
    safe("search term", () =>
      searchStream(
        cfg,
        customerId,
        `SELECT segments.date, campaign.id, campaign.name, ad_group.id,
                search_term_view.search_term, segments.search_term_match_type,
                metrics.impressions, metrics.clicks, metrics.invalid_clicks, metrics.cost_micros, metrics.conversions
         FROM search_term_view WHERE segments.date BETWEEN '${stStart}' AND '${end}'`,
      ),
    ),
  ]);
  const metricsOf = (m: Record<string, unknown>) => ({
    impressions: numField(m.impressions),
    clicks: numField(m.clicks),
    invalid_clicks: numField(m.invalidClicks),
    cost: microsToCurrency(m.costMicros),
    conversions: numField(m.conversions),
    // No per-type split on these layers (left missing, never zero-filled).
  });
  const adGroups = agMeta
    .map((row) => {
      const ag = asRec(row.adGroup);
      return { id: String(ag.id || ""), name: String(ag.name || ""), campaign_id: String(asRec(row.campaign).id || ""), status: statusCode(String(ag.status || "")) };
    })
    .filter((g) => g.id);
  const ad_group = agDaily.map((row) => {
    const ag = asRec(row.adGroup);
    return {
      date: String(asRec(row.segments).date || ""),
      campaign_id: String(asRec(row.campaign).id || ""),
      ad_group_id: String(ag.id || ""),
      ad_group_name: String(ag.name || ""),
      status: statusCode(String(ag.status || "")),
      ...metricsOf(asRec(row.metrics)),
    };
  });
  const keyword = kwDaily.map((row) => {
    const crit = asRec(row.adGroupCriterion);
    const kw = asRec(crit.keyword);
    return {
      date: String(asRec(row.segments).date || ""),
      campaign_id: String(asRec(row.campaign).id || ""),
      ad_group_id: String(asRec(row.adGroup).id || ""),
      keyword_id: String(crit.criterionId || ""),
      keyword_text: String(kw.text || ""),
      match_type: String(kw.matchType || "").replace(/^KEYWORD_MATCH_TYPE_/, ""),
      status: statusCode(String(crit.status || "")),
      ...metricsOf(asRec(row.metrics)),
    };
  });
  const search_term = stDaily.map((row) => {
    const seg = asRec(row.segments);
    const c = asRec(row.campaign);
    return {
      date: String(seg.date || ""),
      campaign_id: String(c.id || ""),
      campaign_name: String(c.name || ""),
      ad_group_id: String(asRec(row.adGroup).id || ""),
      query: String(asRec(row.searchTermView).searchTerm || ""),
      match_type: String(seg.searchTermMatchType || "").replace(/^SEARCH_TERM_MATCH_TYPE_/, ""),
      ...metricsOf(asRec(row.metrics)),
    };
  });
  return { adGroups, ad_group, keyword, search_term, notes };
}

// ── merge / build ───────────────────────────────────────────────────────────

/** Replace rows inside [start, end] with fresh ones; keep older history. */
function mergeLayer(old: DailyRow[] | undefined, fresh: DailyRow[], start: string, end: string): DailyRow[] {
  const kept = (old || []).filter((r) => r && typeof r.date === "string" && (r.date < start || r.date > end));
  return [...kept, ...fresh].sort((a, b) => a.date.localeCompare(b.date));
}

function mergeGroups(base: AnalyticsSnap | null, byBucket: Record<ConvBucket, string[]>): ConvGroup[] {
  const defs: Array<{ id: string; label: string; metric: ConvBucket }> = [
    { id: "call", label: "Gọi", metric: "conv_call" },
    { id: "zalo", label: "Zalo", metric: "conv_zalo" },
    { id: "facebook_chat", label: "Facebook chat", metric: "conv_facebook_chat" },
    { id: "form", label: "Form", metric: "conv_form" },
    { id: "other", label: "Khác", metric: "conv_other" },
  ];
  const prev = new Map((base?.conversion_groups?.groups || []).map((g) => [g.metric, g.actions || []]));
  return defs.map((d) => ({ ...d, actions: [...new Set([...(byBucket[d.metric] || []), ...(prev.get(d.metric) || [])])] }));
}

function minDate(...vals: Array<string | null | undefined>): string | null {
  const v = vals.filter((x): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
  return v[0] || null;
}

function buildSnap(input: {
  clientId: string;
  customerId: string;
  meta: Meta;
  base: AnalyticsSnap | null;
  core: Core;
  deep: Deep | null;
  start: string;
  end: string;
  today: string;
  lookback: number | null;
  pulledAt: string;
  notes: string[];
}): AnalyticsSnap {
  const { base, core, deep, start, end } = input;
  const daily = {
    account: mergeLayer(base?.daily?.account, core.account, start, end),
    campaign: mergeLayer(base?.daily?.campaign, core.campaign, start, end),
    ad_group: deep ? mergeLayer(base?.daily?.ad_group, deep.ad_group, start, end) : base?.daily?.ad_group || [],
    keyword: deep ? mergeLayer(base?.daily?.keyword, deep.keyword, start, end) : base?.daily?.keyword || [],
    search_term: deep ? mergeLayer(base?.daily?.search_term, deep.search_term, start, end) : base?.daily?.search_term || [],
  };
  const campaignMap = new Map((base?.campaigns || []).map((c) => [String(c.id), c]));
  for (const c of core.campaigns) campaignMap.set(c.id, c);
  const campaigns = [...campaignMap.values()];
  const hasPmax = campaigns.some((c) => c.pmax);
  const lastDay = daily.account.length ? daily.account[daily.account.length - 1].date : end;
  const warehouseStart = minDate(base?.warehouse_start, daily.account[0]?.date, start) || start;
  const lookback = input.lookback ?? base?.analytics_lookback_days ?? null;
  const includesToday = end >= input.today;
  const snap: AnalyticsSnap = {
    ...(base || ({} as AnalyticsSnap)),
    client_id: input.clientId,
    display_name: input.meta.displayName,
    customer_id: input.customerId,
    timezone: input.meta.timezone,
    currency: input.meta.currency,
    adapter: "live",
    data_through: lastDay,
    warehouse_start: warehouseStart,
    warehouse_end: lastDay,
    pmax_note: hasPmax ? "PMax không có search term / keyword chuẩn" : "không có search term / keyword chuẩn",
    metrics: base?.metrics?.length ? base.metrics : METRIC_DEFS,
    conversion_groups: {
      groups: mergeGroups(base, core.actionsByBucket),
      skipped: [
        { action: "All conversions", reason: "không lên màn Phân tích" },
        { action: "page view / secondary", reason: "không lên màn Phân tích" },
      ],
    },
    campaigns,
    ad_groups: deep ? deep.adGroups : base?.ad_groups || [],
    daily,
    week_choices: base?.week_choices?.length ? base.week_choices : [3, 5, 7],
    month_choices: base?.month_choices?.length ? base.month_choices : [1, 2, 3, 4, 5, 6, 7, 8, 9],
    rules: {
      ...(base?.rules || {}),
      primary_conversions_only: true,
      missing_label: "Thiếu dữ liệu",
      never_fill_missing_with_zero: true,
      sort: "cost_desc",
      week: "monday_sunday",
      source_note: `Google Ads API (đọc, không apply). Lần kéo gần nhất: ${start} → ${end}${includesToday ? " (hôm nay tính đến giờ kéo)" : ""}.${
        input.notes.length ? ` ${input.notes.join(" ")}` : ""
      }`,
      budget_pace_separate_from_guard: true,
    },
    budget_pace: base?.budget_pace || stubBudgetPace(input.clientId, input.meta.timezone, input.meta.currency),
    day_count: daily.account.length,
    pulled_at: input.pulledAt,
  };
  if (lookback != null) {
    snap.analytics_lookback_days = lookback;
    snap.lookback_days = lookback;
  }
  return snap;
}

function adminError(err: unknown, fallback: string): { message: string; kind: string } {
  if (err instanceof AdsApiError) return { message: err.adminMessage, kind: err.kind };
  const msg = err instanceof Error ? err.message : "";
  console.error(`[google-ads] ${fallback}: ${String(msg).slice(0, 300)}`);
  return { message: /Neon|bảng|migration/i.test(msg) ? msg : fallback, kind: "UNKNOWN" };
}

// ── public API ──────────────────────────────────────────────────────────────

/** "Kéo kho phân tích (N ngày)": full read-only pull, persisted to Neon. */
export async function pullAnalyticsWarehouse(
  clientId: string,
  lookbackDays = ANALYTICS_LOOKBACK_DAYS_DEFAULT,
): Promise<PullAnalyticsWarehouseResult> {
  const id = clientId.trim();
  if (!CLIENT_ID_RE.test(id)) return { ok: false, error_vi: "Khách không hợp lệ." };
  const lookback = Math.min(ANALYTICS_LOOKBACK_DAYS_MAX, Math.max(1, Math.floor(Number(lookbackDays) || ANALYTICS_LOOKBACK_DAYS_DEFAULT)));
  const cfg = await resolveAdsConfig();
  if (!cfg.ready) {
    return { ok: false, client_id: id, error_vi: `Chưa cấu hình Google Ads API. Thiếu: ${cfg.missing.map((m) => m.label_vi).join(" ")}` };
  }
  const customerId = customerIdFor(id);
  if (customerId.length !== 10) return { ok: false, client_id: id, error_vi: "Không suy ra Customer ID từ khách." };
  if (!(await acquireLock(id, 300))) {
    return { ok: false, client_id: id, error_vi: "Đang có một lượt kéo khác cho tài khoản này — thử lại sau ít phút." };
  }
  try {
    const meta = await pullMeta(cfg, customerId, id);
    const today = ymdInTz(meta.timezone);
    const end = today;
    const start = addDaysYmd(today, -lookback);
    const stStart = addDaysYmd(today, -Math.min(lookback, SEARCH_TERM_LOOKBACK_CAP));
    const [core, deep, stored, file] = await Promise.all([
      pullCore(cfg, customerId, start, end),
      pullDeep(cfg, customerId, start, end, stStart),
      readStored(id),
      readSnapshotFile(id),
    ]);
    const base = stored?.payload || file;
    const notes = [...deep.notes];
    if (stStart !== start) notes.push(`Search term chỉ kéo ${SEARCH_TERM_LOOKBACK_CAP} ngày gần nhất.`);
    const pulledAt = new Date().toISOString();
    const snap = buildSnap({ clientId: id, customerId, meta, base, core, deep, start, end, today, lookback, pulledAt, notes });
    await persistNeon(snap, lookback);
    const firstLive = core.account[0]?.date || null;
    const lastLive = core.account.length ? core.account[core.account.length - 1].date : null;
    return {
      ok: true,
      client_id: id,
      analytics: snap,
      lookback_days: lookback,
      warehouse_start: snap.warehouse_start,
      warehouse_end: snap.warehouse_end,
      day_count: core.account.length,
      pulled_at: pulledAt,
      layers: {
        account: core.account.length,
        campaign: core.campaign.length,
        ad_group: deep.ad_group.length,
        keyword: deep.keyword.length,
        search_term: deep.search_term.length,
      },
      persisted_neon: true,
      persisted_fs: false,
      note_vi: core.account.length
        ? `Đã kéo ${start} → ${end}: Google Ads trả ${core.account.length} ngày có số (${firstLive} → ${lastLive}), ${core.campaign.length} dòng chiến dịch. ${notes.join(" ")} Đã lưu Neon. Không apply.`
        : `Google Ads không trả ngày nào có số trong ${start} → ${end} (tài khoản không chạy?). Không đoán số.`,
      error_vi: null,
    };
  } catch (err) {
    const e = adminError(err, "Lỗi kéo kho phân tích.");
    return { ok: false, client_id: id, error_vi: e.message };
  } finally {
    await releaseLock(id);
  }
}

/**
 * Pull-on-view: if the stored pull is older than 15 minutes, re-pull the recent
 * window (account + campaign layers, today included) and merge it. Returns quickly
 * (`busy`) if another request holds the refresh or the pull exceeds `timeoutMs`.
 * Caller must already have checked the viewer's grant on `clientId`.
 */
export async function refreshWarehouseOnView(
  clientId: string,
  opts: { force?: boolean; timeoutMs?: number } = {},
): Promise<RefreshResult> {
  const id = clientId.trim();
  if (!CLIENT_ID_RE.test(id)) return { state: "error", message_vi: "Khách không hợp lệ.", pulled_at: null };
  const cfg = await resolveAdsConfig();
  if (!cfg.ready) {
    return {
      state: "not_configured",
      message_vi: `Google Ads API chưa cấu hình — đang hiện số đã lưu. Thiếu: ${cfg.missing.map((m) => m.label_vi).join(" ")}`,
      pulled_at: null,
    };
  }
  const stored = await readStored(id);
  const lastPull = stored?.pulled_at && stored.payload?.adapter === "live" && stored.payload?.pulled_at ? stored.pulled_at : null;
  if (!opts.force && lastPull && Date.now() - Date.parse(lastPull) < LIVE_CACHE_MINUTES * 60_000) {
    return { state: "fresh", message_vi: "", pulled_at: lastPull };
  }
  const customerId = customerIdFor(id);
  if (customerId.length !== 10) return { state: "error", message_vi: "Không suy ra Customer ID từ khách.", pulled_at: lastPull };
  const backoff = failureBackoff().get(id);
  if (!opts.force && backoff && backoff.until > Date.now()) {
    return { state: "error", message_vi: `${backoff.message} (Đang hiện số đã lưu; tự thử lại sau 2 phút.)`, pulled_at: lastPull };
  }
  if (!(await acquireLock(id, 120))) {
    return { state: "busy", message_vi: "Đang cập nhật số Google Ads ở một lượt xem khác.", pulled_at: lastPull };
  }
  const work = (async (): Promise<RefreshResult> => {
    let failed = "";
    try {
      const meta = await pullMeta(cfg, customerId, id);
      const today = ymdInTz(meta.timezone);
      const base = stored?.payload || (await readSnapshotFile(id));
      const days = base?.daily?.account?.length ? RECENT_WINDOW_DAYS : SEED_WINDOW_DAYS;
      const start = addDaysYmd(today, -(days - 1));
      const core = await pullCore(cfg, customerId, start, today);
      const pulledAt = new Date().toISOString();
      const snap = buildSnap({
        clientId: id,
        customerId,
        meta,
        base,
        core,
        deep: null,
        start,
        end: today,
        today,
        lookback: null,
        pulledAt,
        notes: base?.daily?.keyword?.length ? ["Lớp nhóm QC / từ khoá / search term cập nhật theo lần \"Kéo kho\" gần nhất."] : [],
      });
      await persistNeon(snap, null);
      return { state: "refreshed", message_vi: "", pulled_at: pulledAt };
    } catch (err) {
      const e = adminError(err, "Không cập nhật được số Google Ads.");
      failed = e.message;
      return { state: "error", message_vi: e.message, pulled_at: lastPull, error_kind: e.kind };
    } finally {
      // Back-off (this instance): after a failure, page views wait 2 minutes before retrying.
      if (failed) failureBackoff().set(id, { until: Date.now() + 120_000, message: failed });
      else failureBackoff().delete(id);
      await releaseLock(id);
    }
  })();
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const timeout = new Promise<RefreshResult>((resolve) =>
    setTimeout(() => resolve({ state: "busy", message_vi: "Google Ads phản hồi chậm — đang hiện số đã lưu, lượt sau sẽ có số mới.", pulled_at: lastPull }), timeoutMs),
  );
  return Promise.race([work, timeout]);
}
