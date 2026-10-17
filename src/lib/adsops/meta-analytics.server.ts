/** Read Facebook analytics from Neon; reach / frequency per range from Meta (cached in meta_reach_cache). */
import { getSql } from "@/lib/db";
import { addDaysYmd } from "./warehouse.server.ts";
import type { Json, MetaAnalytics, MetaMetrics, MetaRow } from "./meta-ads.types.ts";

type Raw = { spend: unknown; impressions: unknown; clicks: unknown; leads: unknown; messages: unknown; lead_rows: unknown; msg_rows: unknown; follows: unknown; follow_rows: unknown; page_eng: unknown; page_eng_rows: unknown;
  link_clicks?: unknown; lc_rows?: unknown; lpv?: unknown; lpv_rows?: unknown; v3s?: unknown; v3s_rows?: unknown; thru?: unknown; thru_rows?: unknown;
  p25?: unknown; p50?: unknown; p75?: unknown; p100?: unknown; p_rows?: unknown;
  [k: string]: unknown };
type Reach = { reach: number | null; frequency: number | null } | undefined;
const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const iso = (v: unknown) => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));

/** `full` = every day in the range has the new fields (link clicks / quartiles / ThruPlay). */
function metrics(r: Raw | undefined, full = true, rf?: Reach, v3 = false): MetaMetrics {
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
    ...delivery(r, spend, impressions, full, rf),
    ...commerce(r, spend, messages, v3),
  };
}
/** Messaging depth + purchases. Counts from actions (full history); value / ROAS need action_values (fullV3). */
function commerce(r: Raw | undefined, spend: number, messages: number | null, v3: boolean) {
  const opt = (k: string) => (n(r?.[`${k}_rows`]) > 0 ? n(r?.[k]) : null);
  const depth2 = opt("md2");
  const replied = opt("mrep");
  const deep = depth2 ?? replied;
  const purchases = opt("pur");
  const value = v3 && n(r?.purv_rows) > 0 ? n(r?.purv) : null;
  return {
    cost_per_message: messages && messages > 0 ? spend / messages : null,
    msg_first_reply: opt("mfr"),
    msg_replied: replied,
    msg_depth2: depth2,
    msg_depth3: opt("md3"),
    msg_depth5: opt("md5"),
    msg_connections: opt("mconn"),
    deep_rate: deep != null && messages && messages > 0 ? deep / messages : null,
    purchases,
    purchase_value: purchases != null ? value : null,
    roas: purchases != null && value != null && spend > 0 ? value / spend : null,
    cpa_purchase: purchases && purchases > 0 ? spend / purchases : null,
  };
}
function delivery(r: Raw | undefined, spend: number, impressions: number, full: boolean, rf: Reach) {
  const has = (rows: unknown) => n(rows) > 0;
  const linkClicks = full && has(r?.lc_rows) ? n(r?.link_clicks) : null;
  const lpv = has(r?.lpv_rows) ? n(r?.lpv) : null;
  const v3s = has(r?.v3s_rows) ? n(r?.v3s) : null;
  const thru = full && has(r?.thru_rows) ? n(r?.thru) : null;
  const q = (k: "p25" | "p50" | "p75" | "p100") => (full && has(r?.p_rows) && v3s && v3s > 0 ? n(r?.[k]) / v3s : null);
  return {
    reach: rf?.reach ?? null,
    frequency: rf?.frequency ?? null,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
    link_clicks: linkClicks,
    link_ctr: linkClicks != null && impressions > 0 ? linkClicks / impressions : null,
    cost_per_link_click: linkClicks && linkClicks > 0 ? spend / linkClicks : null,
    lpv,
    lpv_rate: lpv != null && linkClicks && linkClicks > 0 ? lpv / linkClicks : null,
    video_3s: v3s,
    thruplay: thru,
    hook_rate: v3s != null && impressions > 0 ? v3s / impressions : null,
    hold_rate: thru != null && v3s && v3s > 0 ? thru / v3s : null,
    ret25: q("p25"), ret50: q("p50"), ret75: q("p75"), ret100: q("p100"),
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
// Older rows have these only inside actions jsonb: fall back so history counts at once.
const LPV_EXPR = `coalesce(landing_page_views, ${act(["landing_page_view"])})`;
const V3S_EXPR = `coalesce(video_3s, ${act(["video_view"])})`;
// Purchase types overlap (omni ⊇ pixel / onsite): first present, never summed.
const PUR_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase", "onsite_conversion.purchase"];
const firstOf = (col: string) =>
  `coalesce(${PUR_TYPES.map((t) => `(select sum((a->>'value')::numeric) from jsonb_array_elements(case when jsonb_typeof(${col}) = 'array' then ${col} else '[]'::jsonb end) a where a->>'action_type' = '${t}')`).join(", ")})`;
const PUR_EXPR = firstOf("actions");
const PURV_EXPR = firstOf("action_values");
const MSG = {
  mfr: act(["onsite_conversion.messaging_first_reply"]),
  mrep: act(["onsite_conversion.messaging_conversation_replied_7d"]),
  md2: act(["onsite_conversion.messaging_user_depth_2_message_send"]),
  md3: act(["onsite_conversion.messaging_user_depth_3_message_send"]),
  md5: act(["onsite_conversion.messaging_user_depth_5_message_send"]),
  mconn: act(["onsite_conversion.total_messaging_connection", "total_messaging_connection"]),
};
const AGG = `${Object.entries(MSG).map(([k, e]) => `sum(${e}) as ${k}, count(${e}) as ${k}_rows`).join(", ")},
  sum(${PUR_EXPR}) as pur, count(${PUR_EXPR}) as pur_rows, sum(${PURV_EXPR}) as purv, count(${PURV_EXPR}) as purv_rows,
  sum(spend) as spend, sum(impressions) as impressions, sum(clicks) as clicks,
  sum(leads) as leads, count(leads) as lead_rows, sum(messages) as messages, count(messages) as msg_rows,
  sum(${FOLLOW_EXPR}) as follows, count(${FOLLOW_EXPR}) as follow_rows,
  sum(${PAGE_ENG_EXPR}) as page_eng, count(${PAGE_ENG_EXPR}) as page_eng_rows,
  sum(inline_link_clicks) as link_clicks, count(inline_link_clicks) as lc_rows,
  sum(${LPV_EXPR}) as lpv, count(${LPV_EXPR}) as lpv_rows,
  sum(${V3S_EXPR}) as v3s, count(${V3S_EXPR}) as v3s_rows,
  sum(video_thruplay) as thru, count(video_thruplay) as thru_rows,
  sum(video_p25) as p25, sum(video_p50) as p50, sum(video_p75) as p75, sum(video_p100) as p100, count(video_p25) as p_rows`;

export async function readMetaAnalytics(clientId: string, start: string, end: string, withPrev: boolean): Promise<MetaAnalytics> {
  const sql = await getSql();
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
  const prevRange = withPrev ? { start: addDaysYmd(start, -days), end: addDaysYmd(start, -1) } : null;
  const { metaHistoryFrom } = await import("./meta-ads.server.ts");
  const historyFrom = await metaHistoryFrom(clientId).catch(() => null);
  // Covered = Meta was actually asked for every day of the previous period (not "min date with spend").
  const prevCovered = prevRange ? Boolean(historyFrom && historyFrom <= prevRange.start) : null;
  const usePrev = prevRange && prevCovered ? prevRange : null;
  // New fields complete for a range when every day was (re-)pulled with them.
  const v2 = await sql.query<{ v: unknown; v3: unknown }>(`select fields_v2_from as v, fields_v3_from as v3 from meta_account_state where client_id = $1`, [clientId]).catch(() => []);
  const v2From = iso(v2[0]?.v);
  const v3From = iso(v2[0]?.v3);
  const v3Cur = Boolean(v3From && v3From <= start);
  const v3Prev = usePrev ? Boolean(v3From && v3From <= usePrev.start) : false;
  const fullCur = Boolean(v2From && v2From <= start);
  const fullPrev = usePrev ? Boolean(v2From && v2From <= usePrev.start) : null;
  // Reach / frequency per range from Meta (cached). Failure = blank, never a sum of days.
  const { metaReach, fbAccountId } = await import("./meta-ads.server.ts");
  const accId = fbAccountId(clientId);
  const reachCur = await metaReach(clientId, start, end).catch(() => null);
  const reachPrev = usePrev ? await metaReach(clientId, usePrev.start, usePrev.end).catch(() => null) : null;
  const reachLevel = { campaign: "campaign", adset: "adset", ad: "ad" } as const;
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
        ...(isGone ? metrics(undefined) : metrics(x, fullCur, reachCur?.[reachLevel[level]][x.id], v3Cur)),
        ...(usePrev ? { prev: pv ? metrics(pv, Boolean(fullPrev), reachPrev?.[reachLevel[level]][x.id], v3Prev) : null, tag: isGone ? ("gone" as const) : pv ? null : ("new" as const) } : {}),
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
    totals: metrics(await sum(start, end), fullCur, reachCur?.account[accId], v3Cur),
    prev: usePrev ? metrics(await sum(usePrev.start, usePrev.end), Boolean(fullPrev), reachPrev?.account[accId], v3Prev) : null,
    fields_complete: fullCur,
    prev_fields_complete: fullPrev,
    prev_range: prevRange,
    prev_covered: prevCovered,
    history_from: historyFrom,
    daily: daily.map((d) => ({ date: iso(d.date) as string, ...metrics(d, Boolean(v2From && v2From <= (iso(d.date) as string)), undefined, Boolean(v3From && v3From <= (iso(d.date) as string))) })),
    campaigns: await rowsAt("campaign"),
    adsets: await rowsAt("adset"),
    ads: await rowsAt("ad"),
    structure_pulled_at: pulled,
    state: st ? { account_status: st.account_status, checked_at: st.checked_at ? (st.checked_at instanceof Date ? st.checked_at.toISOString() : String(st.checked_at)) : null, error: st.error } : null,
  };
}
