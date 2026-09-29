import type { Capabilities, PrincipalKind, Role, ViewAsInfo } from "./permissions.types.ts";

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export type AccessRole = Role;

export type AccessClient = {
  client_id: string;
  display_name: string;
  customer_id_dashed: string;
  /** Local short name. Empty/absent = show the Google name. Never a Google Ads rename. */
  alias?: string | null;
  /** Dashed MCC this account was listed from, when known. */
  mcc_id_dashed?: string | null;
  status?: string;
  adapter?: string;
};

export type AccessSnap = {
  role: Role | "pending";
  kind: PrincipalKind;
  email: string | null;
  display_name: string | null;
  /** True only for the super admin (sees every ad account in the MCC). */
  all_clients: boolean;
  client_ids: string[];
  clients: AccessClient[];
  caps: Capabilities;
  /** Set while admin is using "Xem như người dùng này". */
  view_as: ViewAsInfo | null;
  read_only: boolean;
  /** The person actually signed in (differs from email while viewing-as). */
  real_email: string | null;
  real_is_admin: boolean;
  /** Saved UI language for this principal (customer portal); null = default (vi). */
  lang: "vi" | "en" | null;
};

export type MccRosterSnap = {
  mcc_id_dashed: string;
  mcc_display_name: string;
  last_probe_accessible_count: number;
  roster_complete: boolean;
  note_vi: string;
  accounts: Array<{
    client_id: string;
    display_name: string;
    customer_id_dashed?: string;
    alias?: string | null;
    mcc_id_dashed?: string | null;
    in_system?: boolean;
    is_manager?: boolean;
    status?: string;
  }>;
};

export type WorkspaceDirectory = {
  access: AccessSnap;
  clients: AccessClient[];
  mcc: MccRosterSnap | null;
};

export type WorkspacePack = {
  report: Json | null;
  alerts: Json | null;
  guard: Json | null;
  hub: Json | null;
  proposals: Json | null;
  classify: Json | null;
  final: Json | null;
  connect: Json | null;
  sop: Json | null;
  analytics: Json | null;
  pace: Json | null;
  /** ISO time the Google Ads numbers were pulled, when known. */
  as_of: string | null;
  /** Last complete day in the data (YYYY-MM-DD), when known. */
  data_through: string | null;
  /** Where the analytics came from: Neon warehouse or committed snapshot. */
  analytics_source: "neon" | "snapshot" | null;
  /** Google Ads live-pull status (staff with pull capability only; null for customers). */
  ads_status?: { state: string; message_vi: string } | null;
};

export type WorkspaceScene = {
  final: Json | null;
  guard: Json | null;
  proposals: Json | null;
  alerts: Json | null;
};
