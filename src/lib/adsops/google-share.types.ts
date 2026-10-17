/** Google Ads impression-share metrics, shared by server and browser. */
export type ShareLayer = "campaign" | "ad_group" | "keyword";

export const SHARE_KEYS = [
  "is",
  "is_lost_budget",
  "is_lost_rank",
  "top_is",
  "abs_top_is",
  "top_pct",
  "abs_top_pct",
  "exact_is",
] as const;
export type ShareKey = (typeof SHARE_KEYS)[number];

/** Present keys only: a missing key means Google returned nothing (blank, never 0). */
export type ShareCells = { [k: string]: number };

export type ShareRead = {
  layer: ShareLayer;
  /** Row key (campaign id / ad group id / "<ad group>~<criterion>") → values (0–1). */
  rows: { [id: string]: ShareCells };
  /** Whole account (customer resource) for the range; null when not fetched / unavailable. */
  account: ShareCells | null;
  /** Staff + previous range requested only. */
  prev_rows: { [id: string]: ShareCells } | null;
  prev_account: ShareCells | null;
  /** Google API could not be read for the current range. */
  error: boolean;
};

export const SHARE_LABEL: Record<ShareKey, string> = {
  is: "IS tìm kiếm",
  is_lost_budget: "Mất IS (ngân sách)",
  is_lost_rank: "Mất IS (xếp hạng)",
  top_is: "IS đầu trang",
  abs_top_is: "IS đầu trang tuyệt đối",
  top_pct: "% đầu trang",
  abs_top_pct: "% đầu trang tuyệt đối",
  exact_is: "IS khớp chính xác",
};

export const SHARE_HINT: Record<ShareKey, string> = {
  is: "Tỷ lệ hiển thị trên Mạng tìm kiếm = số lần hiển thị / số lần đủ điều kiện hiển thị. Cao hơn là tốt.",
  is_lost_budget: "Phần lần hiển thị bị mất vì hết ngân sách. Thấp hơn là tốt; cao + chuyển đổi tốt → nên tăng ngân sách.",
  is_lost_rank: "Phần lần hiển thị bị mất vì Ad Rank thấp (Quality Score / giá thầu). Thấp hơn là tốt.",
  top_is: "Lần hiển thị ở vị trí đầu trang (phía trên kết quả tự nhiên) / số lần đủ điều kiện hiển thị ở đầu trang.",
  abs_top_is: "Lần hiển thị ở vị trí đầu tiên tuyệt đối / số lần đủ điều kiện hiển thị ở đó.",
  top_pct: "Phần trăm lần hiển thị của bạn nằm ở đầu trang (trên kết quả tự nhiên).",
  abs_top_pct: "Phần trăm lần hiển thị của bạn ở vị trí quảng cáo đầu tiên.",
  exact_is: "IS tính như thể mọi truy vấn khớp chính xác từ khoá (bỏ qua biến thể gần đúng).",
};

/** Higher is better except lost IS. */
export const SHARE_LOWER_BETTER = new Set<string>(["is_lost_budget", "is_lost_rank"]);

/** Google clamps: 0.0999 means "< 10%", 0.9001 means "> 90%". */
export function shareBound(v: number): "lt10" | "gt90" | null {
  if (Math.abs(v - 0.0999) < 1e-6) return "lt10";
  if (Math.abs(v - 0.9001) < 1e-6) return "gt90";
  return null;
}

export function fmtShare(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const b = shareBound(v);
  if (b === "lt10") return "<10%";
  if (b === "gt90") return ">90%";
  return `${(v * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
}
