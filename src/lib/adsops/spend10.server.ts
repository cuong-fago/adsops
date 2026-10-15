/**
 * 10-day spend check (READ-ONLY GAQL). An ad account is "spending" when metrics.cost_micros > 0
 * on any day from today-9 to today (Asia/Saigon calendar, today included). Stored on ad_accounts
 * (migration 0016); account-activity.server.ts turns it into the hide / re-include rule.
 */
import { getSql } from "@/lib/db";
import { AdsApiError, type AdsConfig } from "./google-ads.server.ts";
import { addDaysYmd, customerIdFor, searchLeaf, ymdInTz } from "./warehouse.server.ts";

export const SPEND_WINDOW_DAYS = 10;
/** Re-check at most this often per account in background runs (manual recheck forces). */
const FRESH_MS = 20 * 60 * 60 * 1000;

export type Spend10Result = { client_id: string; ok: boolean; spend_micros: number | null; last_date: string | null; error: string | null };

export function spend10Query(today: string): string {
  const from = addDaysYmd(today, -(SPEND_WINDOW_DAYS - 1));
  return `SELECT segments.date, metrics.cost_micros FROM customer WHERE segments.date BETWEEN '${from}' AND '${today}'`;
}

export async function checkSpend10(clientId: string, cfg: AdsConfig): Promise<Spend10Result> {
  const id = clientId.trim();
  const customerId = customerIdFor(id);
  const sql = await getSql();
  if (customerId.length !== 10) return { client_id: id, ok: false, spend_micros: null, last_date: null, error: "Không suy ra Customer ID." };
  try {
    const rows = await searchLeaf(cfg, customerId, spend10Query(ymdInTz("Asia/Saigon")));
    let total = 0;
    let last: string | null = null;
    for (const r of rows) {
      const cost = Number((r.metrics as Record<string, unknown> | undefined)?.costMicros ?? 0) || 0;
      const date = String((r.segments as Record<string, unknown> | undefined)?.date ?? "");
      total += cost;
      if (cost > 0 && date && (!last || date > last)) last = date;
    }
    await sql
      .query(`update ad_accounts set spend10_micros = $2, spend10_last_date = $3, spend10_checked_at = now(), spend10_error = null where id = $1`, [id, total, last])
      .catch(() => null);
    return { client_id: id, ok: true, spend_micros: total, last_date: last, error: null };
  } catch (err) {
    const msg = err instanceof AdsApiError ? err.adminMessage : err instanceof Error ? err.message : String(err);
    if (err instanceof AdsApiError && err.kind === "CUSTOMER_NOT_ENABLED") {
      const { markNotEnabled } = await import("./account-activity.server.ts");
      await markNotEnabled(id);
    }
    // Keep the last good figure; only record the error.
    await sql.query(`update ad_accounts set spend10_checked_at = now(), spend10_error = $2 where id = $1`, [id, msg.slice(0, 500)]).catch(() => null);
    return { client_id: id, ok: false, spend_micros: null, last_date: null, error: msg };
  }
}

/** Accounts never checked first, then oldest; skips ones checked < 20 h ago unless `force`. */
export async function spend10Queue(ids: string[], force = false): Promise<string[]> {
  if (!ids.length) return [];
  const sql = await getSql();
  const at = new Map<string, number>();
  await sql
    .query<{ id: string; at: Date | string | null }>(`select id, spend10_checked_at as at from ad_accounts where id = any($1::text[])`, [ids])
    .then((r) => { for (const x of r) at.set(x.id, x.at ? Date.parse(x.at instanceof Date ? x.at.toISOString() : String(x.at)) : 0); })
    .catch(() => null);
  return [...new Set(ids)]
    .filter((id) => force || Date.now() - (at.get(id) || 0) >= FRESH_MS)
    .sort((a, b) => (at.get(a) || 0) - (at.get(b) || 0));
}

/** Evaluate many accounts, `n` at a time, until `deadline` (ms epoch). */
export async function refreshSpend10(ids: string[], cfg: AdsConfig, opts: { force?: boolean; deadline?: number; n?: number } = {}): Promise<Spend10Result[]> {
  const queue = await spend10Queue(ids, opts.force);
  const out: Spend10Result[] = [];
  let next = 0;
  const worker = async () => {
    while (next < queue.length && (!opts.deadline || Date.now() < opts.deadline)) {
      const id = queue[next++];
      out.push(await checkSpend10(id, cfg));
    }
  };
  await Promise.all(Array.from({ length: opts.n ?? 4 }, worker));
  return out;
}
