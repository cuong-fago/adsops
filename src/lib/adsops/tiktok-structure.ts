/** Stored TikTok objects → Vietnamese fields. Pure. Absent values are omitted (UI shows "-"). */
import type { TTDetail, TTInfo } from "./tiktok-ads.types.ts";

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v.trim() && v !== "-" ? v : typeof v === "number" ? String(v) : null);
const MAP: Record<string, Record<string, string>> = {
  objective: { REACH: "Phạm vi tiếp cận", TRAFFIC: "Lưu lượng truy cập", VIDEO_VIEWS: "Lượt xem video", ENGAGEMENT: "Tương tác", LEAD_GENERATION: "Thu thập khách hàng tiềm năng", WEB_CONVERSIONS: "Chuyển đổi trên web", APP_PROMOTION: "Quảng bá ứng dụng", PRODUCT_SALES: "Doanh số sản phẩm", CONVERSIONS: "Chuyển đổi", RF_REACH: "Phạm vi (đặt trước)" },
  budget_mode: { BUDGET_MODE_DAY: "Hằng ngày", BUDGET_MODE_TOTAL: "Trọn đời", BUDGET_MODE_INFINITE: "Không giới hạn", BUDGET_MODE_DYNAMIC_DAILY_BUDGET: "Hằng ngày (linh hoạt)" },
  bid: { BID_TYPE_NO_BID: "Chi phí thấp nhất", BID_TYPE_CUSTOM: "Giá thầu tuỳ chỉnh", BID_TYPE_MAX_CONVERSION: "Tối đa chuyển đổi" },
  optimize: { CLICK: "Click", CONVERT: "Chuyển đổi", REACH: "Phạm vi", SHOW: "Hiển thị", VIDEO_VIEW: "Lượt xem video", LEAD_GENERATION: "Khách hàng tiềm năng", ENGAGED_VIEW: "Lượt xem có tương tác", FOLLOWERS: "Người theo dõi", PROFILE_VIEWS: "Xem hồ sơ", TRAFFIC_LANDING_PAGE_VIEW: "Xem trang đích", MT_LIVE_ROOM: "Xem LIVE", CONVERSATION: "Cuộc trò chuyện" },
  placement: { PLACEMENT_TYPE_AUTOMATIC: "Tự động", PLACEMENT_TYPE_NORMAL: "Chọn thủ công" },
  status: {
    ENABLE: "Đang bật", DISABLE: "Đã tắt", DELETE: "Đã xoá", CAMPAIGN_STATUS_ENABLE: "Đang chạy", CAMPAIGN_STATUS_DISABLE: "Đã tắt", CAMPAIGN_STATUS_DELETE: "Đã xoá",
    CAMPAIGN_STATUS_BUDGET_EXCEED: "Hết ngân sách", ADGROUP_STATUS_DELIVERY_OK: "Đang phân phối", ADGROUP_STATUS_DISABLE: "Đã tắt", ADGROUP_STATUS_NOT_DELIVER: "Không phân phối",
    ADGROUP_STATUS_TIME_DONE: "Đã kết thúc", ADGROUP_STATUS_BUDGET_EXCEED: "Hết ngân sách", ADGROUP_STATUS_AUDIT: "Đang duyệt", ADGROUP_STATUS_REAUDIT: "Đang duyệt lại",
    AD_STATUS_DELIVERY_OK: "Đang phân phối", AD_STATUS_DISABLE: "Đã tắt", AD_STATUS_AUDIT: "Đang duyệt", AD_STATUS_REAUDIT: "Đang duyệt lại", AD_STATUS_AUDIT_DENY: "Bị từ chối", AD_STATUS_NOT_DELIVER: "Không phân phối", AD_STATUS_DONE: "Đã kết thúc",
  },
  cta: { LEARN_MORE: "Tìm hiểu thêm", SHOP_NOW: "Mua ngay", SIGN_UP: "Đăng ký", CONTACT_US: "Liên hệ", APPLY_NOW: "Ứng tuyển ngay", BOOK_NOW: "Đặt ngay", DOWNLOAD_NOW: "Tải xuống", ORDER_NOW: "Đặt hàng", GET_QUOTE: "Nhận báo giá", SUBSCRIBE: "Đăng ký theo dõi", WATCH_NOW: "Xem ngay", SEND_MESSAGE: "Gửi tin nhắn", CALL_NOW: "Gọi ngay", VIEW_NOW: "Xem ngay", INTERESTED: "Quan tâm" },
  format: { SINGLE_VIDEO: "Video đơn", SINGLE_IMAGE: "Ảnh đơn", CAROUSEL_ADS: "Băng chuyền", CATALOG_CAROUSEL: "Băng chuyền danh mục", LIVE_CONTENT: "LIVE" },
};
export const ttStatusVi = (s: string | null) => (s ? MAP.status[s] || s.replace(/^(CAMPAIGN|ADGROUP|AD)_STATUS_/, "").toLowerCase() : "");
const tr = (g: string, v: unknown) => { const x = str(v); return x ? MAP[g]?.[x] || x : null; };
const money = (v: unknown, cur: string) => { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN; return Number.isFinite(n) && n > 0 ? `${Math.round(n).toLocaleString("vi-VN")}${cur === "VND" ? "đ" : ` ${cur}`}` : null; };
const push = (o: TTDetail[], label: string, v: string | null, long = false) => { if (v) o.push({ label, value: v, long }); };

export function ttInfoFor(level: string, raw: unknown, currency: string): TTInfo {
  const o = isObj(raw) && isObj(raw.obj) ? raw.obj : {};
  const d: TTDetail[] = [];
  const budgetMode = tr("budget_mode", o.budget_mode);
  const budget = o.budget_mode === "BUDGET_MODE_INFINITE" ? "Không giới hạn" : money(o.budget, currency) ? `${budgetMode ? `${budgetMode} ` : ""}${money(o.budget, currency)}` : null;
  const info: TTInfo = { objective: null, budget, bid: null, optimize: null, placement: null, schedule: null, location: null, details: d, text: null, cta: null, url: null, identity: null, format: null, has_thumb: false };
  if (level === "campaign") {
    info.objective = tr("objective", o.objective_type);
    push(d, "Mục tiêu", info.objective);
    push(d, "Ngân sách", budget);
    push(d, "Loại chiến dịch", str(o.campaign_type));
    push(d, "Tối ưu ngân sách chiến dịch (CBO)", o.budget_optimize_on === true ? "Bật" : o.budget_optimize_on === false ? "Tắt" : null);
    push(d, "Smart+", o.is_smart_performance_campaign === true ? "Có" : null);
  } else if (level === "ad_group") {
    info.bid = tr("bid", o.bid_type) || str(o.bid_type);
    info.optimize = tr("optimize", o.optimization_goal);
    info.placement = tr("placement", o.placement_type);
    const pl = Array.isArray(o.placements) ? o.placements.map(String).join(", ") : null;
    const start = str(o.schedule_start_time), end = str(o.schedule_end_time);
    info.schedule = start ? `${start}${end ? ` → ${end}` : ""}` : null;
    info.location = Array.isArray(o.location_ids) && o.location_ids.length ? `${o.location_ids.length} vị trí` : null;
    push(d, "Mục tiêu tối ưu", info.optimize);
    push(d, "Chiến lược giá thầu", info.bid);
    push(d, "Giá thầu", money(o.bid_price, currency));
    push(d, "Chi phí mục tiêu (CPA)", money(o.conversion_bid_price, currency));
    push(d, "Sự kiện tối ưu", str(o.optimization_event));
    push(d, "Tính phí", str(o.billing_event));
    push(d, "Ngân sách", budget);
    push(d, "Vị trí đặt", [info.placement, pl].filter(Boolean).join(": ") || null, true);
    push(d, "Lịch chạy", info.schedule, true);
    push(d, "Khu vực", info.location);
    push(d, "Độ tuổi", Array.isArray(o.age_groups) && o.age_groups.length ? o.age_groups.map((x) => String(x).replace("AGE_", "").replace("_", "-")).join(", ") : null);
    push(d, "Giới tính", str(o.gender) === "GENDER_MALE" ? "Nam" : str(o.gender) === "GENDER_FEMALE" ? "Nữ" : str(o.gender) === "GENDER_UNLIMITED" ? "Tất cả" : null);
    push(d, "Ngôn ngữ", Array.isArray(o.languages) && o.languages.length ? o.languages.join(", ") : null);
    push(d, "Tệp đối tượng", Array.isArray(o.audience_ids) && o.audience_ids.length ? `${o.audience_ids.length} tệp` : null);
    push(d, "Tệp loại trừ", Array.isArray(o.excluded_audience_ids) && o.excluded_audience_ids.length ? `${o.excluded_audience_ids.length} tệp` : null);
    push(d, "Pixel", str(o.pixel_id));
  } else if (level === "ad") {
    info.text = str(o.ad_text);
    info.cta = tr("cta", o.call_to_action);
    info.url = str(o.landing_page_url);
    info.identity = str(o.display_name) || str(o.identity_id);
    info.format = tr("format", o.ad_format);
    info.has_thumb = Boolean(o.video_id) || (Array.isArray(o.image_ids) && o.image_ids.length > 0);
    push(d, "Định dạng", info.format);
    push(d, "Nội dung quảng cáo", info.text, true);
    push(d, "Nút kêu gọi (CTA)", info.cta);
    push(d, "URL đích", info.url, true);
    push(d, "Danh tính", info.identity);
    push(d, "Video ID", str(o.video_id));
    push(d, "Lý do từ chối", Array.isArray(o.reject_reason) ? o.reject_reason.join("; ") : str(o.reject_reason), true);
  }
  push(d, "Tạo lúc", str(o.create_time));
  push(d, "Cập nhật", str(o.modify_time));
  return info;
}
