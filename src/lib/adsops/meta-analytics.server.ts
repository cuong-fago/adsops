/** Read Facebook analytics from Neon (no API call). */
import { getSql } from "@/lib/db";
import { addDaysYmd } from "./warehouse.server.ts";
import type { MetaAnalytics, MetaMetrics, MetaRow } from "./meta-ads.types.ts";

type Raw = { spend: unknown; impressions: unknown; clicks: unknown; leads: unknown; messages: unknown; lead_rows: unknown; msg_rows: unknown };
const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const iso = (v: unknown) => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));

function metrics(r: Raw | undefined): MetaMetrics {
  const spend = n(r?.spend);
  const impressions = n(r?.impressions);
  const clicks = n(r?.clicks);
  const leads = n(r?.lead_rows) > 0 ? n(r?.leads) : null;
  const messages = n(r?.msg_rows) > 0 ? n(r?.messages) : null;
  return {
    spend, impressions, clicks, leads, messages,
    ctr: impressions > 0 ? clicks / impressions : null,
    cpc: clicks > 0 ? spend / clicks : null,
    cpl: leads && leads > 0 ? spend / leads : null,
  };
}
const AGG = `sum(spend) as spend, sum(impressions) as impressions, sum(clicks) as clicks,
  sum(leads) as leads, count(leads) as lead_rows, sum(messages) as messages, count(messages) as msg_rows`;

export async function readMetaAnalytics(clientId: string, start: string, end: string, withPrev: boolean): Promise<MetaAnalytics> {
  const sql = await getSql();
  const sum = async (a: string, b: string) =>
    (await sql.query<Raw>(`select ${AGG} from meta_insights_daily where client_id = $1 and level = 'account' and date between $2 and $3`, [clientId, a, b]))[0];
  const daily = await sql.query<Raw & { date: unknown }>(
    `select date, ${AGG} from meta_insights_daily where client_id = $1 and level = 'account' and date between $2 and $3 group by date order by date`,
    [clientId, start, end],
  );
  const rowsAt = async (level: "campaign" | "adset"): Promise<MetaRow[]> => {
    const r = await sql.query<Raw & { id: string; name: string | null; campaign_name: string | null }>(
      `select object_id as id, max(${level === "campaign" ? "campaign_name" : "adset_name"}) as name, max(campaign_name) as campaign_name, ${AGG}
         from meta_insights_daily where client_id = $1 and level = $2 and date between $3 and $4
        group by object_id order by sum(spend) desc`,
      [clientId, level, start, end],
    );
    return r.map((x) => ({ id: x.id, name: x.name || x.id, campaign_name: level === "adset" ? x.campaign_name : null, ...metrics(x) }));
  };
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
  const prevRange = withPrev ? { start: addDaysYmd(start, -days), end: addDaysYmd(start, -1) } : null;
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
    prev: prevRange ? metrics(await sum(prevRange.start, prevRange.end)) : null,
    prev_range: prevRange,
    daily: daily.map((d) => ({ date: iso(d.date) as string, ...metrics(d) })),
    campaigns: await rowsAt("campaign"),
    adsets: await rowsAt("adset"),
    state: st ? { account_status: st.account_status, checked_at: st.checked_at ? (st.checked_at instanceof Date ? st.checked_at.toISOString() : String(st.checked_at)) : null, error: st.error } : null,
  };
}
