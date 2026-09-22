export type ClassifyLabel = "keep" | "add_exact" | "negative" | "routing" | "hold";

export type ClassifyWindow = {
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
};

export type ClassifyCluster = {
  query: string;
  campaign_name: string;
  ad_group_name: string;
  keyword_triggered?: string | null;
  match_type?: string | null;
  added_status?: string;
  label: ClassifyLabel;
  classified: boolean;
  negative_tier?: string | null;
  reason: string;
  evidence: string;
  rule_id?: string | null;
  confidence?: string | null;
  origin?: string;
  windows?: Record<string, ClassifyWindow>;
  impressions_30: number;
  clicks_30: number;
  cost_30: number;
  conversions_30: number;
};

export type ClassifySnap = {
  client_id: string;
  display_name: string;
  currency?: string;
  data_through?: string | null;
  propose_only?: boolean;
  never_apply_google_ads?: boolean;
  final_generated?: boolean;
  final_blocked?: boolean;
  labels?: ClassifyLabel[];
  label_vi?: Record<string, string>;
  coverage: {
    classified: number;
    total: number;
    rows: number;
    ratio: number;
    required: number;
  };
  counts?: Record<string, number>;
  cluster_count?: number;
  clusters: ClassifyCluster[];
  guard?: { overall?: string; source_flag?: string; large_actions_blocked?: boolean };
  verdict?: string;
  rule?: string;
};

export type ClassifyEdit = {
  query: string;
  campaign_name: string;
  ad_group_name: string;
  label: ClassifyLabel;
  negative_tier?: string | null;
  reason?: string;
};

export type ClassifySaveResult = {
  ok: boolean;
  error_vi?: string;
  summary?: {
    client_id: string;
    coverage: number;
    classified: number;
    total: number;
    guard: string;
    blocked: boolean;
    final_blocked?: boolean;
    large_ready?: number;
  };
  snapshot?: ClassifySnap;
};
