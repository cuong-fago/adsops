/** ChatGPT Ads view types (JSON-safe). Missing = null, never 0. */
export type OAMetrics = {
  impressions: number | null;
  clicks: number | null;
  spend: number | null;
  conversions: number | null;
  sales: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpa: number | null;
};
export type OANode = { id: string; name: string | null; status: string | null; m: OAMetrics; prev: OAMetrics | null };
export type OAAdGroup = OANode & { ads: OANode[] };
export type OACampaign = OANode & { ad_groups: OAAdGroup[] };
export type OAView = {
  client_id: string;
  name: string | null;
  ad_account_id: string | null;
  currency: string | null;
  timezone: string | null;
  checked_at: string | null;
  insights_through: string | null;
  error: string | null;
  start: string;
  end: string;
  prev_start: string | null;
  prev_end: string | null;
  totals: OAMetrics;
  prev_totals: OAMetrics | null;
  daily: Array<{ date: string; spend: number | null; impressions: number | null; clicks: number | null; conversions: number | null }>;
  campaigns: OACampaign[];
};
export type OAConnection = { client_id: string; ad_account_id: string; name: string | null; source: string; created_by: string | null; updated_at: string; last_ok_at: string | null; last_error: string | null; insights_through: string | null };

export function oaDerive(s: { impressions: number | null; clicks: number | null; spend: number | null; conversions: number | null; sales: number | null }): OAMetrics {
  const div = (a: number | null, b: number | null, k = 1) => (a === null || b === null || b === 0 ? null : (a / b) * k);
  return { ...s, ctr: div(s.clicks, s.impressions), cpc: div(s.spend, s.clicks), cpm: div(s.spend, s.impressions, 1000), cpa: div(s.spend, s.conversions) };
}
