/** TikTok Ads view types (JSON-safe). Missing = null, never 0. */
export type TTMetrics = {
  spend: number | null; impressions: number | null; reach: number | null; frequency: number | null;
  clicks: number | null; ctr: number | null; cpc: number | null; cpm: number | null;
  conversions: number | null; cpa: number | null;
  video_play_actions: number | null; video_watched_2s: number | null; video_watched_6s: number | null; video_views_p100: number | null;
  leads: number | null; cpl: number | null;
};
export type TTDetail = { label: string; value: string; long?: boolean };
export type TTInfo = {
  objective: string | null; budget: string | null; bid: string | null; optimize: string | null; placement: string | null;
  schedule: string | null; location: string | null; details: TTDetail[];
  /** Ad creative */
  text: string | null; cta: string | null; url: string | null; identity: string | null; format: string | null; has_thumb: boolean;
};
export type TTNode = { id: string; name: string | null; status: string | null; m: TTMetrics; prev: TTMetrics | null; delivered: boolean; info: TTInfo };
export type TTAdGroup = TTNode & { ads: TTNode[] };
export type TTCampaign = TTNode & { ad_groups: TTAdGroup[] };
export type TTView = {
  client_id: string; name: string | null; advertiser_id: string | null; currency: string | null; timezone: string | null;
  checked_at: string | null; insights_through: string | null; error: string | null;
  start: string; end: string; prev_start: string | null; prev_end: string | null;
  totals: TTMetrics; prev_totals: TTMetrics | null;
  daily: Array<{ date: string; spend: number | null; impressions: number | null; clicks: number | null; conversions: number | null }>;
  campaigns: TTCampaign[];
  manager_url: string | null;
};
export type TTSums = Omit<TTMetrics, "frequency" | "ctr" | "cpc" | "cpm" | "cpa" | "cpl">;
export function ttDerive(s: TTSums): TTMetrics {
  const div = (a: number | null, b: number | null, k = 1) => (a === null || b === null || b === 0 ? null : (a / b) * k);
  return { ...s, frequency: div(s.impressions, s.reach), ctr: div(s.clicks, s.impressions), cpc: div(s.spend, s.clicks), cpm: div(s.spend, s.impressions, 1000), cpa: div(s.spend, s.conversions), cpl: div(s.spend, s.leads) };
}
