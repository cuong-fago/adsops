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

async function lastOptimizations(ids: string[]): Promise<Map<string, { last: string | null; pulled: string | null }>> {
  const out = new Map<string, { last: string | null; pulled: string | null }>();
  if (!ids.length) return out;
  try {
    const sql = await getSql();
    const rows = await sql.query<{ client_id: string; last: Date | string | null; pulled: Date | string | null }>(
      `select a.client_id,
         (select max(e.change_date_time) from ads_change_events e
           where e.client_id = a.client_id and e.action = any($2::text[])) as last,
         (select max(p.pulled_at) from ads_change_pulls p where p.client_id = a.client_id and p.ok) as pulled
       from unnest($1::text[]) as a(client_id)`,
      [ids, OPTIMIZED_ACTIONS],
    );
    for (const r of rows) out.set(r.client_id, { last: iso(r.last), pulled: iso(r.pulled) });
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
    };
  });
}
