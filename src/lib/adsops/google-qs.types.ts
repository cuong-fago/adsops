/** Google Ads Quality Score + wasted search-term spend, shared by server and browser. */
export type QsComponent = "BELOW_AVERAGE" | "AVERAGE" | "ABOVE_AVERAGE";
export type QsCell = { qs: number | null; creative: QsComponent | null; post_click: QsComponent | null; ctr: QsComponent | null };

export type QsLowRow = {
  id: string;
  keyword: string;
  match_type: string | null;
  campaign_name: string | null;
  ad_group_name: string | null;
  qs: number;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  creative: QsComponent | null;
  post_click: QsComponent | null;
  ctr: QsComponent | null;
};

export type QsRead = {
  /** Snapshot date used (latest stored); null = never snapshotted. */
  snapshot_date: string | null;
  /** keyword id "<ad group>~<criterion>" → QS cells. */
  rows: { [id: string]: QsCell };
  /** Σ(QS × impressions) ÷ Σ impressions over keywords with QS and impressions in the range; null = no basis. */
  weighted_qs: number | null;
  /** Impressions behind weighted_qs / all keyword impressions in the range. */
  weighted_basis: { impressions: number; total_impressions: number } | null;
  /** QS ≤ 4 with spend in the range, by spend desc (top 20). */
  low: QsLowRow[];
  /** Keyword data for the range is incomplete (not all days pulled / rows capped). */
  partial: boolean;
};

export type WasteTerm = {
  term: string;
  campaign_name: string;
  ad_group_name: string;
  clicks: number;
  impressions: number;
  cost: number;
  excluded: boolean;
  added: boolean;
};
export type WasteBlock = {
  /** All search-term spend in the range (same source as waste). */
  total_cost: number;
  /** Spend on terms with 0 conversions and 0 all conversions. */
  waste_cost: number;
  waste_terms: number;
  /** Top wasted terms with ≥ 3 clicks, by spend (top 50). */
  top: WasteTerm[];
};
export type WasteRead = {
  cur: WasteBlock | null;
  /** Staff + previous range only. */
  prev: WasteBlock | null;
  start: string;
  end: string;
  /** Search terms are only kept ~90 days by Google: the range was clamped to this start. */
  clamped_start: string | null;
  error: boolean;
};

export const QS_COMPONENT_VI: Record<QsComponent, string> = {
  BELOW_AVERAGE: "Dưới trung bình",
  AVERAGE: "Trung bình",
  ABOVE_AVERAGE: "Trên trung bình",
};
export const QS_COMPONENT_RANK: Record<QsComponent, number> = { BELOW_AVERAGE: 1, AVERAGE: 2, ABOVE_AVERAGE: 3 };
export const WASTE_MIN_CLICKS = 3;
export const QS_LOW = 4;
export function qsTone(qs: number | null | undefined): "danger" | "warn" | "ok" | null {
  if (qs == null) return null;
  return qs <= 3 ? "danger" : qs <= 6 ? "warn" : "ok";
}
