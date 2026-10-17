/** Business outcomes (AdsOps DB only) + spend / platform leads from stored ad data. No ad-platform calls. */
import { getSql } from "@/lib/db";
import { dailySpend, readPlans } from "./budget-plan.server.ts";
import { bizMetrics, type BizMetrics, type OutcomeEntry } from "./outcomes.types.ts";

const iso = (d: unknown) => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));
const num = (v: unknown) => (v == null ? null : Number(v));

export function lastMonths(end: string, n: number): string[] {
  const out: string[] = [];
  let [y, m] = end.split("-").map(Number);
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1; if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}
const lastDay = (month: string) => { const [y, m] = month.split("-").map(Number); return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; };

export async function readEntries(ids: string[], months: string[]): Promise<OutcomeEntry[]> {
  if (!ids.length || !months.length) return [];
  const sql = await getSql();
  const rows = await sql.query<Record<string, unknown>>(
    `select * from adsops_outcomes where client_id = any($1::text[]) and month = any($2::text[]) order by month, campaign`, [ids, months],
  ).catch(() => []);
  return rows.map((r) => ({
    client_id: String(r.client_id), month: String(r.month), campaign: String(r.campaign || ""),
    valid_leads: num(r.valid_leads), closed_customers: num(r.closed_customers), revenue: num(r.revenue),
    note: (r.note as string) || null, updated_by: (r.updated_by as string) || null, updated_at: iso(r.updated_at),
  }));
}

/** Account total for a month: the "" row if entered, else the sum of campaign rows (per field; null stays null). */
export function accountOutcome(entries: OutcomeEntry[], id: string, month: string) {
  const rows = entries.filter((e) => e.client_id === id && e.month === month);
  if (!rows.length) return null;
  const total = rows.find((e) => e.campaign === "");
  if (total) return total;
  const sum = (k: "valid_leads" | "closed_customers" | "revenue") => {
    const v = rows.map((r) => r[k]).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) : null;
  };
  return { valid_leads: sum("valid_leads"), closed_customers: sum("closed_customers"), revenue: sum("revenue") };
}

/** Spend + platform leads per account per month (stored data; null when nothing stored). */
export async function monthlyAds(ids: string[], months: string[]): Promise<Map<string, { spend: number | null; leads: number | null }>> {
  const out = new Map<string, { spend: number | null; leads: number | null }>();
  if (!ids.length || !months.length) return out;
  const days = await dailySpend(ids, `${months[0]}-01`, lastDay(months[months.length - 1]));
  for (const id of ids) {
    for (const m of months) {
      const list = (days.get(id) || []).filter((d) => d.date.startsWith(m));
      const conv = list.filter((d) => d.conv != null);
      out.set(`${id}|${m}`, { spend: list.length ? list.reduce((s, d) => s + d.cost, 0) : null, leads: conv.length ? conv.reduce((s, d) => s + (d.conv || 0), 0) : null });
    }
  }
  return out;
}

export async function seriesFor(ids: string[], months: string[]) {
  const [entries, ads] = await Promise.all([readEntries(ids, months), monthlyAds(ids, months)]);
  const per = (id: string): BizMetrics[] => months.map((m) => { const a = ads.get(`${id}|${m}`); return bizMetrics(m, a?.spend ?? null, a?.leads ?? null, accountOutcome(entries, id, m)); });
  /** Blended over accounts: spend / leads summed; outcome sums only when every account has an outcome. */
  const blended = (list: string[]): { series: BizMetrics[]; missing: Record<string, string[]> } => {
    const missing: Record<string, string[]> = {};
    const series = months.map((m) => {
      let spend: number | null = null, leads: number | null = null;
      const outs = list.map((id) => accountOutcome(entries, id, m));
      for (const id of list) { const a = ads.get(`${id}|${m}`); if (a?.spend != null) spend = (spend || 0) + a.spend; if (a?.leads != null) leads = (leads || 0) + a.leads; }
      const miss = list.filter((_, i) => !outs[i]);
      if (miss.length) missing[m] = miss;
      const all = !miss.length;
      const sum = (k: "valid_leads" | "closed_customers" | "revenue") => {
        if (!all) return null;
        const v = outs.map((o) => o![k]);
        return v.some((x) => x == null) ? null : (v as number[]).reduce((a, b) => a + b, 0);
      };
      return bizMetrics(m, spend, leads, all ? { valid_leads: sum("valid_leads"), closed_customers: sum("closed_customers"), revenue: sum("revenue") } : null);
    });
    return { series, missing };
  };
  return { entries, per, blended };
}

/** Client group = the existing customers mapping (ad_accounts.customer_id, edited in Quản trị). */
export async function groupOf(clientId: string): Promise<{ id: string; name: string; members: string[] } | null> {
  const sql = await getSql();
  const r = await sql.query<{ customer_id: string | null; name: string | null }>(
    `select a.customer_id, c.name from ad_accounts a left join customers c on c.id = a.customer_id where a.id = $1`, [clientId],
  ).catch(() => []);
  const gid = r[0]?.customer_id;
  if (!gid) return null;
  const mem = await sql.query<{ id: string }>(`select id from ad_accounts where customer_id = $1`, [gid]).catch(() => []);
  return { id: gid, name: r[0]?.name || gid, members: mem.map((x) => x.id) };
}

export async function targetsFor(clientId: string, month: string) {
  const p = (await readPlans([clientId], month)).get(clientId);
  return p ? { target_cpl: p.target_cpl, target_cac: p.target_cac, target_roas: p.target_roas } : null;
}

export async function upsertOutcome(e: { client_id: string; month: string; campaign: string; valid_leads: number | null; closed_customers: number | null; revenue: number | null; note: string | null }, by: string): Promise<"insert" | "update"> {
  const sql = await getSql();
  const r = await sql.query<{ ins: boolean }>(
    `insert into adsops_outcomes (client_id, month, campaign, valid_leads, closed_customers, revenue, note, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (client_id, month, campaign) do update set valid_leads = excluded.valid_leads, closed_customers = excluded.closed_customers,
       revenue = excluded.revenue, note = excluded.note, updated_by = excluded.updated_by, updated_at = now()
     returning (xmax = 0) as ins`,
    [e.client_id, e.month, e.campaign, e.valid_leads, e.closed_customers, e.revenue, e.note, by],
  );
  return r[0]?.ins ? "insert" : "update";
}

export async function deleteOutcome(clientId: string, month: string, campaign: string): Promise<void> {
  const sql = await getSql();
  await sql.query(`delete from adsops_outcomes where client_id = $1 and month = $2 and campaign = $3`, [clientId, month, campaign]);
}

export async function existingKeys(keys: { client_id: string; month: string; campaign: string }[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const sql = await getSql();
  const ids = [...new Set(keys.map((k) => k.client_id))];
  const rows = await sql.query<{ client_id: string; month: string; campaign: string }>(
    `select client_id, month, campaign from adsops_outcomes where client_id = any($1::text[])`, [ids],
  ).catch(() => []);
  return new Set(rows.map((r) => `${r.client_id}|${r.month}|${r.campaign}`));
}
