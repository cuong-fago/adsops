/** Read Facebook analytics from Neon (no API call). */
import { getSql } from "@/lib/db";
import { addDaysYmd } from "./warehouse.server.ts";
import type { Json, MetaAnalytics, MetaMetrics, MetaRow } from "./meta-ads.types.ts";

type Raw = { spend: unknown; impressions: unknown; clicks: unknown; leads: unknown; messages: unknown; lead_rows: unknown; msg_rows: unknown; follows: unknown; follow_rows: unknown; page_eng: unknown; page_eng_rows: unknown };
const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const iso = (v: unknown) => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));

function metrics(r: Raw | undefined): MetaMetrics {
  const spend = n(r?.spend);
  const impressions = n(r?.impressions);
  const clicks = n(r?.clicks);
  const leads = n(r?.lead_rows) > 0 ? n(r?.leads) : null;
  const messages = n(r?.msg_rows) > 0 ? n(r?.messages) : null;
  const follows = n(r?.follow_rows) > 0 ? n(r?.follows) : null;
  return {
    spend, impressions, clicks, leads, messages,
    ctr: impressions > 0 ? clicks / impressions : null,
    cpc: clicks > 0 ? spend / clicks : null,
    cpl: leads && leads > 0 ? spend / leads : null,
    follows,
    cost_per_follow: follows && follows > 0 ? spend / follows : null,
    page_engagement: n(r?.page_eng_rows) > 0 ? n(r?.page_eng) : null,
  };
}
/** Sum of one action_type (or the first present of several) from the stored actions jsonb; NULL when absent. */
const act = (types: string[]) => {
  const list = types.map((x) => `'${x}'`).join(",");
  return `(select sum((a->>'value')::numeric) from jsonb_array_elements(case when jsonb_typeof(actions) = 'array' then actions else '[]'::jsonb end) a where a->>'action_type' in (${list}))`;
};
// Page likes = follows in the new Pages experience. "like" is what Meta returns (verified on Topwin);
// follow types only if "like" is absent, so they are never double counted.
const FOLLOW_EXPR = `coalesce(${act(["like"])}, ${act(["onsite_conversion.page_like", "follow", "onsite_conversion.follow"])})`;
const PAGE_ENG_EXPR = act(["page_engagement"]);
const AGG = `sum(spend) as spend, sum(impressions) as impressions, sum(clicks) as clicks,
  sum(leads) as leads, count(leads) as lead_rows, sum(messages) as messages, count(messages) as msg_rows,
  sum(${FOLLOW_EXPR}) as follows, count(${FOLLOW_EXPR}) as follow_rows,
  sum(${PAGE_ENG_EXPR}) as page_eng, count(${PAGE_ENG_EXPR}) as page_eng_rows`;

export async function readMetaAnalytics(clientId: string, start: string, end: string, withPrev: boolean): Promise<MetaAnalytics> {
  const sql = await getSql();
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
  const prevRange = withPrev ? { start: addDaysYmd(start, -days), end: addDaysYmd(start, -1) } : null;
  const { metaHistoryFrom } = await import("./meta-ads.server.ts");
  const historyFrom = await metaHistoryFrom(clientId).catch(() => null);
  // Covered = Meta was actually asked for every day of the previous period (not "min date with spend").
  const prevCovered = prevRange ? Boolean(historyFrom && historyFrom <= prevRange.start) : null;
  const usePrev = prevRange && prevCovered ? prevRange : null;
  const sum = async (a: string, b: string) =>
    (await sql.query<Raw>(`select ${AGG} from meta_insights_daily where client_id = $1 and level = 'account' and date between $2 and $3`, [clientId, a, b]))[0];
  const daily = await sql.query<Raw & { date: unknown }>(
    `select date, ${AGG} from meta_insights_daily where client_id = $1 and level = 'account' and date between $2 and $3 group by date order by date`,
    [clientId, start, end],
  );
  type Obj = { object_id: string; name: string | null; status: string | null; effective_status: string | null; config: unknown; pulled_at: unknown };
  const objs = await sql.query<Obj & { level: string }>(
    `select level, object_id, name, status, effective_status, config, pulled_at from meta_objects where client_id = $1`, [clientId],
  ).catch(() => [] as Array<Obj & { level: string }>);
  const objBy = new Map(objs.map((o) => [`${o.level}:${o.object_id}`, o]));
  const cfg = (v: unknown): { [k: string]: Json } | null => {
    if (!v) return null;
    if (typeof v === "string") { try { return JSON.parse(v) as { [k: string]: Json }; } catch { return null; } }
    return v as { [k: string]: Json };
  };
  type Agg = Raw & { id: string; name: string | null; campaign_name: string | null; adset_name: string | null; campaign_id: string | null; adset_id: string | null };
  const aggAt = (level: string, a: string, b: string, nameCol: string) =>
    sql.query<Agg>(
      `select object_id as id, max(${nameCol}) as name, max(campaign_name) as campaign_name, max(adset_name) as adset_name, max(campaign_id) as campaign_id, max(adset_id) as adset_id, ${AGG}
         from meta_insights_daily where client_id = $1 and level = $2 and date between $3 and $4
        group by object_id having sum(spend) > 0 or sum(impressions) > 0 order by sum(spend) desc`,
      [clientId, level, a, b],
    );
  const rowsAt = async (level: "campaign" | "adset" | "ad"): Promise<MetaRow[]> => {
    const nameCol = level === "campaign" ? "campaign_name" : level === "adset" ? "adset_name" : "ad_name";
    const r = await aggAt(level, start, end, nameCol);
    const prevRows = usePrev ? await aggAt(level, usePrev.start, usePrev.end, nameCol) : null;
    const prevBy = new Map((prevRows || []).map((x) => [x.id, x]));
    const curIds = new Set(r.map((x) => x.id));
    const gone = (prevRows || []).filter((x) => !curIds.has(x.id));
    return [...r, ...gone].map((x) => {
      const o = objBy.get(`${level}:${x.id}`);
      const isGone = !curIds.has(x.id);
      const pv = prevBy.get(x.id);
      return {
        id: x.id,
        name: o?.name || x.name || x.id,
        campaign_name: level === "campaign" ? null : x.campaign_name,
        adset_name: level === "ad" ? x.adset_name : null,
        campaign_id: x.campaign_id,
        adset_id: x.adset_id,
        status: o?.status ?? null,
        effective_status: o?.effective_status ?? null,
        config: cfg(o?.config),
        ...(isGone ? metrics(undefined) : metrics(x)),
        ...(usePrev ? { prev: pv ? metrics(pv) : null, tag: isGone ? ("gone" as const) : pv ? null : ("new" as const) } : {}),
      };
    });
  };
  const pulled = objs.reduce<string | null>((m, o) => {
    const s = o.pulled_at ? (o.pulled_at instanceof Date ? o.pulled_at.toISOString() : String(o.pulled_at)) : null;
    return s && (!m || s > m) ? s : m;
  }, null);
  const span = (await sql.query<{ a: unknown; b: unknown }>(`select min(date) as a, max(date) as b from meta_insights_daily where client_id = $1 and level = 'account'`, [clientId]))[0];
  const st = (await sql.query<{ account_status: number | null; checked_at: unknown; error: string | null; currency: string | null }>(
    `select account_status, checked_at, error, currency from meta_account_state where client_id = $1`, [clientId],
  ).catch(() => []))[0];
  return {
    client_id: clientId,
    currency: st?.currency || "VND",
    start, end,
    data_through: iso(span?.b),
    warehouse_start: iso(span?.a),
    totals: metrics(await sum(start, end)),
    prev: usePrev ? metrics(await sum(usePrev.start, usePrev.end)) : null,
    prev_range: prevRange,
    prev_covered: prevCovered,
    history_from: historyFrom,
    daily: daily.map((d) => ({ date: iso(d.date) as string, ...metrics(d) })),
    campaigns: await rowsAt("campaign"),
    adsets: await rowsAt("adset"),
    ads: await rowsAt("ad"),
    structure_pulled_at: pulled,
    state: st ? { account_status: st.account_status, checked_at: st.checked_at ? (st.checked_at instanceof Date ? st.checked_at.toISOString() : String(st.checked_at)) : null, error: st.error } : null,
  };
}
