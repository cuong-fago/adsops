/**
 * VI / EN strings for the customer portal (client_owner / client_staff).
 * Pure module: safe on client and server.
 */

export type Lang = "vi" | "en";

export const LANGS: Lang[] = ["vi", "en"];

export function isLang(v: unknown): v is Lang {
  return v === "vi" || v === "en";
}

export type MetricId =
  | "cost"
  | "impressions"
  | "clicks"
  | "ctr"
  | "cpc"
  | "conversions"
  | "cost_per_conversion"
  | "conv_call"
  | "conv_zalo"
  | "conv_form"
  | "conv_facebook_chat"
  | "conv_other";

type MetricText = { label: string; help: string };

const METRICS: Record<Lang, Record<MetricId, MetricText>> = {
  vi: {
    cost: {
      label: "Chi tiêu",
      help: "Số tiền Google Ads đã tính cho các lượt click/hiển thị trong khoảng ngày đã chọn.",
    },
    impressions: {
      label: "Lượt hiển thị",
      help: "Số lần quảng cáo được hiển thị cho người tìm kiếm. Một người có thể thấy quảng cáo nhiều lần.",
    },
    clicks: {
      label: "Lượt click",
      help: "Số lần người xem bấm vào quảng cáo. Google đã loại các click không hợp lệ khỏi con số này.",
    },
    ctr: {
      label: "CTR",
      help: "Tỷ lệ click = Lượt click ÷ Lượt hiển thị. Cho biết quảng cáo hấp dẫn đến đâu với người đã thấy nó.",
    },
    cpc: {
      label: "CPC",
      help: "Chi phí trung bình cho mỗi click = Chi tiêu ÷ Lượt click.",
    },
    conversions: {
      label: "Chuyển đổi (Google Ads ghi nhận)",
      help: "Số hành động Google Ads ghi nhận sau click: bấm gọi, bấm chat Zalo, gửi form… Đây là số Google Ads đếm, chưa phải khách hàng tiềm năng đã được xác thực. Có thể là số lẻ do Google phân bổ chuyển đổi.",
    },
    cost_per_conversion: {
      label: "Chi phí / chuyển đổi",
      help: "Chi tiêu ÷ Số chuyển đổi Google Ads ghi nhận. Không phải chi phí cho mỗi khách hàng thật.",
    },
    conv_call: { label: "Gọi", help: "Chuyển đổi Google Ads ghi nhận khi người xem bấm gọi điện từ quảng cáo hoặc website." },
    conv_zalo: { label: "Zalo", help: "Chuyển đổi Google Ads ghi nhận khi người xem bấm chat Zalo." },
    conv_form: { label: "Form", help: "Chuyển đổi Google Ads ghi nhận khi người xem gửi form liên hệ / đăng ký." },
    conv_facebook_chat: { label: "Chat Facebook", help: "Chuyển đổi Google Ads ghi nhận khi người xem bấm chat Facebook/Messenger." },
    conv_other: { label: "Khác", help: "Các chuyển đổi Google Ads khác không thuộc Gọi / Zalo / Form (ví dụ đặt hàng, chat khác)." },
  },
  en: {
    cost: {
      label: "Spend",
      help: "What Google Ads charged for clicks/impressions in the selected date range.",
    },
    impressions: {
      label: "Impressions",
      help: "How many times your ads were shown. One person can see an ad several times.",
    },
    clicks: {
      label: "Clicks",
      help: "How many times people clicked your ads. Google already removes invalid clicks from this number.",
    },
    ctr: {
      label: "CTR",
      help: "Click-through rate = Clicks ÷ Impressions. How appealing the ad is to people who saw it.",
    },
    cpc: {
      label: "CPC",
      help: "Average cost per click = Spend ÷ Clicks.",
    },
    conversions: {
      label: "Conversions (recorded by Google Ads)",
      help: "Actions Google Ads recorded after a click: call taps, Zalo chat taps, form submits… These are Google Ads-recorded conversions, not verified qualified leads. They can be fractional because Google attributes conversions.",
    },
    cost_per_conversion: {
      label: "Cost / conversion",
      help: "Spend ÷ Google Ads-recorded conversions. This is not the cost per real customer.",
    },
    conv_call: { label: "Calls", help: "Conversions Google Ads recorded when someone tapped to call." },
    conv_zalo: { label: "Zalo", help: "Conversions Google Ads recorded when someone tapped to chat on Zalo." },
    conv_form: { label: "Form", help: "Conversions Google Ads recorded when someone submitted a contact / sign-up form." },
    conv_facebook_chat: { label: "Facebook chat", help: "Conversions Google Ads recorded when someone tapped to chat on Facebook/Messenger." },
    conv_other: { label: "Other", help: "Other Google Ads conversions that are not Calls / Zalo / Form (e.g. orders, other chats)." },
  },
};

export function metricText(lang: Lang, id: MetricId): MetricText {
  return METRICS[lang][id];
}

const STR = {
  vi: {
    brand_sub: "Báo cáo quảng cáo Google Ads",
    account: "Tài khoản quảng cáo",
    tab_overview: "Tổng quan",
    tab_analytics: "Phân tích",
    sign_out: "Đăng xuất",
    lang_label: "Ngôn ngữ",
    range: "Khoảng ngày",
    preset_7: "7 ngày",
    preset_14: "14 ngày",
    preset_30: "30 ngày",
    preset_this_month: "Tháng này",
    preset_last_month: "Tháng trước",
    preset_all: "Toàn bộ",
    preset_custom: "Tùy chọn",
    from: "Từ",
    to: "Đến",
    apply: "Xem",
    showing: "Đang xem",
    days_with_data: "ngày có dữ liệu",
    kpis: "Chỉ số chính",
    conv_split: "Chuyển đổi theo loại",
    trend: "Diễn biến theo ngày",
    trend_conv: "Chuyển đổi theo loại, theo ngày",
    campaigns: "Chiến dịch",
    campaign: "Chiến dịch",
    status: "Trạng thái",
    no_spend_in_range: "Không chi tiêu trong khoảng này",
    commentary: "Nhận xét tự động",
    commentary_note:
      "Nhận xét được tạo tự động theo quy tắc cố định từ đúng số liệu phía trên — không suy đoán thêm.",
    conv_disclaimer:
      "Chuyển đổi là số Google Ads ghi nhận (bấm gọi, chat, gửi form…), chưa phải khách hàng tiềm năng đã được xác thực.",
    fresh_time: "Số liệu Google Ads cập nhật đến {time} ngày {date} (giờ Việt Nam)",
    fresh_day: "Số liệu Google Ads đến hết ngày {date}",
    loading: "Đang tải số liệu…",
    load_error: "Không tải được số liệu. Thử tải lại trang.",
    no_accounts: "Tài khoản của bạn chưa được cấp tài khoản quảng cáo nào. Vui lòng liên hệ Fago.",
    empty_range:
      "Không có số liệu Google Ads trong khoảng {range}. Dữ liệu hiện có cho tài khoản này: {have}.",
    empty_account:
      "Tài khoản này chưa có số liệu Google Ads trong kho (tài khoản mới, đang tạm dừng hoặc chưa được đồng bộ). Khoảng đang xem: {range}.",
    empty_none:
      "Tài khoản này chưa có số liệu Google Ads nào trong kho (tài khoản mới, đang tạm dừng hoặc chưa được đồng bộ).",
    missing_days: "Có {n} ngày trong khoảng {range} chưa có số liệu; các ngày đó được để trống, không tính là 0.",
    info: "Giải thích",
    metric: "Chỉ số",
    of_spend: "chi tiêu",
    view_as_banner: "Đang xem như: {label} — chỉ đọc.",
    exit_view_as: "Thoát chế độ xem",
    footer: "Fago Group · Báo cáo chỉ đọc. Mọi thay đổi chiến dịch do đội Fago thực hiện.",
    analytics_note: "Bảng phân tích đầy đủ theo chiến dịch, nhóm quảng cáo, từ khóa (không so sánh kỳ trước).",
  },
  en: {
    brand_sub: "Google Ads report",
    account: "Ad account",
    tab_overview: "Overview",
    tab_analytics: "Analytics",
    sign_out: "Sign out",
    lang_label: "Language",
    range: "Date range",
    preset_7: "7 days",
    preset_14: "14 days",
    preset_30: "30 days",
    preset_this_month: "This month",
    preset_last_month: "Last month",
    preset_all: "All",
    preset_custom: "Custom",
    from: "From",
    to: "To",
    apply: "Show",
    showing: "Showing",
    days_with_data: "days with data",
    kpis: "Key metrics",
    conv_split: "Conversions by type",
    trend: "Daily trend",
    trend_conv: "Conversions by type, per day",
    campaigns: "Campaigns",
    campaign: "Campaign",
    status: "Status",
    no_spend_in_range: "No spend in this range",
    commentary: "Automatic commentary",
    commentary_note:
      "Generated automatically with fixed rules from exactly the numbers above — nothing else is inferred.",
    conv_disclaimer:
      "Conversions are what Google Ads recorded (call taps, chats, form submits…), not verified qualified leads.",
    fresh_time: "Google Ads data updated to {time} on {date} (Vietnam time)",
    fresh_day: "Google Ads data through {date}",
    loading: "Loading data…",
    load_error: "Could not load data. Please reload the page.",
    no_accounts: "Your login has no ad account assigned yet. Please contact Fago.",
    empty_range: "No Google Ads data in {range}. Data available for this account: {have}.",
    empty_account:
      "This account has no Google Ads data yet (new, paused or not synced). Range shown: {range}.",
    empty_none: "This account has no Google Ads data yet (new, paused or not synced).",
    missing_days: "{n} day(s) in {range} have no data yet; they are left blank, not counted as 0.",
    info: "Explain",
    metric: "Metric",
    of_spend: "of spend",
    view_as_banner: "Viewing as: {label} — read only.",
    exit_view_as: "Exit view",
    footer: "Fago Group · Read-only report. Campaign changes are made by the Fago team.",
    analytics_note: "Full breakdown by campaign, ad group, keyword (no previous-period comparison).",
  },
} as const;

export type StrKey = keyof (typeof STR)["vi"];

export function t(lang: Lang, key: StrKey, vars?: Record<string, string | number>): string {
  let s: string = STR[lang][key] ?? STR.vi[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function statusText(lang: Lang, raw?: string): string {
  const code = String(raw || "").toUpperCase();
  const vi: Record<string, string> = { ENABLED: "Đang chạy", ACTIVE: "Đang chạy", PAUSED: "Tạm dừng", REMOVED: "Đã gỡ", ENDED: "Kết thúc" };
  const en: Record<string, string> = { ENABLED: "Running", ACTIVE: "Running", PAUSED: "Paused", REMOVED: "Removed", ENDED: "Ended" };
  return (lang === "en" ? en : vi)[code] || raw || "—";
}
