export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
/** Facebook analytics read model. Missing values stay null (shown blank / "—"), never 0. */
export type MetaMetrics = {
  spend: number;
  impressions: number;
  clicks: number;
  /** Meta "lead" results; null when Meta reported none for the whole range. */
  leads: number | null;
  /** Messaging conversations started (7d); null when none reported. */
  messages: number | null;
  ctr: number | null;
  cpc: number | null;
  cpl: number | null;
  /** Page likes/follows from ads (action_type "like"; "follow" types as fallback); null when none. */
  follows: number | null;
  cost_per_follow: number | null;
  /** action_type "page_engagement"; null when none. */
  page_engagement: number | null;
  /** Per range (time_increment=all_days), never a sum of days. */
  reach: number | null;
  frequency: number | null;
  cpm: number | null;
  link_clicks: number | null;
  link_ctr: number | null;
  cost_per_link_click: number | null;
  lpv: number | null;
  lpv_rate: number | null;
  video_3s: number | null;
  thruplay: number | null;
  /** Spend / messaging conversations started. */
  cost_per_message: number | null;
  msg_first_reply: number | null;
  msg_replied: number | null;
  msg_depth2: number | null;
  msg_depth3: number | null;
  msg_depth5: number | null;
  msg_connections: number | null;
  /** depth_2 (else replied_7d) / conversations started: proxy, "Khách nhắn tiếp ≥2 tin". */
  deep_rate: number | null;
  /** First present of omni_purchase / purchase / fb_pixel_purchase / onsite purchase (never summed). */
  purchases: number | null;
  /** Same type from action_values; null until purchase values are stored for the whole range. */
  purchase_value: number | null;
  roas: number | null;
  cpa_purchase: number | null;
  /** 3s views / impressions */
  hook_rate: number | null;
  /** ThruPlay / 3s views */
  hold_rate: number | null;
  /** pXX watched / 3s views */
  ret25: number | null;
  ret50: number | null;
  ret75: number | null;
  ret100: number | null;
};
export type MetaDay = MetaMetrics & { date: string };
export type MetaRow = MetaMetrics & {
  id: string;
  name: string;
  campaign_name?: string | null;
  adset_name?: string | null;
  campaign_id?: string | null;
  adset_id?: string | null;
  /** From meta_objects (structure sync); null when not synced yet. */
  status?: string | null;
  effective_status?: string | null;
  config?: { [k: string]: Json } | null;
  /** Staff + compare + previous period covered only. Null = no delivery in the previous period. */
  prev?: MetaMetrics | null;
  /** "new" = ran only in the current period; "gone" = ran only in the previous period (current metrics blank). */
  tag?: "new" | "gone" | null;
};
export type MetaAnalytics = {
  client_id: string;
  currency: string;
  start: string;
  end: string;
  data_through: string | null;
  warehouse_start: string | null;
  totals: MetaMetrics;
  /** Staff only (never for client principals). */
  prev: MetaMetrics | null;
  prev_range: { start: string; end: string } | null;
  /** False when compare was asked but stored history does not reach the previous period start. */
  prev_covered: boolean | null;
  history_from: string | null;
  /** False while older stored days still lack link clicks / video quartiles (backfill running). */
  fields_complete: boolean;
  prev_fields_complete: boolean | null;
  daily: MetaDay[];
  campaigns: MetaRow[];
  adsets: MetaRow[];
  ads: MetaRow[];
  structure_pulled_at: string | null;
  state: { account_status: number | null; checked_at: string | null; error: string | null } | null;
};
