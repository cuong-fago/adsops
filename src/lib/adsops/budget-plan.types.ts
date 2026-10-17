/** Monthly budget plan + pacing (Google + Facebook). Shared by server and browser. */
export type BudgetPlan = { client_id: string; month: string; planned_budget: number; target_conv: number | null; target_cpl: number | null; updated_by: string | null; updated_at: string | null };

export type PacingStatus = "on_track" | "fast_warn" | "fast_bad" | "slow_warn" | "slow_bad";

export type PacingRow = {
  client_id: string;
  month: string;
  days_in_month: number;
  /** Last day with stored spend in the month (null = no spend data this month). */
  data_through: string | null;
  days_elapsed: number | null;
  plan: BudgetPlan | null;
  mtd_spend: number | null;
  /** plan × days elapsed ÷ days in month. */
  expected: number | null;
  /** mtd ÷ expected − 1. */
  pace: number | null;
  status: PacingStatus | null;
  /** Trailing 7 stored days ending at data_through. */
  avg7: number | null;
  projected: number | null;
  remaining: number | null;
  /** (plan − mtd) ÷ days left. */
  daily_needed: number | null;
  /** Google: conversions; Facebook: leads, else messaging conversations. */
  mtd_conv: number | null;
  conv_label: string;
  mtd_cpl: number | null;
  /** Viewer may edit this account's plan. */
  can_edit: boolean;
};

export const PACE_WARN = 0.1;
export const PACE_BAD = 0.25;
export function paceStatus(pace: number | null): PacingStatus | null {
  if (pace == null) return null;
  if (pace > PACE_BAD) return "fast_bad";
  if (pace > PACE_WARN) return "fast_warn";
  if (pace < -PACE_BAD) return "slow_bad";
  if (pace < -PACE_WARN) return "slow_warn";
  return "on_track";
}
export const PACE_LABEL: Record<PacingStatus, string> = {
  on_track: "Đúng tiến độ",
  fast_warn: "Tiêu nhanh",
  fast_bad: "Tiêu nhanh",
  slow_warn: "Tiêu chậm",
  slow_bad: "Tiêu chậm",
};
export const PACE_TONE: Record<PacingStatus, "ok" | "warn" | "danger"> = {
  on_track: "ok", fast_warn: "warn", fast_bad: "danger", slow_warn: "warn", slow_bad: "danger",
};
export const isRedPace = (s: PacingStatus | null) => s === "fast_bad" || s === "slow_bad";
