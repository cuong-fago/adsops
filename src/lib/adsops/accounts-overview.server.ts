/** "Tổng quan tài khoản": joins the stored budget runway, optimization score and change log. */
import { getSql } from "@/lib/db";
import { readBudgetRunway } from "./budget-runway.server.ts";
import { readOptimizationScores } from "./optimization-score.server.ts";
import type { OverviewRow } from "./accounts-overview.types.ts";
import { OPTIMIZED_ACTIONS } from "./change-log.types.ts";

type Acc = { client_id: string; label: string; customer_id_dashed: string };

function iso(v: Date | string | null): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

type Opt = { last: string | null; pulled: string | null; lastOk: boolean | null; lastErr: string | null; lastAt: string | null };

async function lastOptimizations(ids: string[]): Promise<Map<string, Opt>> {
  const out = new Map<string, Opt>();
  if (!ids.length) return out;
  try {
    const sql = await getSql();
    const rows = await sql.query<{
      client_id: string; last: Date | string | null; pulled: Date | string | null;
      last_ok: boolean | null; last_err: string | null; last_at: Date | string | null;
    }>(
      `select a.client_id,
         (select max(e.change_date_time) from ads_change_events e
           where e.client_id = a.client_id and e.action = any($2::text[])) as last,
         (select max(p.pulled_at) from ads_change_pulls p where p.client_id = a.client_id and p.ok) as pulled,
         l.ok as last_ok, l.error_vi as last_err, l.pulled_at as last_at
       from unnest($1::text[]) as a(client_id)
       left join lateral (select ok, error_vi, pulled_at from ads_change_pulls p
                          where p.client_id = a.client_id order by pulled_at desc limit 1) l on true`,
      [ids, OPTIMIZED_ACTIONS],
    );
    for (const r of rows) {
      out.set(r.client_id, { last: iso(r.last), pulled: iso(r.pulled), lastOk: r.last_ok, lastErr: r.last_err, lastAt: iso(r.last_at) });
    }
  } catch {
    /* change-log tables missing: leave empty ("—") */
  }
  return out;
}

/** Caller has already filtered `accounts` to what the viewer may see. */
export async function readAccountsOverview(accounts: Acc[]): Promise<OverviewRow[]> {
  const [runway, scores, opt] = await Promise.all([
    readBudgetRunway(accounts),
    readOptimizationScores(accounts),
    lastOptimizations(accounts.map((a) => a.client_id)),
  ]);
  const rw = new Map(runway.map((r) => [r.client_id, r]));
  const sc = new Map(scores.map((r) => [r.client_id, r]));
  return accounts.map((a) => {
    const r = rw.get(a.client_id);
    const s = sc.get(a.client_id);
    const o = opt.get(a.client_id);
    return {
      ...a,
      runway: {
        checked_at: r?.checked_at ?? null,
        kind: r?.kind ?? null,
        runway_days: r?.runway_days ?? null,
        status: r?.status ?? null,
        expiring: Boolean(r?.expiring),
        budget_end: r?.budget_end ?? null,
        infinite: Boolean(r?.infinite),
        error_vi: r?.error_vi ?? null,
      },
      score: { checked_at: s?.checked_at ?? null, score: s?.score ?? null, d1: s?.d1 ?? null, error_vi: s?.error_vi ?? null },
      last_opt_at: o?.last ?? null,
      change_pulled_at: o?.pulled ?? null,
      change_last_ok: o?.lastOk ?? null,
      change_last_error: o?.lastErr ?? null,
      change_last_at: o?.lastAt ?? null,
    };
  });
}

/** Per-account cost today / last 7 stored days + conversions, from adsops_analytics_warehouse (stored only). */
export async function readAccountKpis(ids: string[]): Promise<Record<string, import("./accounts-overview.types.ts").AccountKpi>> {
  const out: Record<string, import("./accounts-overview.types.ts").AccountKpi> = {};
  if (!ids.length) return out;
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  let rows: Array<{ client_id: string; currency: string | null; daily: unknown }> = [];
  try {
    rows = await sql.query(
      `select client_id, payload->>'currency' as currency, payload->'daily'->'account' as daily
         from adsops_analytics_warehouse where client_id = any($1::text[])`,
      [ids],
    );
  } catch {
    return out;
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Saigon" }).format(new Date());
  for (const r of rows) {
    const daily = (typeof r.daily === "string" ? JSON.parse(r.daily) : r.daily) as Array<{ date?: string; cost?: number; conversions?: number }> | null;
    if (!Array.isArray(daily) || !daily.length) continue;
    const by = new Map<string, { cost: number; conv: number }>();
    for (const d of daily) {
      if (!d?.date) continue;
      const cur = by.get(d.date) || { cost: 0, conv: 0 };
      cur.cost += Number(d.cost || 0);
      cur.conv += Number(d.conversions || 0);
      by.set(d.date, cur);
    }
    const dates = [...by.keys()].sort();
    const end = dates[dates.length - 1] || null;
    // Window = 7 calendar days ending at the latest stored complete day (today excluded).
    const lastFull = dates.filter((d) => d < today).pop() || null;
    let d7_cost: number | null = null;
    let d7_conv: number | null = null;
    if (lastFull) {
      const start = new Date(Date.parse(`${lastFull}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
      const win = dates.filter((d) => d >= start && d <= lastFull);
      if (win.length) {
        d7_cost = win.reduce((t, d) => t + by.get(d)!.cost, 0);
        d7_conv = win.reduce((t, d) => t + by.get(d)!.conv, 0);
      }
    }
    out[r.client_id] = { currency: r.currency, end: lastFull ?? end, today_cost: by.has(today) ? by.get(today)!.cost : null, d7_cost, d7_conv };
  }
  return out;
}
