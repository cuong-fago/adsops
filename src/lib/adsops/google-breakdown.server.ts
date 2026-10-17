/**
 * Google Ads breakdowns + call details. Read-only GAQL (SELECT only), range aggregate (no daily
 * segments), cached per (client, range, campaign) in google_share_cache like #67.
 */
import { getSql } from "@/lib/db";
import { resolveAdsConfig, type GaqlRow } from "./google-ads.server.ts";
import { addDaysYmd, asRec, customerIdFor, microsToCurrency, numField, searchLeaf, ymdInTz } from "./warehouse.server.ts";
import { DEVICE_VI, DOW_ORDER, DOW_VI, type BreakdownRead, type CallRow, type CallsRead, type SegMetrics, type SegRow } from "./google-breakdown.types.ts";

const TZ = "Asia/Ho_Chi_Minh";
const M = "metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions";
const metricsOf = (r: GaqlRow): SegMetrics => {
  const m = asRec(r.metrics);
  return { cost: microsToCurrency(m.costMicros), impressions: numField(m.impressions), clicks: numField(m.clicks), conversions: numField(m.conversions) };
};
const add = (a: SegMetrics | undefined, b: SegMetrics): SegMetrics =>
  a ? { cost: a.cost + b.cost, impressions: a.impressions + b.impressions, clicks: a.clicks + b.clicks, conversions: a.conversions + b.conversions } : { ...b };

async function cached<T>(clientId: string, level: string, start: string, end: string, fetch: () => Promise<T>): Promise<T | null> {
  const sql = await getSql();
  const hit = await sql.query<{ payload: unknown; fetched_at: unknown }>(
    `select payload, fetched_at from google_share_cache where client_id = $1 and level = $2 and start_date = $3 and end_date = $4`,
    [clientId, level, start, end],
  ).catch(() => []);
  const parse = (p: unknown) => (typeof p === "string" ? JSON.parse(p) : p) as T;
  const recent = end >= addDaysYmd(ymdInTz(TZ), -2);
  if (hit.length) {
    const at = hit[0].fetched_at instanceof Date ? hit[0].fetched_at.getTime() : Date.parse(String(hit[0].fetched_at));
    if (!recent || Date.now() - at < 6 * 3600_000) return parse(hit[0].payload);
  }
  try {
    const data = await fetch();
    await sql.query(
      `insert into google_share_cache (client_id, level, start_date, end_date, payload) values ($1, $2, $3, $4, $5::jsonb)
       on conflict (client_id, level, start_date, end_date) do update set payload = excluded.payload, fetched_at = now()`,
      [clientId, level, start, end, JSON.stringify(data)],
    ).catch(() => null);
    return data;
  } catch {
    return hit.length ? parse(hit[0].payload) : null;
  }
}

function clamp(start: string, end: string) {
  const today = ymdInTz(TZ);
  return { start, end: end > today ? today : end };
}

async function fetchBreakdown(customerId: string, start: string, end: string, campaignId: string | null): Promise<BreakdownRead> {
  const cfg = await resolveAdsConfig();
  if (!cfg.ready) throw new Error("ads not configured");
  const where = `segments.date BETWEEN '${start}' AND '${end}'${campaignId ? ` AND campaign.id = ${campaignId}` : ""}`;
  const errors: string[] = [];
  const safe = (label: string, q: string) => searchLeaf(cfg, customerId, q).catch((e: unknown) => { errors.push(`${label}: ${e instanceof Error ? e.message.slice(0, 160) : "lỗi"}`); return null; });
  const [dev, hd, geo] = await Promise.all([
    safe("device", `SELECT segments.device, ${M} FROM campaign WHERE ${where}`),
    safe("hour", `SELECT segments.day_of_week, segments.hour, ${M} FROM campaign WHERE ${where}`),
    safe("geo", `SELECT segments.geo_target_region, geographic_view.location_type, ${M} FROM geographic_view WHERE ${where} AND geographic_view.location_type = 'LOCATION_OF_PRESENCE'`),
  ]);
  if (!dev && !hd && !geo) throw new Error(errors.join("; "));
  const device = new Map<string, SegMetrics>();
  for (const r of dev || []) { const k = String(asRec(r.segments).device || "OTHER").replace("UNKNOWN", "OTHER"); device.set(k, add(device.get(k), metricsOf(r))); }
  const heat: Record<string, SegMetrics> = {};
  const hour = new Map<string, SegMetrics>();
  const dow = new Map<string, SegMetrics>();
  for (const r of hd || []) {
    const s = asRec(r.segments);
    const d = String(s.dayOfWeek || ""), h = String(numField(s.hour));
    if (!DOW_ORDER.includes(d as (typeof DOW_ORDER)[number])) continue;
    const m = metricsOf(r);
    heat[`${d}|${h}`] = add(heat[`${d}|${h}`], m);
    hour.set(h, add(hour.get(h), m));
    dow.set(d, add(dow.get(d), m));
  }
  const geoBy = new Map<string, SegMetrics>();
  for (const r of geo || []) { const k = String(asRec(r.segments).geoTargetRegion || ""); if (k) geoBy.set(k, add(geoBy.get(k), metricsOf(r))); }
  // Names: geo_target_constant lookup (read-only).
  const names = new Map<string, string>();
  const ids = [...geoBy.keys()].filter((k) => /^geoTargetConstants\/\d+$/.test(k));
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = await searchLeaf(cfg, customerId, `SELECT geo_target_constant.resource_name, geo_target_constant.name, geo_target_constant.canonical_name FROM geo_target_constant WHERE geo_target_constant.resource_name IN (${chunk.map((x) => `'${x}'`).join(",")})`).catch(() => [] as GaqlRow[]);
    for (const r of rows) { const g = asRec(r.geoTargetConstant); names.set(String(g.resourceName || ""), String(g.name || g.canonicalName || "")); }
  }
  return {
    start, end, campaign_id: campaignId,
    device: dev ? [...device].map(([k, m]) => ({ key: k, label: DEVICE_VI[k] || k, ...m })).sort((a, b) => b.cost - a.cost) : [],
    hour: hd ? Array.from({ length: 24 }, (_, h) => ({ key: String(h), label: `${String(h).padStart(2, "0")}h`, ...(hour.get(String(h)) || { cost: 0, impressions: 0, clicks: 0, conversions: 0 }) })) : [],
    dow: hd ? DOW_ORDER.filter((d) => dow.has(d)).map((d) => ({ key: d, label: DOW_VI[d], ...dow.get(d)! })) : [],
    heat,
    geo: [...geoBy].map(([k, m]): SegRow => ({ key: k, label: names.get(k) || k.replace("geoTargetConstants/", "#"), ...m })).sort((a, b) => b.cost - a.cost),
    errors,
  };
}

export async function readBreakdown(clientId: string, start0: string, end0: string, campaignId: string | null): Promise<BreakdownRead | null> {
  const customerId = customerIdFor(clientId);
  if (customerId.length !== 10) return null;
  const { start, end } = clamp(start0, end0);
  if (end < start) return null;
  return cached(clientId, `bd:${campaignId || "all"}`, start, end, () => fetchBreakdown(customerId, start, end, campaignId));
}

async function fetchCalls(clientId: string, customerId: string, start: string, end: string, campaignId: string | null): Promise<Omit<CallsRead, "call_conversions" | "call_actions">> {
  const cfg = await resolveAdsConfig();
  if (!cfg.ready) throw new Error("ads not configured");
  const scope = campaignId ? ` AND campaign.id = ${campaignId}` : "";
  let calls: CallRow[] | null = null;
  let error: string | null = null;
  try {
    const rows = await searchLeaf(
      cfg,
      customerId,
      `SELECT call_view.start_call_date_time, call_view.call_duration_seconds, call_view.call_status, call_view.caller_area_code,
              call_view.caller_country_code, call_view.type, campaign.name, ad_group.name
       FROM call_view WHERE call_view.start_call_date_time >= '${start} 00:00:00' AND call_view.start_call_date_time <= '${end} 23:59:59'${scope}
       ORDER BY call_view.start_call_date_time DESC`,
    );
    calls = rows.map((r) => {
      const c = asRec(r.callView);
      const d = c.callDurationSeconds;
      return {
        start: String(c.startCallDateTime || ""),
        duration: d == null || d === "" ? null : numField(d),
        status: String(c.callStatus || ""),
        // Area code only; Google does not expose caller numbers in call_view.
        area: c.callerAreaCode ? String(c.callerAreaCode) : null,
        country: c.callerCountryCode ? String(c.callerCountryCode) : null,
        type: c.type ? String(c.type) : null,
        campaign_name: String(asRec(r.campaign).name || ""),
        ad_group_name: asRec(r.adGroup).name ? String(asRec(r.adGroup).name) : null,
      };
    });
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 200) : "lỗi";
  }
  let spend: number | null = null;
  try {
    const rows = await searchLeaf(cfg, customerId, `SELECT metrics.cost_micros FROM ${campaignId ? "campaign" : "customer"} WHERE segments.date BETWEEN '${start}' AND '${end}'${scope}`);
    spend = rows.reduce((s, r) => s + microsToCurrency(asRec(r.metrics).costMicros), 0);
  } catch { /* blank */ }
  if (calls == null && spend == null) throw new Error(error || "lỗi");
  const list = calls || [];
  return {
    start, end, campaign_id: campaignId, calls,
    total: list.length,
    long60: list.filter((c) => c.duration != null && c.duration >= 60).length,
    missed: list.filter((c) => c.status === "MISSED").length,
    spend, error,
  };
}

export async function readCalls(clientId: string, start0: string, end0: string, campaignId: string | null): Promise<CallsRead | null> {
  const customerId = customerIdFor(clientId);
  if (customerId.length !== 10) return null;
  const { start, end } = clamp(start0, end0);
  if (end < start) return null;
  const base = await cached(clientId, `calls:${campaignId || "all"}`, start, end, () => fetchCalls(clientId, customerId, start, end, campaignId));
  if (!base) return null;
  // Phone-call conversion actions (#65): PHONE_CALL_LEAD category, campaign level, same range.
  const sql = await getSql();
  const params: unknown[] = [clientId, start, end];
  if (campaignId) params.push(campaignId);
  const conv = await sql.query<{ name: string | null; c: unknown }>(
    `select max(action_name) as name, sum(conversions) as c from google_conv_action_daily
      where client_id = $1 and level = 'campaign' and category = 'PHONE_CALL_LEAD' and date between $2 and $3${campaignId ? " and campaign_id = $4" : ""}
      group by action_id order by 2 desc`,
    params,
  ).catch(() => []);
  const actions = conv.map((x) => ({ name: x.name || "?", conversions: Number(x.c || 0) }));
  return { ...base, call_conversions: actions.length ? actions.reduce((s, a) => s + a.conversions, 0) : null, call_actions: actions };
}
