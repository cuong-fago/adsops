/** "Xu hướng 3 tháng" (Google, staff only). Missing = null, never 0. */
export type TrendMonth = {
  month: string; // YYYY-MM
  partial: boolean;
  days: number; // days covered (partial month: elapsed days)
  clicks: number | null;
  conversions: number | null;
  spend: number | null;
  cpc: number | null;
  cpa: number | null;
  cvr: number | null;
  lost_rank_is: number | null;
  /** < 5 conversions or < 100 clicks: no colours, no diagnosis. */
  low_data: boolean;
};
export type TrendDiag = { kind: "cpc_up" | "cvr_down" | "cpa_after_click"; title: string; detail: string };
export type TrendRead = { client_id: string; currency: string; months: TrendMonth[]; current: TrendMonth | null; diagnoses: TrendDiag[]; fetched_at: string | null; error: string | null };

export const LOW_CONV = 5;
export const LOW_CLICKS = 100;
