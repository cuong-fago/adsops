/** "Hiệu suất nhân sự" (inside Bảng điều hành). Assignment = existing account grants. */
export type PerfNums = {
  spend: number | null;
  /** Accounts with spend + CPL + target: CPL ≤ target. */
  cpl_ok: number | null;
  cpl_basis: number;
  changes: number | null;
  reports_sent: number;
};
export type StaffAccount = {
  client_id: string; label: string; spend: number | null; cpl: number | null; target_cpl: number | null;
  cpl_ok: boolean | null; pace_status: string | null; health: number | null; alerts: string[]; last_opt_days: number | null; weekly_opt: boolean | null; shared: boolean;
};
export type StaffRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  accounts: number;
  clients: number;
  cur: PerfNums;
  prev: PerfNums;
  pace_ok: number | null;
  pace_basis: number;
  health_avg: number | null;
  red_clients: number;
  /** Changes attributed via the change author (user_email = this staff member). */
  changes_author: number;
  /** Changes with no matching staff author, credited to every assignee of the account. */
  changes_assigned: number;
  weekly_opt: number | null;
  weekly_basis: number;
  avg_opt_days: number | null;
  alerts: number;
  drafts: number;
  overdue_reports: number;
  churn_high: number;
  churn_medium: number;
  shared_accounts: number;
  detail: StaffAccount[];
};
export type StaffPerfRead = { period: { start: string; end: string; label: string }; prev: { start: string; end: string; label: string }; weeks: number; author_stored: boolean; rows: StaffRow[] };
