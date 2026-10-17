/** Read model for the ChatGPT Ads view — reads Neon only (no OpenAI call). */
import { getSql } from "@/lib/db";
import { addDaysYmd } from "./warehouse.server.ts";
import { oaDerive, type OACampaign, type OAMetrics, type OANode, type OAView } from "./openai-ads.types.ts";

type Row = { level: string; entity_id: string; campaign_id: string | null; ad_group_id: string | null; impressions: unknown; clicks: unknown; spend: unknown; conversions: unknown; sales: unknown };
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const ymd = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v).slice(0, 10));

async function agg(clientId: string, start: string, end: string): Promise<Row[]> {
  const sql = await getSql();
  return sql.query<Row>(
    `select level, entity_id, max(campaign_id) as campaign_id, max(ad_group_id) as ad_group_id,
            sum(impressions) as impressions, sum(clicks) as clicks, sum(spend) as spend, sum(conversions) as conversions, sum(sales) as sales
       from openai_insights_daily where client_id = $1 and date between $2 and $3 group by level, entity_id`,
    [clientId, start, end],
  );
}

function metricsOf(r: Row | undefined): OAMetrics {
  if (!r) return oaDerive({ impressions: null, clicks: null, spend: null, conversions: null, sales: null });
  return oaDerive({ impressions: n(r.impressions), clicks: n(r.clicks), spend: n(r.spend), conversions: n(r.conversions), sales: n(r.sales) });
}

export async function readOpenAIView(clientId: string, start: string, end: string, compare: boolean): Promise<OAView> {
  const sql = await getSql();
  const st = (await sql.query<Record<string, unknown>>(`select * from openai_account_state where client_id = $1`, [clientId]))[0] || {};
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  const prevEnd = compare ? addDaysYmd(start, -1) : null;
  const prevStart = compare && prevEnd ? addDaysYmd(prevEnd, -(days - 1)) : null;
  const [cur, prev, ents, daily, reach] = await Promise.all([
    agg(clientId, start, end),
    prevStart && prevEnd ? agg(clientId, prevStart, prevEnd) : Promise.resolve([] as Row[]),
    sql.query<{ level: string; entity_id: string; campaign_id: string | null; ad_group_id: string | null; name: string | null; status: string | null; raw: { title?: string; link?: string; body?: string } | null }>(
      `select level, entity_id, campaign_id, ad_group_id, name, status, raw from openai_entities where client_id = $1`,
      [clientId],
    ),
    sql.query<{ date: unknown; spend: unknown; impressions: unknown; clicks: unknown; conversions: unknown }>(
      `select date, spend, impressions, clicks, conversions from openai_insights_daily where client_id = $1 and level = 'account' and date between $2 and $3 order by date`,
      [clientId, start, end],
    ),
    (await import("./openai-ads.server.ts")).liveReach(clientId, start, end).catch(() => new Map<string, { reach: number | null; frequency: number | null }>()),
  ]);
  const key = (l: string, id: string) => `${l}|${id}`;
  const curBy = new Map(cur.map((r) => [key(r.level, r.entity_id), r]));
  const prevBy = new Map(prev.map((r) => [key(r.level, r.entity_id), r]));
  const meta = new Map(ents.map((e) => [key(e.level, e.entity_id), e]));
  const withReach = (m: OAMetrics, k: string): OAMetrics => {
    const r = reach.get(k);
    return { ...m, reach: r?.reach ?? null, frequency: r?.frequency ?? null };
  };
  const node = (level: string, id: string, name: string | null, status: string | null): OANode => {
    const raw = meta.get(key(level, id))?.raw || null;
    return {
      id,
      name,
      status,
      m: withReach(metricsOf(curBy.get(key(level, id))), key(level, id)),
      prev: compare ? metricsOf(prevBy.get(key(level, id))) : null,
      title: raw?.title ?? null,
      link: raw?.link ?? null,
      body: raw?.body ?? null,
      delivered: curBy.has(key(level, id)),
    };
  };
  // Entities = structure ∪ anything with delivery in range.
  const ids = (level: string) => new Set([...ents.filter((e) => e.level === level).map((e) => e.entity_id), ...cur.filter((r) => r.level === level).map((r) => r.entity_id)]);
  const parentC = (level: string, id: string) => meta.get(key(level, id))?.campaign_id || curBy.get(key(level, id))?.campaign_id || null;
  const parentG = (id: string) => meta.get(key("ad", id))?.ad_group_id || curBy.get(key("ad", id))?.ad_group_id || null;
  const campaigns: OACampaign[] = [...ids("campaign")].map((cid) => {
    const e = meta.get(key("campaign", cid));
    return { ...node("campaign", cid, e?.name ?? null, e?.status ?? null), ad_groups: [] };
  });
  const cBy = new Map(campaigns.map((c) => [c.id, c]));
  const orphanC = (): OACampaign => {
    let c = cBy.get("");
    if (!c) {
      c = { id: "", name: "(chưa rõ chiến dịch)", status: null, m: metricsOf(undefined), prev: null, ad_groups: [] };
      cBy.set("", c);
      campaigns.push(c);
    }
    return c;
  };
  const gBy = new Map<string, OACampaign["ad_groups"][number]>();
  for (const gid of ids("ad_group")) {
    const e = meta.get(key("ad_group", gid));
    const g = { ...node("ad_group", gid, e?.name ?? null, e?.status ?? null), ads: [] as OANode[] };
    gBy.set(gid, g);
    (cBy.get(parentC("ad_group", gid) || "") || orphanC()).ad_groups.push(g);
  }
  for (const aid of ids("ad")) {
    const e = meta.get(key("ad", aid));
    const gid = parentG(aid);
    let g = gid ? gBy.get(gid) : undefined;
    if (!g) {
      g = { id: gid || "", name: gid ? null : "(chưa rõ nhóm)", status: null, m: metricsOf(undefined), prev: null, ads: [] };
      gBy.set(g.id, g);
      (cBy.get(parentC("ad", aid) || "") || orphanC()).ad_groups.push(g);
    }
    g.ads.push(node("ad", aid, e?.name ?? null, e?.status ?? null));
  }
  const totalsRow = cur.find((r) => r.level === "account");
  const prevRow = prev.find((r) => r.level === "account");
  return {
    client_id: clientId,
    name: (st.name as string) ?? null,
    ad_account_id: (st.ad_account_id as string) ?? null,
    currency: (st.currency as string) ?? null,
    timezone: (st.timezone as string) ?? null,
    checked_at: st.checked_at instanceof Date ? st.checked_at.toISOString() : ((st.checked_at as string) ?? null),
    insights_through: ymd(st.insights_through),
    error: (st.error as string) ?? null,
    start,
    end,
    prev_start: prevStart,
    prev_end: prevEnd,
    totals: withReach(metricsOf(totalsRow), totalsRow ? key("account", totalsRow.entity_id) : [...reach.keys()].find((x) => x.startsWith("account|")) || ""),
    prev_totals: compare ? metricsOf(prevRow) : null,
    daily: daily.map((d) => ({ date: ymd(d.date) || "", spend: n(d.spend), impressions: n(d.impressions), clicks: n(d.clicks), conversions: n(d.conversions) })),
    campaigns: campaigns.sort((a, b) => (b.m.spend ?? -1) - (a.m.spend ?? -1) || (b.m.impressions ?? -1) - (a.m.impressions ?? -1)),
  };
}
