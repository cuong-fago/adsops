/**
 * Build the internal "Bìa 5 KPI" report + Google Ads compare windows from the
 * live analytics warehouse. Pure (no I/O). Only complete days (before today in
 * the account time zone) are used, matching Google Ads UI date ranges. Days with
 * no warehouse row are counted as missing (days_with_data), never as zero data.
 */
import type { AnalyticsSnap, DailyRow } from "./analytics.ts";
import type { Json } from "./connect.types.ts";

type Win = {
  days: number;
  days_with_data: number;
  start: string;
  end: string;
  cost: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  cpc: number | null;
  ctr: number | null;
  cpa_google: number | null;
};

const KPIS = [
  { id: "cost", label: "Chi tiêu" },
  { id: "impressions", label: "Hiển thị" },
  { id: "clicks", label: "Lượt nhấp" },
  { id: "conversions", label: "Chuyển đổi" },
  { id: "cpc", label: "CPC" },
];

function ymdInTz(tz: string, d = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Asia/Saigon", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Saigon", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  }
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round(v: number | null, digits = 0): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function windowOf(rows: DailyRow[], end: string, days: number): Win {
  const start = addDays(end, -(days - 1));
  const inRange = rows.filter((r) => r.date >= start && r.date <= end);
  if (!inRange.length) {
    return { days, days_with_data: 0, start, end, cost: null, impressions: null, clicks: null, conversions: null, cpc: null, ctr: null, cpa_google: null };
  }
  const cost = inRange.reduce((s, r) => s + n(r.cost), 0);
  const impressions = inRange.reduce((s, r) => s + n(r.impressions), 0);
  const clicks = inRange.reduce((s, r) => s + n(r.clicks), 0);
  const conversions = inRange.reduce((s, r) => s + n(r.conversions), 0);
  return {
    days,
    days_with_data: inRange.length,
    start,
    end,
    cost: round(cost),
    impressions,
    clicks,
    conversions: round(conversions, 2),
    cpc: clicks > 0 ? round(cost / clicks) : null,
    ctr: impressions > 0 ? clicks / impressions : null,
    cpa_google: conversions > 0 ? round(cost / conversions) : null,
  };
}

function delta(cur: Win, prev: Win): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  // Only compare fully covered windows; a gap is never treated as zero.
  const full = cur.days_with_data === cur.days && prev.days_with_data === prev.days;
  for (const k of ["cost", "impressions", "clicks", "conversions", "cpc"] as const) {
    const a = cur[k];
    const b = prev[k];
    out[k] = full && a != null && b != null && b !== 0 ? (a - b) / b : null;
  }
  return out;
}

function money(v: number | null, currency: string): string {
  if (v == null) return "—";
  return `${Math.round(v).toLocaleString("vi-VN")} ${currency === "VND" ? "₫" : currency}`;
}

function pct(v: number | null): string {
  if (v == null) return "—";
  const s = (v * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 });
  return `${v > 0 ? "+" : ""}${s}%`;
}

function dm(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function toJson(w: Win, prev?: Win): Json {
  const base: Record<string, Json> = {
    days: w.days,
    days_with_data: w.days_with_data,
    cost: w.cost,
    impressions: w.impressions,
    clicks: w.clicks,
    conversions: w.conversions,
    cpc: w.cpc,
    ctr: w.ctr,
    cpa_google: w.cpa_google,
  };
  if (prev) {
    base.previous = toJson(prev);
    base.delta = delta(w, prev) as Json;
  }
  return base;
}

function narrative(w: Win, prev: Win, label: string, currency: string): string[] {
  if (!w.days_with_data) return [`${label}: Google Ads chưa có số cho khoảng này (không tính là 0).`];
  const lines = [
    `${label}: chi ${money(w.cost, currency)}, ${w.impressions ?? "—"} hiển thị, ${w.clicks ?? "—"} lượt nhấp, ${w.conversions ?? "—"} chuyển đổi Google Ads ghi nhận.`,
  ];
  const d = delta(w, prev);
  if (d.cost != null || d.clicks != null || d.conversions != null) {
    lines.push(`So với kỳ trước: chi tiêu ${pct(d.cost)}, lượt nhấp ${pct(d.clicks)}, chuyển đổi ${pct(d.conversions)}.`);
  }
  if (w.cpa_google != null) lines.push(`Chi phí / chuyển đổi Google ${money(w.cpa_google, currency)} — không phải Qualified Lead.`);
  if (w.days_with_data < w.days) lines.push(`${w.days - w.days_with_data} ngày trong khoảng chưa có số (để trống, không tính 0).`);
  return lines;
}

/** Returns null when the warehouse has no complete day to report on. */
export function reportFromWarehouse(snap: AnalyticsSnap): { report: Json; compare: Json } | null {
  const tz = snap.timezone || "Asia/Saigon";
  const currency = snap.currency || "VND";
  const today = ymdInTz(tz);
  const end = addDays(today, -1);
  const rows = (snap.daily?.account || []).filter((r) => r.date < today);
  if (!rows.length) return null;

  const w1 = windowOf(rows, end, 1);
  const p1 = windowOf(rows, addDays(end, -1), 1);
  const w7 = windowOf(rows, end, 7);
  const p7 = windowOf(rows, addDays(end, -7), 7);
  const w14 = windowOf(rows, end, 14);
  const p14 = windowOf(rows, addDays(end, -14), 14);
  const w30 = windowOf(rows, end, 30);
  const p30 = windowOf(rows, addDays(end, -30), 30);

  const start7 = w7.start;
  const campAgg = new Map<string, { id: string; name: string; status: string; cost: number; clicks: number; impressions: number; conversions: number }>();
  const status = new Map((snap.campaigns || []).map((c) => [String(c.id), c.status]));
  for (const r of snap.daily?.campaign || []) {
    if (r.date < start7 || r.date > end || !r.campaign_id) continue;
    const a = campAgg.get(r.campaign_id) || {
      id: r.campaign_id,
      name: String(r.campaign_name || r.campaign_id),
      status: status.get(r.campaign_id) || String(r.status || ""),
      cost: 0,
      clicks: 0,
      impressions: 0,
      conversions: 0,
    };
    a.cost += n(r.cost);
    a.clicks += n(r.clicks);
    a.impressions += n(r.impressions);
    a.conversions += n(r.conversions);
    campAgg.set(r.campaign_id, a);
  }
  const campaigns = [...campAgg.values()].filter((c) => c.cost > 0 || c.clicks > 0).sort((a, b) => b.cost - a.cost) as unknown as Json;

  const windows: Record<string, Json> = { "1": toJson(w1, p1), "7": toJson(w7, p7), "14": toJson(w14, p14), "30": toJson(w30, p30) };
  const window_ranges: Record<string, Json> = {
    "1": { start: w1.start, end },
    "7": { start: w7.start, end },
    "14": { start: w14.start, end },
    "30": { start: w30.start, end },
  };
  const compare: Json = {
    module: "kpi_compare",
    source: "google_ads_api_warehouse",
    client_id: snap.client_id,
    display_name: snap.display_name,
    customer_id: snap.customer_id,
    timezone: tz,
    currency,
    adapter: "live",
    data_through: end,
    pulled_at: snap.pulled_at || null,
    pulled_kpis: true,
    never_apply_google_ads: true,
    kpis: KPIS,
    compare_howto: [
      `Mở Google Ads, chọn đúng tài khoản ${snap.customer_id || ""}.`,
      "Chọn cùng khoảng ngày (không gồm hôm nay), múi giờ tài khoản.",
      "So cột Chi phí, Lượt hiển thị, Lượt nhấp, Chuyển đổi (không phải Tất cả chuyển đổi), CPC trung bình.",
    ],
    windows,
    window_ranges,
  };
  const report: Json = {
    module: "client_report",
    source: "google_ads_api_warehouse",
    client_id: snap.client_id,
    display_name: snap.display_name,
    customer_id: snap.customer_id,
    timezone: tz,
    currency,
    adapter: "live",
    data_through: end,
    pulled_at: snap.pulled_at || null,
    pulled_kpis: true,
    propose_only: true,
    kpis: KPIS,
    banner: "Báo cáo 5 KPI từ Google Ads API: Chi tiêu, Hiển thị, Lượt nhấp, Chuyển đổi, CPC.",
    conversion_note: "Chuyển đổi = cột Conversions của Google Ads (gọi, Zalo, form… Google Ads ghi nhận) — không phải khách hàng tiềm năng đã xác thực.",
    google_conversion_is_not_qualified_lead: true,
    cpa_note: {
      google_7d: w7.cpa_google,
      sale_7d: null,
      google_label: "Chi phí / chuyển đổi Google",
      sale_label: "Chi phí / lead sale xác nhận",
      google_is_not_qualified_lead: true,
      mixed: false,
    },
    cadences: {
      daily: {
        id: "daily",
        label: "Hàng ngày",
        period_label: `Ngày ${dm(end)} (${tz})`,
        compare_label: "so với ngày trước",
        primary: toJson(w1, p1),
        context: { "7": toJson(w7) },
        campaigns: [],
        narrative: narrative(w1, p1, `Ngày ${dm(end)}`, currency),
        work_summary: "",
        xlsx_filename: "",
        xlsx_href: "",
      },
      weekly: {
        id: "weekly",
        label: "Hàng tuần",
        period_label: `7 ngày ${dm(w7.start)} → ${dm(end)}`,
        compare_label: "so với 7 ngày trước",
        primary: toJson(w7, p7),
        context: { "14": toJson(w14), "30": toJson(w30) },
        campaigns,
        narrative: narrative(w7, p7, "7 ngày", currency),
        work_summary: "",
        xlsx_filename: "",
        xlsx_href: "",
      },
    },
  };
  return { report, compare };
}
