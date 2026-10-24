import { capabilitiesFor, type PrincipalKind, type Role } from "./permissions.types.ts";

export type PushKind = "budget" | "conv_drop" | "invoices";
export const PUSH_KINDS: PushKind[] = ["budget", "conv_drop", "invoices"];
export const PUSH_LABEL: Record<PushKind, { title: string; hint: string }> = {
  budget: { title: "Ngân sách còn dưới 3 ngày", hint: "Ngân sách tài khoản (account budget) dự kiến hết trong < 3 ngày theo chi tiêu trung bình." },
  conv_drop: { title: "Chuyển đổi giảm mạnh", hint: "7 ngày gần nhất giảm ≥ 40% so với 7 ngày trước (khi kỳ trước có ≥ 10 chuyển đổi)." },
  invoices: { title: "Hóa đơn Google đã tải lên", hint: "Khi hóa đơn Google hằng tháng được tải lên AdsOps." },
};
export type PushPrefs = Record<PushKind, boolean>;
export type PushState = { configured: boolean; public_key: string | null; allowed: PushKind[]; prefs: PushPrefs; devices: number };

/**
 * Which alert kinds a role may receive. Mirrors existing screens, nothing new is exposed:
 * - budget: budget alerts live under the `optimize` capability (staff Ads roles).
 * - conv_drop: period comparison is staff-only (`compare`, staff kind).
 * - invoices: "Hóa đơn Google" (Admin + Kế toán).
 * Clients currently get no kind (none of these screens is visible to them); account scope is
 * enforced again at send time from account_grants.
 */
export function allowedPushKinds(kind: PrincipalKind, role: Role | "pending"): PushKind[] {
  if (role === "pending") return [];
  const c = capabilitiesFor(role);
  const out: PushKind[] = [];
  if (kind === "staff" && c.optimize) out.push("budget");
  if (kind === "staff" && c.compare) out.push("conv_drop");
  if (kind === "staff" && c.invoices) out.push("invoices");
  return out;
}

/** Sharp drop: prev7 ≥ 10 conversions and last7 ≤ 60% of prev7. */
export function isSharpDrop(prev7: number | null, last7: number | null): boolean {
  if (prev7 == null || last7 == null) return false;
  return prev7 >= 10 && last7 <= prev7 * 0.6;
}
