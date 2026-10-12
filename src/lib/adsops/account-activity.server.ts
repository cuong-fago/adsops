/**
 * Account activity from stored data only (no Google call):
 * - ad_accounts.google_status (MCC pull, customer_client.status)
 * - ads_budget_runway.avg7_micros (7 full days of spend, stored by the budget check)
 * Unknown (no data) counts as active: we never hide what we know nothing about.
 */
import { getSql } from "@/lib/db";
import { INACTIVE_GOOGLE, type AccountActivity } from "./account-activity.types.ts";

export async function readActivity(ids: string[]): Promise<Map<string, AccountActivity>> {
  const out = new Map<string, AccountActivity>();
  const uniq = [...new Set(ids)];
  const status = new Map<string, string>();
  const avg = new Map<string, number | null>();
  if (uniq.length) {
    const sql = await getSql();
    try {
      const r = await sql.query<{ id: string; google_status: string | null }>(
        `select id, google_status from ad_accounts where id = any($1::text[])`,
        [uniq],
      );
      for (const x of r) if (x.google_status) status.set(x.id, x.google_status.toUpperCase());
    } catch {
      /* migration 0015 not applied yet */
    }
    try {
      const r = await sql.query<{ client_id: string; avg7_micros: string | number | null; checked_at: Date | string }>(
        `select client_id, avg7_micros, checked_at from ads_budget_runway where client_id = any($1::text[])`,
        [uniq],
      );
      for (const x of r) {
        // Only trust a spend figure from the last 3 days.
        const fresh = Date.now() - Date.parse(x.checked_at instanceof Date ? x.checked_at.toISOString() : String(x.checked_at)) < 3 * 86_400_000;
        avg.set(x.client_id, fresh && x.avg7_micros != null ? Number(x.avg7_micros) / 1e6 : null);
      }
    } catch {
      /* table missing */
    }
  }
  for (const id of uniq) {
    const gs = status.get(id) || null;
    const a7 = avg.has(id) ? (avg.get(id) as number | null) : null;
    let act: AccountActivity;
    if (gs && INACTIVE_GOOGLE.has(gs)) act = { state: "inactive", reason: "Google tạm ngưng / đã huỷ", google_status: gs, avg7: a7 };
    else if (a7 != null && a7 <= 0) act = { state: "inactive", reason: "Không chi tiêu 7 ngày", google_status: gs, avg7: a7 };
    else if (gs === "ENABLED" && a7 != null) act = { state: "active", reason: null, google_status: gs, avg7: a7 };
    else act = { state: "unknown", reason: null, google_status: gs, avg7: a7 };
    out.set(id, act);
  }
  return out;
}

/** Background checks and crons: drop accounts known to be inactive (manual buttons still work). */
export async function activeOnly(ids: string[]): Promise<string[]> {
  const m = await readActivity(ids).catch(() => new Map<string, AccountActivity>());
  return ids.filter((id) => m.get(id)?.state !== "inactive");
}
