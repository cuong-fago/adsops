/** Business outcomes (staff-entered / imported) + derived metrics. Shared by server and browser. */
export type OutcomeEntry = {
  client_id: string;
  month: string;
  /** "" = account total. */
  campaign: string;
  valid_leads: number | null;
  closed_customers: number | null;
  revenue: number | null;
  note: string | null;
  updated_by: string | null;
  updated_at: string | null;
};

export type BizMetrics = {
  month: string;
  spend: number | null;
  /** Google conversions / FB leads (else messaging conversations). */
  platform_leads: number | null;
  /** null = no outcome entered for the month ("Chưa nhập số liệu"). */
  valid_leads: number | null;
  closed: number | null;
  revenue: number | null;
  has_outcome: boolean;
  platform_cpl: number | null;
  valid_rate: number | null;
  cost_per_valid: number | null;
  close_rate: number | null;
  cac: number | null;
  roi: number | null;
  roas: number | null;
};

export type Targets = { target_cpl: number | null; target_cac: number | null; target_roas: number | null } | null;

export type BizRead = {
  client_id: string;
  months: string[];
  series: BizMetrics[];
  entries: OutcomeEntry[];
  targets: Targets;
  can_edit: boolean;
  /** Client group (existing customers mapping in Quản trị). Only accounts the viewer may see. */
  group: {
    id: string;
    name: string;
    accounts: { client_id: string; label: string }[];
    series: BizMetrics[];
    /** Accounts without an outcome for the month (blended valid metrics then blank). */
    missing: Record<string, string[]>;
  } | null;
};

export type ImportRowIn = { account_id: string; month: string; campaign?: string; valid_leads?: string; closed_customers?: string; revenue?: string; note?: string };
export type ImportRowResult = { line: number; client_id: string | null; label: string | null; month: string; campaign: string; errors: string[]; action: "insert" | "update" | null };
export type ImportResult = { dry_run: boolean; rows: ImportRowResult[]; inserted: number; updated: number; rejected: number };

export const TEMPLATE_COLUMNS = ["account_id", "month", "campaign", "valid_leads", "closed_customers", "revenue", "note"] as const;

export function bizMetrics(month: string, spend: number | null, leads: number | null, o: { valid_leads: number | null; closed_customers: number | null; revenue: number | null } | null): BizMetrics {
  const valid = o?.valid_leads ?? null;
  const closed = o?.closed_customers ?? null;
  const revenue = o?.revenue ?? null;
  const sp = spend != null && spend > 0 ? spend : null;
  return {
    month, spend, platform_leads: leads, valid_leads: valid, closed, revenue, has_outcome: Boolean(o),
    platform_cpl: sp && leads && leads > 0 ? sp / leads : null,
    valid_rate: valid != null && leads && leads > 0 ? valid / leads : null,
    cost_per_valid: sp && valid && valid > 0 ? sp / valid : null,
    close_rate: closed != null && valid && valid > 0 ? closed / valid : null,
    cac: sp && closed && closed > 0 ? sp / closed : null,
    roi: sp && revenue != null ? (revenue - sp) / sp : null,
    roas: sp && revenue != null ? revenue / sp : null,
  };
}
