/**
 * Staff lists hide an account when Google says it is not enabled, or when it spent nothing in the
 * last 10 days (metrics.cost_micros, today-9..today). Any spend re-includes it. Never deleted.
 */
export type ActivityState = "active" | "inactive" | "unknown";
export type AccountActivity = {
  state: ActivityState;
  reason: string | null;
  google_status: string | null;
  avg7: number | null;
  /** Latest stored error text (budget / score check), for the tooltip. */
  error: string | null;
  /** Set when the account's whole MCC fails with the same error: a system problem, never hidden. */
  systemic: string | null;
  /** 10-day spend check (migration 0016); null when never checked. */
  spend10: number | null;
  spend10_last_date: string | null;
  spend10_checked_at: string | null;
};
/** can_show_inactive: only a real Admin (also while in "Xem như") may un-hide inactive accounts in lists. */
export type ActivityRead = { accounts: Record<string, AccountActivity>; can_show_inactive: boolean };

export const INACTIVE_GOOGLE = new Set(["SUSPENDED", "CANCELED", "CANCELLED", "CLOSED", "NOT_ENABLED"]);

export const REASON_GOOGLE = "Google tạm ngưng / đã huỷ / không truy cập được";
export const REASON_NO_SPEND = "Không chi tiêu 7 ngày";
export const REASON_NO_SPEND_10 = "Không chi tiêu 10 ngày";
/** A 10-day check older than this falls back to the stored 7-day signals. */
export const SPEND10_FRESH_MS = 48 * 60 * 60 * 1000;
export const REASON_UNREADABLE = "Không đọc được dữ liệu";

/** Our own AdsApiError messages (google-ads.server.ts) → error kind. */
export function errorKind(msg: string | null | undefined): "not_enabled" | "no_access" | "other" | null {
  if (!msg) return null;
  if (/chưa kích hoạt hoặc đã bị huỷ|CUSTOMER_NOT_ENABLED/i.test(msg)) return "not_enabled";
  if (/không có quyền đọc tài khoản này qua MCC|USER_PERMISSION_DENIED|CUSTOMER_NOT_FOUND/i.test(msg)) return "no_access";
  return "other";
}
