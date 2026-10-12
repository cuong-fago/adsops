/** "Đang hoạt động": Google status ENABLED and spend > 0 in the last 7 stored days. */
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
};
export type ActivityRead = { accounts: Record<string, AccountActivity> };

export const INACTIVE_GOOGLE = new Set(["SUSPENDED", "CANCELED", "CANCELLED", "CLOSED", "NOT_ENABLED"]);

export const REASON_GOOGLE = "Google tạm ngưng / đã huỷ / không truy cập được";
export const REASON_NO_SPEND = "Không chi tiêu 7 ngày";
export const REASON_UNREADABLE = "Không đọc được dữ liệu";

/** Our own AdsApiError messages (google-ads.server.ts) → error kind. */
export function errorKind(msg: string | null | undefined): "not_enabled" | "no_access" | "other" | null {
  if (!msg) return null;
  if (/chưa kích hoạt hoặc đã bị huỷ|CUSTOMER_NOT_ENABLED/i.test(msg)) return "not_enabled";
  if (/không có quyền đọc tài khoản này qua MCC|USER_PERMISSION_DENIED|CUSTOMER_NOT_FOUND/i.test(msg)) return "no_access";
  return "other";
}
