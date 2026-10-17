/**
 * Monthly budget plan (AdsOps DB) + pacing from stored spend. No call to Google / Meta.
 * Google spend: adsops_analytics_warehouse payload daily.account; Facebook: meta_insights_daily (level account).
 * Month / "today" in Asia/Ho_Chi_Minh.
 */
import { getSql } from "@/lib/db";
import { addDaysYmd, ymdInTz } from "./warehouse.server.ts";
import { paceStatus, type BudgetPlan, type PacingRow } from "./budget-plan.types.ts";

const TZ = "Asia/Ho_Chi_Minh";
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const currentMonth = () => ymdInTz(TZ).slice(0, 7);
export function prevMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
}
const daysIn = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
const iso = (d: unknown) => (d == null ? null : (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10));
const n = (v: unknown) => (v == null ? null : Number(v));

function toPlan(r: Record<string, unknown>): BudgetPlan {
  return {
    client_id: String(r.client_id), month: String(r.month), planned_budget: Number(r.planned_budget),
    target_conv: n(r.target_conv), target_cpl: n(r.target_cpl), updated_by: (r.updated_by as string) || null,
    updated_at: r.updated_at ? (r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at)) : null,
  };
}

type Day = { client_id: string; date: string; cost: number; conv: number | null };

async function dailySpend(ids: string[], from: string, to: string): Promise<Map<string, Day[]>> {
  const sql = await getSql();
  const g = ids.filter((id) => !id.startsWith("fb_"));
  const f = ids.filter((id) => id.startsWith("fb_"));
  const out = new Map<string, Day[]>();
  const push = (d: Day) => { const l = out.get(d.client_id) || []; l.push(d); out.set(d.client_id, l); };
  if (g.length) {
    const rows = await sql.query<{ client_id: string; date: string; cost: unknown; conv: unknown }>(
      `select w.client_id, d->>'date' as date, (d->>'cost')::numeric as cost, (d->>'conversions')::numeric as conv
         from adsops_analytics_warehouse w, jsonb_array_elements(coalesce(w.payload->'daily'->'account', '[]'::jsonb)) d
        where w.client_id = any($1::text[]) and d->>'date' between $2 and $3`,
      [g, from, to],
    ).catch(() => []);
    for (const r of rows) push({ client_id: r.client_id, date: String(r.date), cost: Number(r.cost || 0), conv: r.conv == null ? null : Number(r.conv) });
  }
  if (f.length) {
    const rows = await sql.query<{ client_id: string; date: unknown; cost: unknown; leads: unknown; messages: unknown }>(
      `select client_id, date, spend as cost, leads, messages from meta_insights_daily
        where client_id = any($1::text[]) and level = 'account' and date between $2 and $3`,
      [f, from, to],
    ).catch(() => []);
    for (const r of rows) push({ client_id: r.client_id, date: iso(r.date)!, cost: Number(r.cost || 0), conv: r.leads != null ? Number(r.leads) : r.messages != null ? Number(r.messages) : null });
  }
  return out;
}

export async function readPlans(ids: string[], month: string): Promise<Map<string, BudgetPlan>> {
  if (!ids.length) return new Map();
  const sql = await getSql();
  const rows = await sql.query<Record<string, unknown>>(`select * from adsops_budget_plan where client_id = any($1::text[]) and month = $2`, [ids, month]).catch(() => []);
  return new Map(rows.map((r) => [String(r.client_id), toPlan(r)]));
}

export async function pacingFor(ids: string[], month: string, canEdit: (id: string) => boolean): Promise<PacingRow[]> {
  const dim = daysIn(month);
  const first = `${month}-01`;
  const last = `${month}-${String(dim).padStart(2, "0")}`;
  const today = ymdInTz(TZ);
  const to = last < today ? last : today;
  const [plans, days] = await Promise.all([readPlans(ids, month), dailySpend(ids, addDaysYmd(first, -7), to)]);
  return ids.map((id) => {
    const plan = plans.get(id) || null;
    const list = (days.get(id) || []).sort((a, b) => a.date.localeCompare(b.date));
    const inMonth = list.filter((d) => d.date >= first && d.date <= to);
    const isFb = id.startsWith("fb_");
    const base: PacingRow = {
      client_id: id, month, days_in_month: dim, data_through: null, days_elapsed: null, plan, mtd_spend: null, expected: null, pace: null,
      status: null, avg7: null, projected: null, remaining: null, daily_needed: null, mtd_conv: null,
      conv_label: isFb ? "Kết quả" : "Chuyển đổi", mtd_cpl: null, can_edit: canEdit(id),
    };
    if (!inMonth.length) return base;
    const through = inMonth[inMonth.length - 1].date;
    const elapsed = Number(through.slice(8, 10));
    const mtd = inMonth.reduce((s, d) => s + d.cost, 0);
    const convDays = inMonth.filter((d) => d.conv != null);
    const conv = convDays.length ? convDays.reduce((s, d) => s + (d.conv || 0), 0) : null;
    const win = list.filter((d) => d.date > addDaysYmd(through, -7) && d.date <= through);
    // Average over 7 calendar days only when all 7 are stored (missing ≠ 0).
    const avg7 = win.length === 7 ? win.reduce((s, d) => s + d.cost, 0) / 7 : null;
    const left = dim - elapsed;
    const expected = plan ? (plan.planned_budget * elapsed) / dim : null;
    const pace = expected && expected > 0 ? mtd / expected - 1 : null;
    return {
      ...base,
      data_through: through,
      days_elapsed: elapsed,
      mtd_spend: mtd,
      expected,
      pace,
      status: paceStatus(pace),
      avg7,
      projected: avg7 != null ? mtd + avg7 * left : null,
      remaining: plan ? plan.planned_budget - mtd : null,
      daily_needed: plan && left > 0 ? Math.max(0, plan.planned_budget - mtd) / left : null,
      mtd_conv: conv,
      mtd_cpl: conv && conv > 0 ? mtd / conv : null,
    };
  });
}

export async function savePlan(p: { client_id: string; month: string; planned_budget: number; target_conv: number | null; target_cpl: number | null }, by: string): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `insert into adsops_budget_plan (client_id, month, planned_budget, target_conv, target_cpl, updated_by) values ($1,$2,$3,$4,$5,$6)
     on conflict (client_id, month) do update set planned_budget = excluded.planned_budget, target_conv = excluded.target_conv,
       target_cpl = excluded.target_cpl, updated_by = excluded.updated_by, updated_at = now()`,
    [p.client_id, p.month, p.planned_budget, p.target_conv, p.target_cpl, by],
  );
}

export async function deletePlan(clientId: string, month: string): Promise<void> {
  const sql = await getSql();
  await sql.query(`delete from adsops_budget_plan where client_id = $1 and month = $2`, [clientId, month]);
}

/** Copy last month's plan into `month`. Returns false when last month has none. */
export async function copyPrevPlan(clientId: string, month: string, by: string): Promise<boolean> {
  const prev = (await readPlans([clientId], prevMonth(month))).get(clientId);
  if (!prev) return false;
  await savePlan({ client_id: clientId, month, planned_budget: prev.planned_budget, target_conv: prev.target_conv, target_cpl: prev.target_cpl }, by);
  return true;
}
