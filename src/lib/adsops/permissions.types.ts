/**
 * Role / capability model shared by server and client (types + pure helpers
 * only — no server imports). The server is the real guard; the client uses the
 * same table only to hide tabs/buttons.
 */

export const SUPER_ADMIN_EMAIL = "cuong@fagogroup.vn";

export type StaffRole = "admin" | "head_ads" | "optimizer" | "sale";
export type ClientRole = "client_owner" | "client_staff";
export type Role = StaffRole | ClientRole;
export type PrincipalKind = "staff" | "client";

export const STAFF_ROLES: StaffRole[] = ["admin", "head_ads", "optimizer", "sale"];
/** Roles admin may assign to internal staff (admin itself is hard-coded). */
export const ASSIGNABLE_STAFF_ROLES: StaffRole[] = ["head_ads", "optimizer", "sale"];
export const CLIENT_ROLES: ClientRole[] = ["client_owner", "client_staff"];

export const ROLE_LABEL_VI: Record<string, string> = {
  admin: "Admin",
  head_ads: "Trưởng phòng Ads",
  optimizer: "Người tối ưu",
  sale: "Sale",
  client_owner: "Khách hàng (chủ)",
  client_staff: "Khách hàng (nhân viên)",
  pending: "Chưa được cấp quyền",
};

export type Capabilities = {
  /** One-screen overview, KPIs, conversions by type, cost/conv, charts, commentary. */
  overview: boolean;
  /** Analytics tab over the full warehouse (granted accounts only). */
  analytics: boolean;
  /** Compare vs previous period. */
  compare: boolean;
  /** Optimization proposals, Guard, budget alerts, Data Hub. */
  optimize: boolean;
  /** FINAL, Phân loại ST, Kết nối, SOP tabs. */
  opsTabs: boolean;
  /** Pull / refresh data from Google Ads (read-only pulls), edit ST labels. */
  pull: boolean;
  /** File download / export. */
  download: boolean;
  /** Grant permissions, manage users/customers/accounts, approve requests. */
  grant: boolean;
  /** "Xem như người dùng này". */
  viewAs: boolean;
  /** Submit a grant request for admin approval. */
  requestGrant: boolean;
};

const NONE: Capabilities = {
  overview: false,
  analytics: false,
  compare: false,
  optimize: false,
  opsTabs: false,
  pull: false,
  download: false,
  grant: false,
  viewAs: false,
  requestGrant: false,
};

/** The approved permission matrix. */
export function capabilitiesFor(role: Role | "pending"): Capabilities {
  switch (role) {
    case "admin":
      return {
        overview: true,
        analytics: true,
        compare: true,
        optimize: true,
        opsTabs: true,
        pull: true,
        download: true,
        grant: true,
        viewAs: true,
        requestGrant: false,
      };
    case "head_ads":
      return { ...NONE, overview: true, analytics: true, compare: true, optimize: true, opsTabs: true, pull: true, download: true, requestGrant: true };
    case "optimizer":
      return { ...NONE, overview: true, analytics: true, compare: true, optimize: true, opsTabs: true, pull: true, download: true };
    case "sale":
      return { ...NONE, overview: true, analytics: true, compare: true, optimize: true, opsTabs: true, download: true, requestGrant: true };
    case "client_owner":
    case "client_staff":
      return { ...NONE, overview: true, analytics: true };
    default:
      return { ...NONE };
  }
}

export function isStaffRole(v: unknown): v is StaffRole {
  return typeof v === "string" && (STAFF_ROLES as string[]).includes(v);
}

export function isClientRole(v: unknown): v is ClientRole {
  return typeof v === "string" && (CLIENT_ROLES as string[]).includes(v);
}

/** Workspace pack module -> capability that unlocks it. */
export const MODULE_CAPABILITY: Record<string, keyof Capabilities> = {
  report: "overview",
  analytics: "analytics",
  compare: "compare",
  pace: "optimize",
  alerts: "optimize",
  guard: "optimize",
  hub: "optimize",
  proposals: "optimize",
  classify: "opsTabs",
  final: "opsTabs",
  connect: "opsTabs",
  sop: "opsTabs",
};

export type ViewAsInfo = {
  kind: PrincipalKind;
  id: string;
  label: string;
  role: Role | "pending";
  admin_email: string | null;
};

// ── Admin panel DTOs ─────────────────────────────────────────────────────────

export type StaffUserRow = {
  id: string;
  email: string;
  role: StaffRole;
  display_name: string | null;
  hard_coded: boolean;
  has_logged_in: boolean;
  account_ids: string[];
};

export type ClientUserRow = {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  role: ClientRole;
  customer_id: string | null;
  created_at: string;
  last_login_at: string | null;
  active_sessions: number;
  account_ids: string[];
};

export type CustomerRow = { id: string; name: string; note: string | null };

export type AdAccountRow = {
  id: string;
  platform: string;
  external_id: string | null;
  display_name: string;
  customer_id: string | null;
  sale_staff_id: string | null;
  status: string | null;
  first_seen_at: string;
  grant_count: number;
};

export type GrantRequestRow = {
  id: string;
  requested_by: string;
  requester_role: string;
  target_kind: PrincipalKind;
  target_id: string;
  target_label: string;
  ad_account_ids: string[];
  note: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
};

export type AuditRow = {
  id: number;
  at: string;
  actor: string;
  action: string;
  target_kind: string | null;
  target_id: string | null;
  detail: Record<string, unknown>;
};

export type UnassignedLogin = { user_id: string; email: string; name: string | null };

export type AdminDirectory = {
  staff: StaffUserRow[];
  clients: ClientUserRow[];
  customers: CustomerRow[];
  accounts: AdAccountRow[];
  requests: GrantRequestRow[];
  unassigned_logins: UnassignedLogin[];
};

/** What sale / head_ads see to file a request: only their own granted accounts. */
export type RequestDirectory = {
  clients: Array<Pick<ClientUserRow, "id" | "username" | "display_name" | "customer_id">>;
  accounts: Array<Pick<AdAccountRow, "id" | "display_name" | "external_id">>;
  my_requests: GrantRequestRow[];
};

/** Format an ISO timestamp as "HH:mm dd/MM/yyyy" in Asia/Saigon. */
export function formatSaigon(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Saigon",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")} ${get("day")}/${get("month")}/${get("year")}`;
}
