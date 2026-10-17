/** Per-conversion-action breakdown (Google Ads), shared by server and browser. */
export type ConvActionLayer = "campaign" | "ad_group" | "keyword";

export type ConvActionInfo = {
  id: string;
  name: string;
  /** Raw ConversionActionCategory enum (e.g. PHONE_CALL_LEAD). */
  category: string | null;
  /** Totals for the read range and scope. */
  conversions: number;
  value: number;
  all_conversions: number;
};

/** action id → [conversions, value, all_conversions] */
export type ActionCells = Record<string, [number, number, number]>;

export type ConvActionRead = {
  layer: ConvActionLayer;
  actions: ConvActionInfo[];
  /** Row key (campaign id / ad group id / "<ad group>~<criterion>") → per-action numbers. */
  rows: Record<string, ActionCells>;
  covered_days: number;
  total_days: number;
  /** Staff + previous range requested only. */
  prev_rows: Record<string, ActionCells> | null;
  prev_covered_days: number | null;
  prev_total_days: number | null;
};

const CATEGORY_VI: Record<string, string> = {
  PHONE_CALL_LEAD: "Gọi điện",
  SUBMIT_LEAD_FORM: "Gửi biểu mẫu",
  IMPORTED_LEAD: "Khách tiềm năng nhập",
  QUALIFIED_LEAD: "Khách tiềm năng đủ điều kiện",
  CONVERTED_LEAD: "Khách tiềm năng đã chuyển đổi",
  LEAD: "Khách tiềm năng",
  SIGNUP: "Đăng ký",
  CONTACT: "Liên hệ",
  REQUEST_QUOTE: "Yêu cầu báo giá",
  BOOK_APPOINTMENT: "Đặt lịch hẹn",
  GET_DIRECTIONS: "Chỉ đường",
  OUTBOUND_CLICK: "Nhấp liên kết ngoài",
  PURCHASE: "Mua hàng",
  ADD_TO_CART: "Thêm vào giỏ",
  BEGIN_CHECKOUT: "Bắt đầu thanh toán",
  SUBSCRIBE_PAID: "Đăng ký trả phí",
  DOWNLOAD: "Tải xuống",
  PAGE_VIEW: "Trang",
  ENGAGEMENT: "Tương tác",
  STORE_VISIT: "Ghé cửa hàng",
  STORE_SALE: "Bán tại cửa hàng",
  DEFAULT: "Khác",
};
export function convCategoryVi(cat: string | null | undefined): string {
  if (!cat) return "Khác";
  return CATEGORY_VI[cat] || "Khác";
}
