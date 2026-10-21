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
  key: string; status: NeedStatus; note: string | null; status_by: string | null; status_at: string | null;
  /** Was "Đã xử lý" but the metric worsened beyond the threshold vs the value at that time. */
  reopened: boolean;
};
export type NeedStatus = "new" | "doing" | "done";
export const STATUS_LABEL: Record<NeedStatus, string> = { new: "Mới", doing: "Đang xử lý", done: "Đã xử lý" };
export const needKey = (clientId: string, level: string, entityId: string, channel: string, metric: string, month: string) => [clientId, level, entityId, channel, metric, month].join("|");
export type NeedAccount = { client_id: string; label: string; owners: string[]; computed_at: string | null; error: string | null; entity_error: string | null; rows: NeedRow[] };
export type NeedsRead = {
  months: string[]; accounts: NeedAccount[]; owners: Array<{ id: string; name: string }>;
  can_filter_owner: boolean; can_edit_settings: boolean; can_update_status: boolean;
  /** Real user is Admin (Xem như allowed): may run "Tính ngay". */
  can_compute: boolean;
  /** Google accounts in scope with no snapshot or one older than 20 h. */
  stale_ids: string[];
  /** Accounts computed but with nothing flagged (so an empty list is explained). */
  computed_ok: number; thresholds: NeedThresholds; not_computed: number; last_run: string | null;
};
