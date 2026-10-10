/**
 * "Ngân sách còn lại": READ-ONLY GAQL (SELECT) per account through searchLeaf.
 * - account_budget (only exists for invoiced / consolidated-billing accounts):
 *   remaining = adjusted (or approved) spending limit - amount_served.
 * - Prepaid / manual / automatic payments: Google does not expose a balance; nothing is estimated.
 * Latest result per account is stored in Neon `ads_budget_runway`.
 */
import { getSql } from "@/lib/db";
import { AdsApiError, resolveAdsConfig, type AdsConfig, type GaqlRow } from "./google-ads.server.ts";
import { addDaysYmd, asRec, customerIdFor, pullMeta, searchLeaf, ymdInTz } from "./warehouse.server.ts";
import { EXPIRY_WARN_DAYS, runwayStatus, type RunwayCheckResult, type RunwayRow, type RunwayStatus } from "./budget-runway.types.ts";

const CLIENT_ID_RE = /^[a-z0-9_]+$/;

export const ACCOUNT_BUDGET_QUERY = `SELECT account_budget.resource_name, account_budget.status,
    account_budget.approved_spending_limit_micros, account_budget.approved_spending_limit_type,
    account_budget.adjusted_spending_limit_micros, account_budget.adjusted_spending_limit_type,
    account_budget.amount_served_micros, account_budget.total_adjustments_micros,
    account_budget.approved_start_date_time, account_budget.approved_end_date_time, account_budget.approved_end_time_type
  FROM account_budget
  WHERE account_budget.status = 'APPROVED'`;

export function spendQuery(start: string, end: string): string {
  return `SELECT segments.date, metrics.cost_micros FROM customer WHERE segments.date BETWEEN '${start}' AND '${end}'`;
}

/** "YYYY-MM-DD HH:mm:ss" now in `tz` (same format as approved_*_date_time). */
function nowLocal(tz: string): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value || "00";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}:${g("second")}`;
}

function micros(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type Budget = {
  infinite: boolean;
  limit: number | null;
  served: number | null;
  start: string | null;
  end: string | null;
  raw: unknown;
};

/** Pure: pick the approved budget active now (start <= now < end, or no end). */
export function pickActiveBudget(rows: GaqlRow[], now: string): Budget | null {
  const list = rows.map((r) => asRec(r.accountBudget)).filter((b) => String(b.status || "") === "APPROVED");
  const active = list.filter((b) => {
    const start = String(b.approvedStartDateTime || "");
    const end = String(b.approvedEndDateTime || "");
    const forever = String(b.approvedEndTimeType || "") === "FOREVER" || !end;
    return (!start || start <= now) && (forever || now < end);
  });
  if (!active.length) return null;
  active.sort((a, b) => String(b.approvedStartDateTime || "").localeCompare(String(a.approvedStartDateTime || "")));
  const b = active[0];
  const infinite =
    String(b.adjustedSpendingLimitType || "") === "INFINITE" || String(b.approvedSpendingLimitType || "") === "INFINITE";
  // Adjusted limit already includes adjustments (credits); fall back to approved.
  const limit = infinite ? null : micros(b.adjustedSpendingLimitMicros) ?? micros(b.approvedSpendingLimitMicros);
  const forever = String(b.approvedEndTimeType || "") === "FOREVER";
  return {
    infinite,
    limit,
    served: micros(b.amountServedMicros) ?? 0,
    start: b.approvedStartDateTime ? String(b.approvedStartDateTime) : null,
    end: !forever && b.approvedEndDateTime ? String(b.approvedEndDateTime) : null,
    raw: b,
  };
}

/** Pure: average daily spend (micros) over the given days. Days without a row spent nothing. */
export function averageDaily(rows: GaqlRow[], days: string[]): number {
  const by = new Map<string, number>();
  for (const r of rows) {
    const d = String(asRec(r.segments).date || "");
    by.set(d, (by.get(d) || 0) + (micros(asRec(r.metrics).costMicros) || 0));
  }
  const total = days.reduce((s, d) => s + (by.get(d) || 0), 0);
  return days.length ? total / days.length : 0;
}

async function store(row: {
  clientId: string;
  customerId: string;
  ok: boolean;
  kind: string;
  currency: string | null;
  limit: number | null;
  served: number | null;
  remaining: number | null;
  infinite: boolean;
  avg7: number | null;
  avg3: number | null;
  days: number | null;
  start: string | null;
  end: string | null;
  status: RunwayStatus;
  expiring: boolean;
  error: string | null;
  raw: unknown;
}): Promise<void> {
  const sql = await getSql();
  const r = (v: number | null) => (v == null ? null : Math.round(v));
  await sql.query(
    `insert into ads_budget_runway (client_id, external_id, checked_at, ok, kind, currency, limit_micros, served_micros, remaining_micros,
       infinite, avg7_micros, avg3_micros, runway_days, budget_start, budget_end, status, expiring, error_vi, raw)
     values ($1, $2, now(), $3, $4, $5, $6::bigint, $7::bigint, $8::bigint, $9, $10::bigint, $11::bigint, $12::double precision, $13, $14, $15, $16, $17, $18::jsonb)
     on conflict (client_id) do update set
       external_id = excluded.external_id, checked_at = excluded.checked_at, ok = excluded.ok, kind = excluded.kind,
       currency = excluded.currency, limit_micros = excluded.limit_micros, served_micros = excluded.served_micros,
       remaining_micros = excluded.remaining_micros, infinite = excluded.infinite, avg7_micros = excluded.avg7_micros,
       avg3_micros = excluded.avg3_micros, runway_days = excluded.runway_days, budget_start = excluded.budget_start,
       budget_end = excluded.budget_end, status = excluded.status, expiring = excluded.expiring,
       error_vi = excluded.error_vi, raw = excluded.raw`,
    [
      row.clientId, row.customerId, row.ok, row.kind, row.currency, r(row.limit), r(row.served), r(row.remaining),
      row.infinite, r(row.avg7), r(row.avg3), row.days, row.start, row.end, row.status, row.expiring, row.error,
      JSON.stringify(row.raw ?? null),
    ],
  );
}

/** Check one account (3 read-only queries) and store the result. */
export async function checkBudgetRunway(clientId: string, cfgIn?: AdsConfig): Promise<RunwayCheckResult> {
  const id = clientId.trim();
  const fail = (msg: string): RunwayCheckResult => ({ ok: false, client_id: id, status: "error", error_vi: msg });
  if (!CLIENT_ID_RE.test(id)) return fail("Tài khoản không hợp lệ.");
  const customerId = customerIdFor(id);
  if (customerId.length !== 10) return fail("Không suy ra Customer ID từ tài khoản.");
  const cfg = cfgIn || (await resolveAdsConfig());
  if (!cfg.ready) return fail(`Chưa cấu hình Google Ads API. Thiếu: ${cfg.missing.map((m) => m.label_vi).join(" ")}`);
  try {
    const meta = await pullMeta(cfg, customerId, id);
    const tz = meta.timezone || "Asia/Saigon";
    const today = ymdInTz(tz);
    const days7 = Array.from({ length: 7 }, (_, i) => addDaysYmd(today, -(i + 1)));
    const days3 = days7.slice(0, 3);
    const [budgets, spend] = await Promise.all([
      searchLeaf(cfg, customerId, ACCOUNT_BUDGET_QUERY),
      searchLeaf(cfg, customerId, spendQuery(days7[6], days7[0])),
    ]);
    const avg7 = averageDaily(spend, days7);
    const avg3 = averageDaily(spend, days3);
    const now = nowLocal(tz);
    const b = pickActiveBudget(budgets, now);
    const remaining = b && !b.infinite && b.limit != null ? b.limit - (b.served || 0) : null;
    const { status, days } = b ? runwayStatus({ infinite: b.infinite, remaining, avg: avg7 }) : { status: "no_budget" as const, days: null };
    const warnEnd = `${addDaysYmd(today, EXPIRY_WARN_DAYS)} 23:59:59`;
    const expiring = Boolean(b?.end && b.end <= warnEnd);
    await store({
      clientId: id,
      customerId,
      ok: true,
      kind: b ? "account_budget" : "no_budget",
      currency: meta.currency || null,
      limit: b?.limit ?? null,
      served: b ? b.served : null,
      remaining,
      infinite: Boolean(b?.infinite),
      avg7,
      avg3,
      days,
      start: b?.start ?? null,
      end: b?.end ?? null,
      status,
      expiring,
      error: null,
      raw: b?.raw ?? null,
    });
    return { ok: true, client_id: id, status, error_vi: null };
  } catch (err) {
    const msg = err instanceof AdsApiError ? err.adminMessage : err instanceof Error && err.message ? err.message : "Không kiểm tra được.";
    await store({
      clientId: id, customerId, ok: false, kind: "error", currency: null, limit: null, served: null, remaining: null,
      infinite: false, avg7: null, avg3: null, days: null, start: null, end: null, status: "error", expiring: false, error: msg, raw: null,
    }).catch(() => null);
    return fail(msg);
  }
}

type DbRow = {
  client_id: string;
  checked_at: Date | string;
  kind: string;
  currency: string | null;
  limit_micros: number | string | null;
  served_micros: number | string | null;
  remaining_micros: number | string | null;
  infinite: boolean;
  avg7_micros: number | string | null;
  avg3_micros: number | string | null;
  runway_days: number | string | null;
  budget_start: string | null;
  budget_end: string | null;
  status: string;
  expiring: boolean;
  error_vi: string | null;
};

const money = (v: number | string | null) => (v == null ? null : Number(v) / 1_000_000);

/** Stored results for the given accounts (caller has checked access). Unchecked accounts come back with nulls. */
export async function readBudgetRunway(accounts: Array<{ client_id: string; label: string; customer_id_dashed: string }>): Promise<RunwayRow[]> {
  const ids = accounts.map((a) => a.client_id).filter((id) => CLIENT_ID_RE.test(id));
  let rows: DbRow[] = [];
  if (ids.length) {
    try {
      const sql = await getSql();
      rows = await sql.query<DbRow>(`select * from ads_budget_runway where client_id = any($1::text[])`, [ids]);
    } catch {
      /* migration not applied yet */
    }
  }
  const by = new Map(rows.map((r) => [r.client_id, r]));
  return accounts.map((a) => {
    const r = by.get(a.client_id);
    const at = r ? (r.checked_at instanceof Date ? r.checked_at.toISOString() : String(r.checked_at)) : null;
    return {
      client_id: a.client_id,
      label: a.label,
      customer_id_dashed: a.customer_id_dashed,
      checked_at: at,
      kind: (r?.kind as RunwayRow["kind"]) ?? null,
      currency: r?.currency ?? null,
      limit: r ? money(r.limit_micros) : null,
      served: r ? money(r.served_micros) : null,
      remaining: r ? money(r.remaining_micros) : null,
      infinite: Boolean(r?.infinite),
      avg7: r ? money(r.avg7_micros) : null,
      avg3: r ? money(r.avg3_micros) : null,
      runway_days: r?.runway_days == null ? null : Number(r.runway_days),
      budget_start: r?.budget_start ?? null,
      budget_end: r?.budget_end ?? null,
      status: (r?.status as RunwayStatus) ?? null,
      expiring: Boolean(r?.expiring),
      error_vi: r?.error_vi ?? null,
    };
  });
}

/** Cron order: least recently checked first (never-checked first). */
export async function runwayCronQueue(ids: string[]): Promise<string[]> {
  const valid = [...new Set(ids)].filter((id) => CLIENT_ID_RE.test(id) && customerIdFor(id).length === 10);
  let last = new Map<string, number>();
  try {
    const sql = await getSql();
    const rows = await sql.query<{ client_id: string; checked_at: Date | string }>(
      `select client_id, checked_at from ads_budget_runway where client_id = any($1::text[])`,
      [valid],
    );
    last = new Map(rows.map((r) => [r.client_id, Date.parse(r.checked_at instanceof Date ? r.checked_at.toISOString() : String(r.checked_at)) || 0]));
  } catch {
    /* new table */
  }
  return valid.sort((a, b) => (last.get(a) || 0) - (last.get(b) || 0));
}
