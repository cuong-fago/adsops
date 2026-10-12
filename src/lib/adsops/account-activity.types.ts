/** "Đang hoạt động": Google status ENABLED and spend > 0 in the last 7 stored days. */
export type ActivityState = "active" | "inactive" | "unknown";
export type AccountActivity = { state: ActivityState; reason: string | null; google_status: string | null; avg7: number | null };
export type ActivityRead = { accounts: Record<string, AccountActivity> };

export const INACTIVE_GOOGLE = new Set(["SUSPENDED", "CANCELED", "CANCELLED", "CLOSED"]);
