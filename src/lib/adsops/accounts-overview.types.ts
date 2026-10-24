import type { RunwayRow } from "./budget-runway.types.ts";
import type { ScoreRow } from "./optimization-score.types.ts";

/** One account in "Tổng quan tài khoản": stored values only (no Google call). */
export type OverviewRow = {
  client_id: string;
  label: string;
  customer_id_dashed: string;
  runway: Pick<RunwayRow, "checked_at" | "kind" | "runway_days" | "status" | "expiring" | "budget_end" | "infinite" | "error_vi">;
  score: Pick<ScoreRow, "checked_at" | "score" | "d1" | "error_vi">;
  /** Latest add_keyword / add_negative in ads_change_events; null = none stored. */
  last_opt_at: string | null;
  /** Latest successful change-log pull; null = never pulled (then "—", not "none in 30 days"). */
  change_pulled_at: string | null;
  /** Latest pull attempt (ok or not); a failed latest attempt is shown, never hidden behind old data. */
  change_last_ok: boolean | null;
  change_last_error: string | null;
  change_last_at: string | null;
};

export type OverviewRead = { rows: OverviewRow[] };

export const OPT_AMBER_DAYS = 3;
export const OPT_RED_DAYS = 7;

/** Mobile account card numbers from the stored analytics warehouse; null = not stored ("-"). */
export type AccountKpi = {
  currency: string | null;
  /** Latest stored day (account timezone); the 7-day window ends here. */
  end: string | null;
  /** Cost on today's date (Asia/Saigon) if that day is stored, else null. */
  today_cost: number | null;
  d7_cost: number | null;
  d7_conv: number | null;
};

/** Accent-insensitive search key: "Đà Nẵng" → "da nang". */
export function searchKey(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "d").toLowerCase();
}

/** Name / CID match; CID dashes optional ("6810292395" matches "681-029-2395"). */
export function matchAccount(q: string, label: string, cid: string): boolean {
  const k = searchKey(q.trim());
  if (!k) return true;
  const digits = k.replace(/[\s-]/g, "");
  if (/^\d{3,}$/.test(digits) && cid.replace(/\D/g, "").includes(digits)) return true;
  return searchKey(label).includes(k);
}
