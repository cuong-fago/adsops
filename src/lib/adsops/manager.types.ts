/** "Bảng điều hành" (manager view): agency dashboard, client health, churn risk. Shared types + documented rules. */

export type Split = { total: number | null; google: number | null; facebook: number | null };
export type Kpis = {
  spend: Split;
  leads: number | null;
  cpl: number | null;
  active_accounts: number;
  active_clients: number;
  /** Revenue entered for whole months inside the period (null = none entered). */
  revenue: number | null;
  /** Revenue ÷ spend of the same accounts and months. */
  roas: number | null;
  revenue_basis: string | null;
};
export type ClientSpend = { key: string; label: string; open_id: string; spend: number | null; prev: number | null; delta: number | null; leads: number | null; cpl: number | null };
export type AccountRef = { client_id: string; label: string };

export type HealthKey = "cpl" | "pacing" | "opt_days" | "alerts" | "opt_score" | "roas";
export type HealthComponent = { key: HealthKey; label: string; weight: number; score: number | null; detail: string };
export type HealthRow = { key: string; label: string; open_id: string; accounts: AccountRef[]; score: number | null; color: "green" | "yellow" | "red" | null; components: HealthComponent[]; missing: string[] };

export type ChurnRow = { key: string; label: string; open_id: string; level: "high" | "medium" | "low"; points: number; reasons: string[]; no_report: boolean; last_report_at: string | null };

export type ManagerRead = {
  period: { start: string; end: string; label: string; mtd: boolean };
  prev: { start: string; end: string; label: string };
  data_through: string | null;
  cur: Kpis;
  prev_kpis: Kpis;
  new_accounts: AccountRef[];
  stopped_accounts: AccountRef[];
  trend: { month: string; google: number | null; facebook: number | null }[];
  top_clients: ClientSpend[];
  movers: ClientSpend[];
  health: HealthRow[];
  churn: ChurnRow[];
};

/** Health score: documented weights (renormalised over components that have data). */
export const HEALTH_WEIGHTS: Record<HealthKey, number> = { cpl: 25, pacing: 15, opt_days: 20, alerts: 15, opt_score: 10, roas: 15 };
export const HEALTH_LABEL: Record<HealthKey, string> = {
  cpl: "CPL so với mục tiêu",
  pacing: "Tiến độ ngân sách",
  opt_days: "Số ngày từ lần tối ưu gần nhất",
  alerts: "Cảnh báo đang mở",
  opt_score: "Điểm tối ưu Google",
  roas: "ROAS thực so với mục tiêu",
};
export const HEALTH_RULES: Record<HealthKey, string> = {
  cpl: "CPL tháng này ÷ mục tiêu (không có mục tiêu: ÷ CPL trung bình 3 tháng trước). ≤1 → 100; mỗi +1% vượt trừ 2 điểm (≥1,5× → 0).",
  pacing: "Theo kế hoạch tháng (#72): đúng tiến độ 100, lệch ±10–25% 60, lệch >25% 20; trung bình các tài khoản có kế hoạch.",
  opt_days: "Tài khoản Google (Nhật ký tối ưu): ≤7 ngày 100, ≤14 ngày 60, ≤21 ngày 30, lâu hơn 0.",
  alerts: "Mỗi cảnh báo trừ 25 điểm: FB mỏi QC / tần suất cao / giới hạn học; ngân sách còn < 3 ngày; Google mất ≥20% IS do ngân sách.",
  opt_score: "Điểm tối ưu Google mới nhất (trung bình các tài khoản) × 100.",
  roas: "ROAS thực tháng trước (số liệu kinh doanh đã nhập) ÷ ROAS mục tiêu × 100, tối đa 100.",
};
export const HEALTH_GREEN = 75;
export const HEALTH_YELLOW = 50;

/** Churn-risk rules (points). ≥5 cao, 3–4 trung bình, 1–2 thấp. */
export const CHURN_RULES = {
  spendDropPct: 0.2, spendDropWeeks: 2, spendDropPoints: 3,
  cplMonths: 2, cplPoints: 2,
  noOptDays: 14, noOptPoints: 2,
  runwayDays: 3, runwayPoints: 3,
  roasMonths: 2, roasPoints: 2,
  reportDays: 35, reportPoints: 1,
} as const;
export const CHURN_LEVEL_VI = { high: "Cao", medium: "Trung bình", low: "Thấp" } as const;
