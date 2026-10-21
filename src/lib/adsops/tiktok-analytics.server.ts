/** Read model for the TikTok Ads view — reads Neon only (plus best-effort range reach). */
import { getSql } from "@/lib/db";
import { addDaysYmd } from "./warehouse.server.ts";
import { ttInfoFor } from "./tiktok-structure.ts";
import { ttDerive, type TTCampaign, type TTMetrics, type TTNode, type TTView } from "./tiktok-ads.types.ts";

const SUMS = ["spend", "impressions", "clicks", "conversions", "video_play_actions", "video_watched_2s", "video_watched_6s", "video_views_p100", "leads"] as const;
type Row = { level: string; entity_id: string; campaign_id: string | null; ad_group_id: string | null } & Record<(typeof SUMS)[number], unknown>;
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const ymd = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v).slice(0, 10));

async function agg(clientId: string, start: string, end: string): Promise<Row[]> {
  const sql = await getSql();
  return sql.query<Row>(
    `select level, entity_id, max(campaign_id) as campaign_id, max(ad_group_id) as ad_group_id, ${SUMS.map((k) => `sum(${k}) as ${k}`).join(", ")}
       from tiktok_insights_daily where client_id = $1 and date between $2 and $3 group by level, entity_id`,
    [clientId, start, end],
  );
}
function metricsOf(r: Row | undefined, reach: number | null): TTMetrics {
  const s = Object.fromEntries(SUMS.map((k) => [k, r ? n(r[k]) : null])) as Record<(typeof SUMS)[number], number | null>;
  return ttDerive({ ...s, reach });
}

export async function readTikTokView(clientId: string, start: string, end: string, compare: boolean): Promise<TTView> {
  const sql = await getSql();
  const st = (await sql.query<Record<string, unknown>>(`select * from tiktok_account_state where client_id = $1`, [clientId]))[0] || {};
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  const prevEnd = compare ? addDaysYmd(start, -1) : null;
  const prevStart = compare && prevEnd ? addDaysYmd(prevEnd, -(days - 1)) : null;
  const [cur, prev, ents, daily, reach] = await Promise.all([
    agg(clientId, start, end),
    prevStart && prevEnd ? agg(clientId, prevStart, prevEnd) : Promise.resolve([] as Row[]),
    sql.query<{ level: string; entity_id: string; campaign_id: string | null; ad_group_id: string | null; name: string | null; status: string | null; raw: unknown }>(
      `select level, entity_id, campaign_id, ad_group_id, name, status, raw from tiktok_entities where client_id = $1`, [clientId]),
    sql.query<{ date: unknown; spend: unknown; impressions: unknown; clicks: unknown; conversions: unknown }>(
      `select date, spend, impressions, clicks, conversions from tiktok_insights_daily where client_id = $1 and level = 'account' and date between $2 and $3 order by date`, [clientId, start, end]),
    (await import("./tiktok-ads.server.ts")).liveReach(clientId, start, end).catch(() => new Map<string, number | null>()),
  ]);
  const cur$ = (st.currency as string) || "VND";
  const key = (l: string, id: string) => `${l}|${id}`;
  const curBy = new Map(cur.map((r) => [key(r.level, r.entity_id), r]));
  const prevBy = new Map(prev.map((r) => [key(r.level, r.entity_id), r]));
  const meta = new Map(ents.map((e) => [key(e.level, e.entity_id), e]));
  const node = (level: string, id: string): TTNode => {
    const e = meta.get(key(level, id));
    return {
      id, name: e?.name ?? null, status: e?.status ?? null,
      m: metricsOf(curBy.get(key(level, id)), reach.get(key(level, id)) ?? null),
      prev: compare ? metricsOf(prevBy.get(key(level, id)), null) : null,
      delivered: curBy.has(key(level, id)),
      info: ttInfoFor(level, e?.raw ?? null, cur$),
    };
  };
  const ids = (level: string) => new Set([...ents.filter((e) => e.level === level).map((e) => e.entity_id), ...cur.filter((r) => r.level === level).map((r) => r.entity_id)]);
  const campaigns: TTCampaign[] = [...ids("campaign")].map((cid) => ({ ...node("campaign", cid), ad_groups: [] }));
  const cBy = new Map(campaigns.map((c) => [c.id, c]));
  const orphan = (): TTCampaign => {
    let c = cBy.get("");
    if (!c) { c = { ...node("campaign", ""), name: "(chưa rõ chiến dịch)", ad_groups: [] }; cBy.set("", c); campaigns.push(c); }
    return c;
  };
  const gBy = new Map<string, TTCampaign["ad_groups"][number]>();
  for (const gid of ids("ad_group")) {
    const g = { ...node("ad_group", gid), ads: [] as TTNode[] };
    gBy.set(gid, g);
    const pc = meta.get(key("ad_group", gid))?.campaign_id || curBy.get(key("ad_group", gid))?.campaign_id || "";
    (cBy.get(pc) || orphan()).ad_groups.push(g);
  }
  for (const aid of ids("ad")) {
    const gid = meta.get(key("ad", aid))?.ad_group_id || curBy.get(key("ad", aid))?.ad_group_id || "";
    let g = gBy.get(gid);
    if (!g) {
      g = { ...node("ad_group", gid), name: gid ? null : "(chưa rõ nhóm)", ads: [] };
      gBy.set(gid, g);
      const pc = meta.get(key("ad", aid))?.campaign_id || "";
      (cBy.get(pc) || orphan()).ad_groups.push(g);
    }
    g.ads.push(node("ad", aid));
  }
  const accRow = cur.find((r) => r.level === "account");
  const accReach = [...reach.entries()].find(([k]) => k.startsWith("account|"))?.[1] ?? null;
  const adv = (st.advertiser_id as string) || null;
  return {
    client_id: clientId, name: (st.name as string) ?? null, advertiser_id: adv, currency: (st.currency as string) ?? null, timezone: (st.timezone as string) ?? null,
    checked_at: st.checked_at instanceof Date ? st.checked_at.toISOString() : ((st.checked_at as string) ?? null),
    insights_through: ymd(st.insights_through), error: (st.error as string) ?? null,
    start, end, prev_start: prevStart, prev_end: prevEnd,
    totals: metricsOf(accRow, accReach),
    prev_totals: compare ? metricsOf(prev.find((r) => r.level === "account"), null) : null,
    daily: daily.map((d) => ({ date: ymd(d.date) || "", spend: n(d.spend), impressions: n(d.impressions), clicks: n(d.clicks), conversions: n(d.conversions) })),
    campaigns: campaigns.sort((a, b) => (b.m.spend ?? -1) - (a.m.spend ?? -1)),
    manager_url: adv ? `https://ads.tiktok.com/i18n/perf/campaign?aadvid=${encodeURIComponent(adv)}` : null,
  };
}
