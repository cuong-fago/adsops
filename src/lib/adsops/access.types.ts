export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export type AccessRole = "ops" | "sale" | "client";

export type AccessClient = {
  client_id: string;
  display_name: string;
  customer_id_dashed: string;
  status?: string;
  adapter?: string;
};

export type AccessSnap = {
  role: AccessRole | "pending";
  email: string | null;
  all_clients: boolean;
  client_ids: string[];
  clients: AccessClient[];
};

export type MemberRow = {
  id: string;
  email: string;
  role: AccessRole;
  client_id: string | null;
  display_name: string | null;
  user_id: string | null;
};

export type GrantInput = {
  email: string;
  role: AccessRole;
  clientIds: string[];
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
};

export type WorkspaceScene = {
  final: Json | null;
  guard: Json | null;
  proposals: Json | null;
  alerts: Json | null;
};
