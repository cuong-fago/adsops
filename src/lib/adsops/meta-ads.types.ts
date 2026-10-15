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
};
export type MetaDay = MetaMetrics & { date: string };
export type MetaRow = MetaMetrics & { id: string; name: string; campaign_name?: string | null };
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
  daily: MetaDay[];
  campaigns: MetaRow[];
  adsets: MetaRow[];
  state: { account_status: number | null; checked_at: string | null; error: string | null } | null;
};
