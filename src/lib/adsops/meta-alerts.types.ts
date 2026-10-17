/** Facebook staff alerts (creative fatigue, high frequency, learning phase). Shared by server and browser. */
export type MetaAlertKind = "fatigue" | "frequency" | "learning_limited" | "learning";
export type MetaAlertLevel = "adset" | "ad";

export type MetaAlert = {
  client_id: string;
  account_label: string;
  kind: MetaAlertKind;
  severity: "danger" | "warn" | "info";
  level: MetaAlertLevel;
  object_id: string;
  name: string;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  /** Vietnamese reason line. */
  reason: string;
  /** Vietnamese numbers line (already formatted). */
  detail: string;
  tip: string | null;
};

export type MetaAlertsRead = {
  alerts: MetaAlert[];
  /** Accounts checked / with errors (error text has no secrets). */
  accounts: number;
  errors: { client_id: string; account_label: string; error: string }[];
  /** Windows used (account-local dates of the first account; per-account windows can differ by timezone). */
  generated_at: string;
};

/** Thresholds (documented in the UI). */
export const FATIGUE = { recentDays: 3, baseDays: 7, ctrDrop: 0.2, cpmRise: 0.15, freq: 3, minImpr: 1000 } as const;
export const FREQ_ALERT = { warn: 3, bad: 4 } as const;
export const LEARNING_TIP = "Gộp nhóm hoặc tăng ngân sách để đủ ~50 kết quả/tuần";
