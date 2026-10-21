/**
 * Google trend by Loại chiến dịch → Chiến dịch → Nhóm quảng cáo / Nhóm tài sản (PMax).
 * Read-only GAQL SELECT segmented by month; cached in google_share_cache like trend3m (6 h).
 */
import { getSql } from "@/lib/db";
import { resolveAdsConfig } from "./google-ads.server.ts";
import { asRec, customerIdFor, searchLeaf, ymdInTz } from "./warehouse.server.ts";
import { daysIn, diagnose, mAdd, num, toMonth, type Raw } from "./google-trend.server.ts";
import type { ChannelGroup, ChannelKey, TreeRow, TrendChildrenRead, TrendMonth, TrendTreeRead } from "./google-trend.types.ts";

const TZ = "Asia/Ho_Chi_Minh";
type Leaf = { id: string; name: string; status: string | null; channel: string; month: string; clicks: number; conversions: number; cost: number };

const CH: Record<string, ChannelKey> = { SEARCH: "search", PERFORMANCE_MAX: "pmax", SHOPPING: "shopping", VIDEO: "video", DISPLAY: "display", DEMAND_GEN: "demand_gen", DISCOVERY: "demand_gen" };
const ORDER: ChannelKey[] = ["search", "pmax", "shopping", "video", "display", "demand_gen", "other"];
const chOf = (s: string): ChannelKey => CH[s] || "other";
const mLabel = (m: string) => `T${Number(m.slice(5))}/${m.slice(2, 4)}`;

function window() {
  const today = ymdInTz(TZ);
  const cur = today.slice(0, 7);
  const months = [mAdd(cur, -3), mAdd(cur, -2), mAdd(cur, -1)];
  return { today, cur, months, start: `${months[0]}-01`, elapsed: Number(today.slice(8, 10)) };
}

async function cached<T>(clientId: string, level: string, start: string, end: string, load: () => Promise<T>): Promise<{ v: T; at: string }> {
  const sql = await getSql();
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
  const parse = (p: unknown) => (typeof p === "string" ? JSON.parse(p) : p) as T;
  const hit = await sql.query<{ payload: unknown; fetched_at: unknown }>(
    `select payload, fetched_at from google_share_cache where client_id = $1 and level = $2 and start_date = $3 and end_date = $4`,
    [clientId, level, start, end],
  ).catch(() => []);
  if (hit.length && Date.now() - Date.parse(iso(hit[0].fetched_at)) < 6 * 3600_000) return { v: parse(hit[0].payload), at: iso(hit[0].fetched_at) };
  try {
    const v = await load();
    await sql.query(
      `insert into google_share_cache (client_id, level, start_date, end_date, payload) values ($1, $2, $3, $4, $5::jsonb)
       on conflict (client_id, level, start_date, end_date) do update set payload = excluded.payload, fetched_at = now()`,
      [clientId, level, start, end, JSON.stringify(v)],
    ).catch(() => null);
    return { v, at: new Date().toISOString() };
  } catch (e) {
    const old = await sql.query<{ payload: unknown; fetched_at: unknown }>(
      `select payload, fetched_at from google_share_cache where client_id = $1 and level = $2 and start_date = $3 order by fetched_at desc limit 1`,
      [clientId, level, start],
    ).catch(() => []);
    if (!old.length) throw e;
    return { v: parse(old[0].payload), at: iso(old[0].fetched_at) };
  }
}

async function query(customerId: string, gaql: string, ent: "campaign" | "adGroup" | "assetGroup"): Promise<Leaf[]> {
  const cfg = await resolveAdsConfig();
  if (!cfg.ready) throw new Error("Chưa cấu hình Google Ads API.");
  const rows = await searchLeaf(cfg, customerId, gaql);
  const out: Leaf[] = [];
  for (const r of rows) {
    const e = asRec((r as Record<string, unknown>)[ent]);
    const c = asRec((r as Record<string, unknown>).campaign);
    const m = String(asRec(r.segments).month || "").slice(0, 7);
    const id = String(e.id ?? "");
    if (!id || !/^\d{4}-\d{2}$/.test(m)) continue;
    const x = asRec(r.metrics);
    out.push({
      id, name: String(e.name ?? id), status: e.status ? String(e.status) : null, channel: String(c.advertisingChannelType ?? ""),
      month: m, clicks: num(x.clicks) || 0, conversions: num(x.conversions) || 0, cost: (num(x.costMicros) || 0) / 1_000_000,
    });
  }
  return out;
}

const hasData = (r: Raw | undefined) => !!r && (r.clicks > 0 || r.cost > 0 || r.conversions > 0);
const add = (a: Raw | undefined, l: { clicks: number; conversions: number; cost: number }, month: string): Raw => ({
  month, clicks: (a?.clicks || 0) + l.clicks, conversions: (a?.conversions || 0) + l.conversions, cost: (a?.cost || 0) + l.cost, lost_rank: null,
});

/** Biggest bad-direction MoM change T vs T-1 (CPC↑, CPA↑, CVR↓). Low-data months → null. */
function worstOf(ms: TrendMonth[]): number | null {
  const b = ms[1], c = ms[2];
  if (!b || !c || b.low_data || c.low_data) return null;
  const xs: number[] = [];
  if (b.cpc && c.cpc != null) xs.push((c.cpc - b.cpc) / b.cpc);
  if (b.cpa && c.cpa != null) xs.push((c.cpa - b.cpa) / b.cpa);
  if (b.cvr && c.cvr != null) xs.push(-(c.cvr - b.cvr) / b.cvr);
  return xs.length ? Math.max(...xs) : null;
}

function buildRows(leaves: Leaf[], w: ReturnType<typeof window>): Array<TreeRow & { _raw: Map<string, Raw> }> {
  const by = new Map<string, { l: Leaf; m: Map<string, Raw> }>();
  for (const l of leaves) {
    const g = by.get(l.id) || { l, m: new Map<string, Raw>() };
    g.m.set(l.month, add(g.m.get(l.month), l, l.month));
    by.set(l.id, g);
  }
  return [...by.values()].map(({ l, m }) => {
    const present = w.months.map((mo) => hasData(m.get(mo)));
    const all = present.every(Boolean);
    const first = present.indexOf(true);
    const label = all ? null : first > 0 ? `Mới từ ${mLabel(w.months[first])}` : first === -1 ? (hasData(m.get(w.cur)) ? `Mới từ ${mLabel(w.cur)}` : "Không có dữ liệu") : "Không đủ 3 tháng";
    const ms = w.months.map((mo) => toMonth(m.get(mo), mo, false, daysIn(mo)));
    return {
      id: l.id, name: l.name, status: l.status, channel: chOf(l.channel), months: ms,
      current: toMonth(m.get(w.cur), w.cur, true, w.elapsed),
      excluded_label: label, worst: all ? worstOf(ms) : null, _raw: m,
    };
  });
}
const strip = ({ _raw, ...r }: TreeRow & { _raw: unknown }): TreeRow => (void _raw, r);
const sortRows = (rs: TreeRow[]) => rs.sort((a, b) => (a.excluded_label ? 1 : 0) - (b.excluded_label ? 1 : 0) || (b.worst ?? -Infinity) - (a.worst ?? -Infinity) || (b.months[2].spend ?? 0) - (a.months[2].spend ?? 0));

export async function readTrendTree(clientId: string): Promise<TrendTreeRead> {
  const w = window();
  const base: TrendTreeRead = { client_id: clientId, months: w.months, current_month: w.cur, groups: [], mix: [], fetched_at: null, error: null };
  const customerId = customerIdFor(clientId);
  if (customerId.length !== 10) return { ...base, error: "Không phải tài khoản Google." };
  let leaves: Leaf[];
  let at: string;
  try {
    ({ v: leaves, at } = await cached(clientId, "trend3m_camp", w.start, w.today, () => query(customerId,
      `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, segments.month, metrics.clicks, metrics.conversions, metrics.cost_micros FROM campaign WHERE segments.date BETWEEN '${w.start}' AND '${w.today}'`, "campaign")));
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
  const rows = buildRows(leaves, w);
  const groups: ChannelGroup[] = [];
  for (const ch of ORDER) {
    const rs = rows.filter((r) => r.channel === ch);
    if (!rs.length) continue;
    const like = rs.filter((r) => !r.excluded_label);
    const agg = new Map<string, Raw>();
    for (const r of like) for (const [mo, x] of r._raw) agg.set(mo, add(agg.get(mo), x, mo));
    const lm = w.months.map((mo) => toMonth(agg.get(mo), mo, false, daysIn(mo)));
    groups.push({
      channel: ch, like: lm, like_current: toMonth(agg.get(w.cur), w.cur, true, w.elapsed), like_count: like.length, total_count: rs.length,
      diagnoses: like.length ? diagnose(lm) : [], worst: like.length ? worstOf(lm) : null, campaigns: sortRows(rs.map(strip)),
    });
  }
  groups.sort((a, b) => (b.worst ?? -Infinity) - (a.worst ?? -Infinity));
  const mix = [...w.months, w.cur].map((mo) => {
    const per = new Map<ChannelKey, number>();
    for (const r of rows) { const x = r._raw.get(mo); if (x && x.cost > 0) per.set(r.channel, (per.get(r.channel) || 0) + x.cost); }
    const total = [...per.values()].reduce((s, v) => s + v, 0);
    return { month: mo, total: total > 0 ? total : null, shares: total > 0 ? ORDER.filter((c) => per.has(c)).map((c) => ({ channel: c, spend: per.get(c)!, share: per.get(c)! / total })) : [] };
  });
  return { ...base, groups, mix, fetched_at: at };
}

/** Lazy children of one campaign: asset groups for PMax, ad groups otherwise. */
export async function readTrendChildren(clientId: string, campaignId: string, pmax: boolean): Promise<TrendChildrenRead> {
  const kind = pmax ? "asset_group" : "ad_group";
  const customerId = customerIdFor(clientId);
  if (customerId.length !== 10) return { kind, rows: [], error: "Không phải tài khoản Google." };
  const w = window();
  const gaql = pmax
    ? `SELECT asset_group.id, asset_group.name, asset_group.status, campaign.advertising_channel_type, segments.month, metrics.clicks, metrics.conversions, metrics.cost_micros FROM asset_group WHERE campaign.id = ${campaignId} AND segments.date BETWEEN '${w.start}' AND '${w.today}'`
    : `SELECT ad_group.id, ad_group.name, ad_group.status, campaign.advertising_channel_type, segments.month, metrics.clicks, metrics.conversions, metrics.cost_micros FROM ad_group WHERE campaign.id = ${campaignId} AND segments.date BETWEEN '${w.start}' AND '${w.today}'`;
  try {
    const { v } = await cached(clientId, `trend3m_${pmax ? "asg" : "ag"}_${campaignId}`, w.start, w.today, () => query(customerId, gaql, pmax ? "assetGroup" : "adGroup"));
    return { kind, rows: sortRows(buildRows(v, w).map(strip)), error: null };
  } catch (e) {
    return { kind, rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}
