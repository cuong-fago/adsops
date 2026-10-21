import type { ChannelKey } from "./google-trend.types.ts";
export type TrendVerdict = "worse" | "stable" | "better" | "low" | "none" | "error";
export type SnapMonth = { month: string; cpc: number | null; cpa: number | null; cvr: number | null; clicks: number | null; conversions: number | null; spend: number | null; low_data: boolean };
export type SnapChannel = { channel: ChannelKey; like_count: number; total_count: number; months: SnapMonth[] };
export type TrendAlert = { channel: ChannelKey; metric: "cpc" | "cpa" | "cvr"; d1: number; d2: number; months: string[] };
export type TrendSnapshot = {
  client_id: string; month: string | null; verdict: TrendVerdict; score: number | null;
  primary_channel: ChannelKey | null; channels: SnapChannel[]; alerts: TrendAlert[]; error: string | null; computed_at: string;
};
export const METRIC_LABEL: Record<TrendAlert["metric"], string> = { cpc: "CPC", cpa: "Giá/chuyển đổi", cvr: "Tỷ lệ chuyển đổi" };
/** Verdict threshold on the mean bad-direction MoM change (T vs T-1). */
export const VERDICT_BAND = 0.05;
export const ALERT_STEP = 0.1;
