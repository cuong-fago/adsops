import type { ChannelKey } from "./google-trend.types.ts";
export type NeedThresholds = { step: number; conv: number; clicks: number };
export const NEED_DEFAULTS: NeedThresholds = { step: 0.1, conv: 5, clicks: 100 };
export type NeedLevel = "account" | "campaign" | "ad_group" | "asset_group";
export type NeedMetric = "cpc" | "cpa" | "cvr";
export type NeedRow = {
  level: NeedLevel; entity_id: string; campaign_id: string | null; campaign_name: string | null; name: string; channel: ChannelKey;
  metric: NeedMetric; values: Array<number | null>; low: boolean[];
  /** [T-2→T-1, T-1→T]; null = not evaluable (missing or low-data month). */
  steps: Array<number | null>;
  kind: "worse" | "better"; spend: number | null; weight: number; diag: string | null;
};
export type NeedAccount = { client_id: string; label: string; owners: string[]; computed_at: string | null; error: string | null; entity_error: string | null; rows: NeedRow[] };
export type NeedsRead = {
  months: string[]; accounts: NeedAccount[]; owners: Array<{ id: string; name: string }>;
  can_filter_owner: boolean; can_edit_settings: boolean; thresholds: NeedThresholds; not_computed: number; last_run: string | null;
};
