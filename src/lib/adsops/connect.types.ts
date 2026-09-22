export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export type ConnectPublic = {
  client_id: string;
  display_name: string;
  customer_id: string;
  customer_id_dashed: string;
  mcc_id: string;
  mcc_id_dashed: string;
  mcc_display_name: string | null;
  adapter: string;
  status: string;
  title_vi: string;
  detail_vi: string;
  next_step_vi: string;
  checklist: Array<{
    id: string;
    label_vi: string;
    present: boolean;
    source: string;
    required?: boolean;
    state_vi?: string;
  }>;
  account_name: string | null;
  currency: string | null;
  account_timezone: string | null;
  is_manager: boolean | null;
  account_status: string | null;
  accessible_count: number | null;
  target_in_accessible: boolean | null;
  yaml_file_present: boolean;
  api_version: string;
  probed_at: string;
  propose_only: boolean;
  pulled_search_terms: boolean;
  pulled_kpis: boolean;
  never_apply_google_ads: boolean;
  error_hint: string;
  module?: string;
  rule?: string;
  session?: string;
  isolation?: string;
  mcc_accounts?: Array<{
    client_id: string;
    display_name: string;
    account_name?: string;
    customer_id: string;
    customer_id_dashed: string;
    status: string;
    is_manager: boolean;
    in_system?: boolean;
  }>;
  roster_complete?: boolean;
};

export type InstallMeta = {
  ok: boolean;
  yaml_file_present?: boolean;
  missing?: string[];
  error_vi?: string;
};

export type InstallAndProbeResult = {
  install: InstallMeta | null;
  connect: ConnectPublic | null;
  error_vi?: string;
};

export type PullKpisResult = {
  ok: boolean;
  client_id?: string;
  connect?: ConnectPublic | null;
  compare?: Json | null;
  report?: Json | null;
  hub?: Json | null;
  error_vi?: string | null;
};

export type PullAnalyticsWarehouseResult = {
  ok: boolean;
  client_id?: string;
  analytics?: Json | null;
  lookback_days?: number;
  warehouse_start?: string | null;
  warehouse_end?: string | null;
  day_count?: number;
  layers?: {
    account: number;
    campaign: number;
    ad_group: number;
    keyword: number;
    search_term: number;
  };
  persisted_neon?: boolean;
  persisted_fs?: boolean;
  error_vi?: string | null;
  note_vi?: string | null;
};
