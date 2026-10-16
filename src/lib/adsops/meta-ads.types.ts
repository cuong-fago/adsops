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
  daily: MetaDay[];
  campaigns: MetaRow[];
  adsets: MetaRow[];
  ads: MetaRow[];
  structure_pulled_at: string | null;
  state: { account_status: number | null; checked_at: string | null; error: string | null } | null;
};
