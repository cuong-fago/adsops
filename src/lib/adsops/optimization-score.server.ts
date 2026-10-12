/**
 * Google Ads optimization score: READ-ONLY GAQL through searchLeaf (per-account
 * login-customer-id). One row per account per day (account timezone) in Neon
 * `ads_optimization_score`; the latest check of the day wins.
 */
import { getSql } from "@/lib/db";
import { AdsApiError, resolveAdsConfig, type AdsConfig } from "./google-ads.server.ts";
import { acquireLock, addDaysYmd, asRec, customerIdFor, releaseLock, searchLeaf, ymdInTz } from "./warehouse.server.ts";
import type { ScoreCheckResult, ScorePoint, ScoreRow } from "./optimization-score.types.ts";

const CLIENT_ID_RE = /^[a-z0-9_]+$/;

export const OPTIMIZATION_SCORE_QUERY =
  "SELECT customer.id, customer.time_zone, customer.optimization_score, customer.optimization_score_weight FROM customer";

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function upsert(externalId: string, clientId: string, date: string, score: number | null, weight: number | null, error: string | null) {
  const sql = await getSql();
  if (error) {
    // A failed check never wipes a score already stored for that day.
    await sql.query(
      `insert into ads_optimization_score (external_id, date, client_id, score, weight, checked_at, error)
       values ($1, $2::date, $3, null, null, now(), $4)
       on conflict (external_id, date) do update set checked_at = now(), error = excluded.error, client_id = excluded.client_id`,
      [externalId, date, clientId, error],
    );
    return;
  }
  await sql.query(
    `insert into ads_optimization_score (external_id, date, client_id, score, weight, checked_at, error)
     values ($1, $2::date, $3, $4::numeric, $5::numeric, now(), null)
     on conflict (external_id, date) do update set
       score = excluded.score, weight = excluded.weight, checked_at = now(), error = null, client_id = excluded.client_id`,
    [externalId, date, clientId, score, weight],
  );
}

/** Read the score for one account (1 read-only query) and store today's row. */
export async function checkOptimizationScore(clientId: string, cfgIn?: AdsConfig): Promise<ScoreCheckResult> {
  const id = clientId.trim();
  const fail = (msg: string): ScoreCheckResult => ({ ok: false, client_id: id, score: null, error_vi: msg });
  if (!CLIENT_ID_RE.test(id)) return fail("Tài khoản không hợp lệ.");
  const customerId = customerIdFor(id);
  if (customerId.length !== 10) return fail("Không suy ra Customer ID từ tài khoản.");
  const cfg = cfgIn || (await resolveAdsConfig());
  if (!cfg.ready) return fail(`Chưa cấu hình Google Ads API. Thiếu: ${cfg.missing.map((m) => m.label_vi).join(" ")}`);
  try {
    const rows = await searchLeaf(cfg, customerId, OPTIMIZATION_SCORE_QUERY);
    const c = asRec(rows[0]?.customer);
    const tz = typeof c.timeZone === "string" && c.timeZone ? c.timeZone : "Asia/Saigon";
    const score = numOrNull(c.optimizationScore);
    const weight = numOrNull(c.optimizationScoreWeight);
    await upsert(customerId, id, ymdInTz(tz), score, weight, null);
    return { ok: true, client_id: id, score, error_vi: null };
  } catch (err) {
    const msg = err instanceof AdsApiError ? err.adminMessage : err instanceof Error && err.message ? err.message : "Không đọc được điểm tối ưu.";
    await upsert(customerId, id, ymdInTz("Asia/Saigon"), null, null, msg.slice(0, 500)).catch(() => null);
    return fail(msg);
  }
}

type DbRow = { external_id: string; date: string; score: string | number | null; checked_at: Date | string; error: string | null };

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

/** Stored history (last ~40 days) → one row per account. Caller has checked access. */
export async function readOptimizationScores(
  accounts: Array<{ client_id: string; label: string; customer_id_dashed: string }>,
): Promise<ScoreRow[]> {
  const ext = new Map(accounts.map((a) => [a.client_id, customerIdFor(a.client_id)]));
  const ids = [...new Set([...ext.values()].filter((x) => x.length === 10))];
  let rows: DbRow[] = [];
  if (ids.length) {
    try {
      const sql = await getSql();
      rows = await sql.query<DbRow>(
        `select external_id, to_char(date, 'YYYY-MM-DD') as date, score, checked_at, error
         from ads_optimization_score where external_id = any($1::text[]) and date >= current_date - 45
         order by date`,
        [ids],
      );
    } catch {
      /* migration not applied yet */
    }
  }
  const by = new Map<string, DbRow[]>();
  for (const r of rows) {
    const list = by.get(r.external_id) || [];
    list.push(r);
    by.set(r.external_id, list);
  }
  return accounts.map((a) => {
    const hist = by.get(ext.get(a.client_id) || "") || [];
    const last = hist[hist.length - 1];
    const scoreAt = new Map(hist.map((h) => [h.date, numOrNull(h.score)]));
    const latest = last ? numOrNull(last.score) : null;
    const delta = (n: number) => {
      if (!last || latest == null) return null;
      const before = scoreAt.get(addDaysYmd(last.date, -n));
      return before == null ? null : latest - before;
    };
    const series: ScorePoint[] = hist.slice(-30).map((h) => ({ date: h.date, score: numOrNull(h.score) }));
    return {
      client_id: a.client_id,
      label: a.label,
      customer_id_dashed: a.customer_id_dashed,
      date: last?.date ?? null,
      score: latest,
      checked_at: last ? iso(last.checked_at) : null,
      error_vi: last?.error ?? null,
      d1: delta(1),
      d7: delta(7),
      d30: delta(30),
      series,
    };
  });
}

/** Cron order: never-checked accounts first, then oldest check. */
export async function scoreCronQueue(ids: string[]): Promise<string[]> {
  const last = new Map<string, number>();
  try {
    const sql = await getSql();
    const ext = ids.map((id) => customerIdFor(id));
    const r = await sql.query<{ external_id: string; at: Date | string }>(
      `select external_id, max(checked_at) as at from ads_optimization_score where external_id = any($1::text[]) group by external_id`,
      [ext],
    );
    for (const x of r) last.set(x.external_id, Date.parse(iso(x.at)) || 0);
  } catch {
    /* table missing: keep given order */
  }
  return [...new Set(ids)].sort((a, b) => (last.get(customerIdFor(a)) ?? -1) - (last.get(customerIdFor(b)) ?? -1));
}

// ── on-view refresh of ONE account (read-only cache fill) ────────────────────────

const COOLDOWN_S = 30 * 60;

async function lockRowActive(key: string): Promise<boolean> {
  try {
    const sql = await getSql();
    const r = await sql.query<{ on: boolean }>(`select locked_until > now() as on from adsops_ads_refresh_lock where client_id = $1`, [key]);
    return Boolean(r[0]?.on);
  } catch {
    return false;
  }
}

async function startCooldown(key: string): Promise<void> {
  try {
    const sql = await getSql();
    await sql.query(
      `insert into adsops_ads_refresh_lock (client_id, locked_until) values ($1, now() + ($2 || ' seconds')::interval)
       on conflict (client_id) do update set locked_until = excluded.locked_until`,
      [key, String(COOLDOWN_S)],
    );
  } catch {
    /* ignore */
  }
}

export type ScoreRefreshResult = { state: "fresh" | "busy" | "cooldown" | "refreshed" | "error" };

/**
 * Check one account when today's score is not stored yet. Guards: Neon lock
 * `<client>:optscore` (one in flight), cooldown row `<client>:optscore:autofail`
 * for 30 min after a failure, nothing if checked < 30 min ago.
 */
export async function refreshScoreIfStale(clientId: string): Promise<ScoreRefreshResult> {
  const id = clientId.trim();
  const ext = customerIdFor(id);
  if (!CLIENT_ID_RE.test(id) || ext.length !== 10) return { state: "error" };
  let last: { date: string; checked_at: string; error: string | null } | null = null;
  try {
    const sql = await getSql();
    const r = await sql.query<{ date: string; checked_at: Date | string; error: string | null }>(
      `select to_char(date, 'YYYY-MM-DD') as date, checked_at, error from ads_optimization_score
       where external_id = $1 order by date desc limit 1`,
      [ext],
    );
    if (r[0]) last = { date: r[0].date, checked_at: iso(r[0].checked_at), error: r[0].error };
  } catch {
    return { state: "error" }; // table missing: nothing to fill
  }
  const age = last ? Date.now() - Date.parse(last.checked_at) : Infinity;
  if (age < COOLDOWN_S * 1000) return { state: "fresh" };
  // "Today" in Asia/Saigon (the stored date is the account's own day; VN accounts match).
  if (last && !last.error && last.date >= ymdInTz("Asia/Saigon")) return { state: "fresh" };
  const failKey = `${id}:optscore:autofail`;
  if (await lockRowActive(failKey)) return { state: "cooldown" };
  const lockKey = `${id}:optscore`;
  if (!(await acquireLock(lockKey, 60))) return { state: "busy" };
  try {
    const r = await checkOptimizationScore(id);
    if (!r.ok) {
      await startCooldown(failKey);
      return { state: "error" };
    }
    return { state: "refreshed" };
  } finally {
    await releaseLock(lockKey);
  }
}
