/** "Ngân sách còn lại" — shared types (no server imports). */

export type RunwayStatus = "red" | "amber" | "ok" | "infinite" | "no_spend" | "no_budget" | "error";

export type RunwayRow = {
  client_id: string;
  label: string;
  customer_id_dashed: string;
  /** Null = never checked. */
  checked_at: string | null;
  kind: "account_budget" | "no_budget" | "error" | null;
  currency: string | null;
  /** Money in account currency units (micros / 1e6); null when Google gives none. */
  limit: number | null;
  served: number | null;
  remaining: number | null;
  infinite: boolean;
  avg7: number | null;
  avg3: number | null;
  runway_days: number | null;
  budget_start: string | null;
  budget_end: string | null;
  status: RunwayStatus | null;
  expiring: boolean;
  error_vi: string | null;
};

export type RunwayRead = { rows: RunwayRow[] };

export type RunwayCheckResult = { ok: boolean; client_id: string; status: RunwayStatus; error_vi: string | null };

export const RUNWAY_RED_DAYS = 3;
export const RUNWAY_AMBER_DAYS = 7;
export const EXPIRY_WARN_DAYS = 3;

/** Pure: status from remaining / average daily spend. */
export function runwayStatus(input: { infinite: boolean; remaining: number | null; avg: number | null }): {
  status: RunwayStatus;
  days: number | null;
} {
  if (input.infinite) return { status: "infinite", days: null };
  if (input.remaining == null) return { status: "no_budget", days: null };
  if (!input.avg || input.avg <= 0) return { status: "no_spend", days: null };
  const days = Math.max(0, input.remaining) / input.avg;
  return { status: days < RUNWAY_RED_DAYS ? "red" : days <= RUNWAY_AMBER_DAYS ? "amber" : "ok", days };
}
