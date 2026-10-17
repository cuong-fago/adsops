/** Google Ads breakdowns (device / hour / weekday / geo) and calls. Shared by server and browser. */
export type SegMetrics = { cost: number; impressions: number; clicks: number; conversions: number };
export type SegRow = SegMetrics & { key: string; label: string };

export type BreakdownRead = {
  start: string;
  end: string;
  campaign_id: string | null;
  device: SegRow[];
  hour: SegRow[];
  dow: SegRow[];
  /** "<dow>|<hour>" → metrics (dow = MONDAY…SUNDAY, hour 0–23). */
  heat: { [k: string]: SegMetrics };
  /** Province / city (geo_target_region, location of presence). Names from geo_target_constant. */
  geo: SegRow[];
  /** Per-part read failures (blank, never 0). */
  errors: string[];
};

export type CallRow = {
  /** Account-local "YYYY-MM-DD HH:MM:SS" from Google. */
  start: string;
  duration: number | null;
  status: "RECEIVED" | "MISSED" | string;
  /** Area code only (Google never returns the full number). */
  area: string | null;
  country: string | null;
  type: string | null;
  campaign_name: string;
  ad_group_name: string | null;
};
export type CallsRead = {
  start: string;
  end: string;
  campaign_id: string | null;
  /** null = call_view could not be read (call reporting off / error). */
  calls: CallRow[] | null;
  total: number;
  long60: number;
  missed: number;
  /** Spend for the same range + campaign scope (cost per 60s+ call = spend ÷ long60). */
  spend: number | null;
  /** Conversions of PHONE_CALL_LEAD conversion actions (#65 data), null = none stored. */
  call_conversions: number | null;
  call_actions: { name: string; conversions: number }[];
  error: string | null;
};

export const DOW_ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
export const DOW_VI: Record<string, string> = { MONDAY: "T2", TUESDAY: "T3", WEDNESDAY: "T4", THURSDAY: "T5", FRIDAY: "T6", SATURDAY: "T7", SUNDAY: "CN" };
export const DEVICE_VI: Record<string, string> = { MOBILE: "Điện thoại", DESKTOP: "Máy tính", TABLET: "Máy tính bảng", CONNECTED_TV: "TV", OTHER: "Khác" };
