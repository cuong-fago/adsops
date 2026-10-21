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

/** Hierarchical trend (Loại → Chiến dịch → Nhóm QC / Nhóm tài sản). */
export type ChannelKey = "search" | "pmax" | "shopping" | "video" | "display" | "demand_gen" | "other";
export const CHANNEL_LABEL: Record<ChannelKey, string> = { search: "Search", pmax: "PMax", shopping: "Shopping", video: "YouTube/Video", display: "Display", demand_gen: "Demand Gen", other: "Khác" };
import type { ConvByMonth } from "./google-conv-groups.ts";
export type TreeRow = {
  parent_id?: string | null;
  conv?: ConvByMonth | null;
  vtc?: Record<string, number> | null;
  id: string;
  name: string;
  status: string | null;
  channel: ChannelKey;
  months: TrendMonth[]; // 3 complete months
  current: TrendMonth;
  /** Not present in all 3 months → excluded from trend/diagnosis. E.g. "Mới từ T9/26". */
  excluded_label: string | null;
  /** Largest bad-direction MoM change (T vs T-1) across CPC/CPA/CVR; null = not evaluable. */
  worst: number | null;
};
export type ChannelGroup = {
  channel: ChannelKey;
  /** Like-for-like aggregate: only campaigns with data in all 3 months. */
  like: TrendMonth[];
  like_current: TrendMonth;
  like_count: number;
  total_count: number;
  diagnoses: TrendDiag[];
  worst: number | null;
  campaigns: TreeRow[];
  conv?: ConvByMonth | null;
  vtc?: Record<string, number> | null;
};
export type TrendTreeRead = {
  client_id: string;
  months: string[];
  current_month: string;
  groups: ChannelGroup[];
  /** Spend share by channel per month (all campaigns), null when the month has no spend. */
  mix: Array<{ month: string; total: number | null; shares: Array<{ channel: ChannelKey; spend: number; share: number }> }>;
  conv_error?: string | null;
  fetched_at: string | null;
  error: string | null;
};
export type TrendChildrenRead = { kind: "ad_group" | "asset_group"; rows: TreeRow[]; error: string | null; conv_error?: string | null };
