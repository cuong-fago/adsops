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
};

export type OverviewRead = { rows: OverviewRow[] };

export const OPT_AMBER_DAYS = 3;
export const OPT_RED_DAYS = 7;
