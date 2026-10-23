/**
 * Google "Xu hướng 3 tháng": one read-only GAQL SELECT per account, segmented by month (customer level).
 * Cached in google_share_cache (level 'trend3m'), refreshed after 6 h. Never writes to Google.
 */
import { getSql } from "@/lib/db";
import { resolveAdsConfig, type GaqlRow } from "./google-ads.server.ts";
import { asRec, customerIdFor, searchLeaf, ymdInTz } from "./warehouse.server.ts";
import { bucketOf, trendPeriods, type PeriodMode } from "./google-trend-periods.ts";
import { LOW_CLICKS, LOW_CONV, type TrendDiag, type TrendMonth, type TrendRead } from "./google-trend.types.ts";

const TZ = "Asia/Ho_Chi_Minh";
const LEVEL = "trend3m";
export type Raw = { month: string; clicks: number; conversions: number; cost: number; lost_rank: number | null };

export const mAdd = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
export const daysIn = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
export const num = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

async function fetchMonths(customerId: string, start: string, end: string): Promise<Raw[]> {
  const cfg = await resolveAdsConfig();
  if (!cfg.ready) throw new Error("Chưa cấu hình Google Ads API.");
  const base = `SELECT segments.month, metrics.clicks, metrics.conversions, metrics.cost_micros FROM customer WHERE segments.date BETWEEN '${start}' AND '${end}'`;
  const rows: GaqlRow[] = await searchLeaf(cfg, customerId, base);
  // Lost IS (rank) is optional context; a rejection never blocks the trend.
  const lost = new Map<string, number>();
  try {
    const r2 = await searchLeaf(cfg, customerId, `SELECT segments.month, metrics.search_rank_lost_impression_share FROM customer WHERE segments.date BETWEEN '${start}' AND '${end}'`);
    for (const r of r2) {
      const m = String(asRec(r.segments).month || "").slice(0, 7);
      const v = num(asRec(r.metrics).searchRankLostImpressionShare);
      if (m && v != null && v >= 0 && v <= 1) lost.set(m, v);
    }
  } catch { /* optional */ }
  const by = new Map<string, Raw>();
  for (const r of rows) {
    const m = String(asRec(r.segments).month || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(m)) continue;
    const x = asRec(r.metrics);
    const cur = by.get(m) || { month: m, clicks: 0, conversions: 0, cost: 0, lost_rank: lost.get(m) ?? null };
    cur.clicks += num(x.clicks) || 0;
    cur.conversions += num(x.conversions) || 0;
    cur.cost += (num(x.costMicros) || 0) / 1_000_000;
    by.set(m, cur);
  }
  return [...by.values()];
}

export function toMonth(r: Raw | undefined, month: string, partial: boolean, days: number): TrendMonth {
  if (!r) return { month, partial, days, clicks: null, conversions: null, spend: null, cpc: null, cpa: null, cvr: null, lost_rank_is: null, low_data: true };
  return {
    month, partial, days,
    clicks: r.clicks, conversions: r.conversions, spend: r.cost,
    cpc: r.clicks > 0 ? r.cost / r.clicks : null,
    cpa: r.conversions > 0 ? r.cost / r.conversions : null,
    cvr: r.clicks > 0 ? r.conversions / r.clicks : null,
    lost_rank_is: r.lost_rank,
    low_data: r.conversions < LOW_CONV || r.clicks < LOW_CLICKS,
  };
}

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const chg = (a: number, b: number) => (b - a) / a;

/** Rules over the 3 complete months only; any low-data month involved → no diagnosis. */
export function diagnose(ms: TrendMonth[]): TrendDiag[] {
  const out: TrendDiag[] = [];
  if (ms.length !== 3) return out;
  const [a, b, c] = ms;
  const ok = (xs: TrendMonth[]) => xs.every((x) => !x.low_data);
  const up3 = (k: "cpc" | "cvr" | "cpa") => a[k] != null && b[k] != null && c[k] != null && a[k]! < b[k]! && b[k]! < c[k]!;
  const down3 = (k: "cvr") => a[k] != null && b[k] != null && c[k] != null && a[k]! > b[k]! && b[k]! > c[k]!;
  if (ok([a, b, c]) && up3("cpc")) {
    const lr = c.lost_rank_is;
    out.push({
      kind: "cpc_up",
      title: "CPC tăng 3 tháng liên tiếp",
      detail: `CPC ${pct(chg(a.cpc!, c.cpc!))} sau 2 tháng: có thể cạnh tranh đấu giá tăng hoặc điểm chất lượng giảm. Kiểm tra Điểm chất lượng, mức liên quan của quảng cáo / trang đích.${lr != null ? ` IS bị mất do xếp hạng tháng gần nhất: ${pct(lr)}${b.lost_rank_is != null ? ` (tháng trước ${pct(b.lost_rank_is)})` : ""}.` : ""}`,
    });
  }
  if (ok([a, b, c]) && down3("cvr")) {
    out.push({ kind: "cvr_down", title: "Tỷ lệ chuyển đổi giảm 3 tháng liên tiếp", detail: `Từ ${pct(a.cvr!)} xuống ${pct(c.cvr!)}. Kiểm tra cụm từ tìm kiếm (thêm từ phủ định), trang đích (tốc độ, nội dung, form) và cài đặt chuyển đổi (thẻ còn bắn đúng không).` });
  }
  if (ok([b, c]) && b.cpa != null && c.cpa != null && b.cpc != null && c.cpc != null) {
    const dCpa = chg(b.cpa, c.cpa), dCpc = chg(b.cpc, c.cpc);
    if (dCpa > 0.1 && Math.abs(dCpc) <= 0.05) {
      out.push({ kind: "cpa_after_click", title: "Giá/chuyển đổi tăng trong khi CPC gần như không đổi", detail: `Giá/chuyển đổi +${pct(dCpa)}, CPC ${dCpc >= 0 ? "+" : ""}${pct(dCpc)} so với tháng trước: vấn đề nằm SAU cú click (trang đích, chất lượng lưu lượng, theo dõi chuyển đổi), không phải giá thầu.` });
    }
  }
  return out;
}

export async function readTrend(clientId: string): Promise<TrendRead> {
  const customerId = customerIdFor(clientId);
  const today = ymdInTz(TZ);
  const curM = today.slice(0, 7);
  const months = [mAdd(curM, -3), mAdd(curM, -2), mAdd(curM, -1)];
  const empty: TrendRead = { client_id: clientId, currency: "VND", months: months.map((m) => toMonth(undefined, m, false, daysIn(m))), current: null, diagnoses: [], fetched_at: null, error: null };
  if (customerId.length !== 10) return { ...empty, error: "Không phải tài khoản Google." };
  const start = `${months[0]}-01`;
  const sql = await getSql();
  let raw: Raw[] | null = null;
  let fetchedAt: string | null = null;
  const hit = await sql.query<{ payload: unknown; fetched_at: unknown }>(
    `select payload, fetched_at from google_share_cache where client_id = $1 and level = $2 and start_date = $3 and end_date = $4`,
    [clientId, LEVEL, start, today],
  ).catch(() => []);
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
  if (hit.length && Date.now() - Date.parse(iso(hit[0].fetched_at)) < 6 * 3600_000) {
    const p = hit[0].payload;
    raw = (typeof p === "string" ? JSON.parse(p) : p) as Raw[];
    fetchedAt = iso(hit[0].fetched_at);
  } else {
    try {
      raw = await fetchMonths(customerId, start, today);
      fetchedAt = new Date().toISOString();
      await sql.query(
        `insert into google_share_cache (client_id, level, start_date, end_date, payload) values ($1, $2, $3, $4, $5::jsonb)
         on conflict (client_id, level, start_date, end_date) do update set payload = excluded.payload, fetched_at = now()`,
        [clientId, LEVEL, start, today, JSON.stringify(raw)],
      ).catch(() => null);
    } catch (e) {
      // Older cache (any end date) beats nothing.
      const old = await sql.query<{ payload: unknown; fetched_at: unknown }>(
        `select payload, fetched_at from google_share_cache where client_id = $1 and level = $2 and start_date = $3 order by fetched_at desc limit 1`,
        [clientId, LEVEL, start],
      ).catch(() => []);
      if (!old.length) return { ...empty, error: e instanceof Error ? e.message : String(e) };
      const p = old[0].payload;
      raw = (typeof p === "string" ? JSON.parse(p) : p) as Raw[];
      fetchedAt = iso(old[0].fetched_at);
    }
  }
  const by = new Map((raw || []).map((r) => [r.month, r]));
  const ms = months.map((m) => toMonth(by.get(m), m, false, daysIn(m)));
  const elapsed = Number(today.slice(8, 10));
  const current = toMonth(by.get(curM), curM, true, elapsed);
  return { client_id: clientId, currency: "VND", months: ms, current, diagnoses: diagnose(ms), fetched_at: fetchedAt, error: null };
}

/** Period mode ("Xu hướng" for 7/14/30/90 ngày, hôm qua, tuỳ chọn): 4 equal windows, one daily GAQL SELECT, bucketed. */
export async function readTrendPeriods(clientId: string, start: string, end: string, mode: PeriodMode): Promise<TrendRead> {
  const periods = trendPeriods(start, end, mode);
  const empty: TrendRead = { client_id: clientId, currency: "VND", months: periods.map((p) => toMonth(undefined, p.key, false, p.days)), current: null, diagnoses: [], fetched_at: null, error: null, periods, mode };
  const customerId = customerIdFor(clientId);
  if (customerId.length !== 10) return { ...empty, error: "Không phải tài khoản Google." };
  const { cached } = await import("./google-trend-tree.server.ts");
  const bucket = bucketOf(periods);
  try {
    const { v, at } = await cached<Raw[]>(clientId, `trendp_${mode}`, periods[0].start, end, async () => {
      const cfg = await resolveAdsConfig();
      if (!cfg.ready) throw new Error("Chưa cấu hình Google Ads API.");
      const rows = await searchLeaf(cfg, customerId, `SELECT segments.date, metrics.clicks, metrics.conversions, metrics.cost_micros FROM customer WHERE segments.date BETWEEN '${periods[0].start}' AND '${end}'`);
      const by = new Map<string, Raw>();
      for (const r of rows) {
        const k = bucket(String(asRec(r.segments).date || ""));
        if (!k) continue;
        const x = asRec(r.metrics);
        const cur = by.get(k) || { month: k, clicks: 0, conversions: 0, cost: 0, lost_rank: null };
        cur.clicks += num(x.clicks) || 0; cur.conversions += num(x.conversions) || 0; cur.cost += (num(x.costMicros) || 0) / 1_000_000;
        by.set(k, cur);
      }
      return [...by.values()];
    });
    const by = new Map(v.map((r) => [r.month, r]));
    return { ...empty, months: periods.map((p) => toMonth(by.get(p.key), p.key, false, p.days)), fetched_at: at };
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) };
  }
}
