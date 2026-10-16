/** Pure formatting of stored Meta structure config into Vietnamese labels. Missing = null (blank). */
type O = Record<string, unknown>;
const obj = (v: unknown): O | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as O) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : null);
const names = (v: unknown): string[] => arr(v).map((x) => str(obj(x)?.name) || str(x)).filter((x): x is string => Boolean(x));

export const OBJECTIVE_VI: Record<string, string> = {
  OUTCOME_LEADS: "Khách hàng tiềm năng", OUTCOME_SALES: "Doanh số", OUTCOME_TRAFFIC: "Lưu lượng truy cập",
  OUTCOME_ENGAGEMENT: "Tương tác", OUTCOME_AWARENESS: "Nhận biết", OUTCOME_APP_PROMOTION: "Quảng bá ứng dụng",
  LEAD_GENERATION: "Khách hàng tiềm năng", MESSAGES: "Tin nhắn", CONVERSIONS: "Chuyển đổi", LINK_CLICKS: "Lượt click liên kết",
  POST_ENGAGEMENT: "Tương tác bài viết", PAGE_LIKES: "Lượt thích trang", REACH: "Phạm vi tiếp cận", BRAND_AWARENESS: "Nhận biết thương hiệu",
  VIDEO_VIEWS: "Lượt xem video", APP_INSTALLS: "Lượt cài ứng dụng", PRODUCT_CATALOG_SALES: "Doanh số danh mục", STORE_VISITS: "Lượt ghé cửa hàng",
};
export const STATUS_VI: Record<string, string> = {
  ACTIVE: "Đang chạy", PAUSED: "Tạm dừng", DELETED: "Đã xoá", ARCHIVED: "Lưu trữ", IN_PROCESS: "Đang xử lý", WITH_ISSUES: "Có vấn đề",
  CAMPAIGN_PAUSED: "Chiến dịch tạm dừng", ADSET_PAUSED: "Nhóm tạm dừng", DISAPPROVED: "Bị từ chối", PENDING_REVIEW: "Đang duyệt",
  PREAPPROVED: "Đã duyệt trước", PENDING_BILLING_INFO: "Chờ thanh toán",
};
const BUYING_VI: Record<string, string> = { AUCTION: "Đấu giá", RESERVED: "Đặt trước (Phạm vi & tần suất)" };
const GOAL_VI: Record<string, string> = {
  LEAD_GENERATION: "Khách hàng tiềm năng", QUALITY_LEAD: "Khách hàng tiềm năng chất lượng", CONVERSATIONS: "Cuộc trò chuyện",
  LINK_CLICKS: "Click liên kết", LANDING_PAGE_VIEWS: "Xem trang đích", OFFSITE_CONVERSIONS: "Chuyển đổi", REACH: "Tiếp cận",
  IMPRESSIONS: "Hiển thị", POST_ENGAGEMENT: "Tương tác bài viết", PAGE_LIKES: "Thích trang", PROFILE_AND_PAGE_ENGAGEMENT: "Tương tác trang/hồ sơ",
  THRUPLAY: "ThruPlay", VIDEO_VIEWS: "Xem video", VALUE: "Giá trị", APP_INSTALLS: "Cài ứng dụng", QUALITY_CALL: "Cuộc gọi chất lượng",
  REPLIES: "Phản hồi", AD_RECALL_LIFT: "Nhớ quảng cáo", ENGAGED_USERS: "Người tương tác",
};
const BILLING_VI: Record<string, string> = { IMPRESSIONS: "Lượt hiển thị", LINK_CLICKS: "Click liên kết", THRUPLAY: "ThruPlay", POST_ENGAGEMENT: "Tương tác" };
const BID_VI: Record<string, string> = {
  LOWEST_COST_WITHOUT_CAP: "Chi phí thấp nhất", LOWEST_COST_WITH_BID_CAP: "Giới hạn giá thầu", COST_CAP: "Giới hạn chi phí",
  LOWEST_COST_WITH_MIN_ROAS: "ROAS tối thiểu", TARGET_COST: "Chi phí mục tiêu",
};
const CTA_VI: Record<string, string> = {
  LEARN_MORE: "Tìm hiểu thêm", BOOK_TRAVEL: "Đặt ngay", BOOK_NOW: "Đặt ngay", SHOP_NOW: "Mua ngay", BUY_NOW: "Mua ngay",
  SIGN_UP: "Đăng ký", CONTACT_US: "Liên hệ", MESSAGE_PAGE: "Gửi tin nhắn", SEND_MESSAGE: "Gửi tin nhắn",
  INSTAGRAM_MESSAGE: "Gửi tin nhắn", WHATSAPP_MESSAGE: "Gửi tin nhắn", CALL_NOW: "Gọi ngay", APPLY_NOW: "Ứng tuyển",
  GET_OFFER: "Nhận ưu đãi", SUBSCRIBE: "Đăng ký theo dõi", DOWNLOAD: "Tải xuống", WATCH_MORE: "Xem thêm", NO_BUTTON: "Không có nút",
  GET_QUOTE: "Nhận báo giá", ORDER_NOW: "Đặt hàng", LIKE_PAGE: "Thích trang", GET_DIRECTIONS: "Chỉ đường",
  VISIT_PROFILE: "Xem trang cá nhân", SEE_MORE: "Xem thêm", CONTACT: "Liên hệ", SEND_UPDATES: "Nhận cập nhật",
};
/** Platform note for message CTAs. */
const CTA_NOTE: Record<string, string> = { MESSAGE_PAGE: "Messenger", SEND_MESSAGE: "Messenger", INSTAGRAM_MESSAGE: "Instagram", WHATSAPP_MESSAGE: "WhatsApp" };
const humanize = (s: string) => s.toLowerCase().split("_").map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
const PLATFORM_VI: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", audience_network: "Audience Network", messenger: "Messenger", threads: "Threads" };
const lab = (m: Record<string, string>, v: unknown): string | null => { const s = str(v); return s ? m[s] || s : null; };
export const objectiveVi = (v: unknown) => lab(OBJECTIVE_VI, v);
export const statusVi = (v: unknown) => lab(STATUS_VI, v);
export const ctaVi = (v: unknown): string | null => { const s = str(v); return s ? CTA_VI[s] || humanize(s) : null; };

/** Graph budgets are in the currency's minor unit; VND (and other zero-decimal currencies) have none. */
const ZERO_DEC = new Set(["VND", "JPY", "KRW", "IDR", "CLP", "COP", "HUF", "ISK", "PYG", "TWD"]);
export function budgetValue(v: unknown, currency: string): number | null {
  const n = Number(str(v));
  if (!Number.isFinite(n) || n <= 0) return null;
  return ZERO_DEC.has(currency) ? n : n / 100;
}
export function budgetOf(cfgIn: unknown, currency: string): { kind: "daily" | "lifetime"; value: number } | null {
  const cfg = obj(cfgIn);
  const d = budgetValue(cfg?.daily_budget, currency);
  if (d != null) return { kind: "daily", value: d };
  const l = budgetValue(cfg?.lifetime_budget, currency);
  return l != null ? { kind: "lifetime", value: l } : null;
}

export type CampaignMeta = { objective: string | null; buying_type: string | null; bid_strategy: string | null };
export function campaignMeta(cfgIn: unknown): CampaignMeta {
  const cfg = obj(cfgIn);
  return { objective: objectiveVi(cfg?.objective), buying_type: lab(BUYING_VI, cfg?.buying_type), bid_strategy: lab(BID_VI, cfg?.bid_strategy) };
}

const day = (v: unknown) => { const s = str(v); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : null; };

function geo(g: O | null, prefix = ""): string[] {
  if (!g) return [];
  const out: string[] = [];
  const countries = arr(g.countries).map((c) => str(c)).filter(Boolean) as string[];
  if (countries.length) out.push(`${prefix}Quốc gia: ${countries.join(", ")}`);
  const regions = names(g.regions);
  if (regions.length) out.push(`${prefix}Vùng: ${regions.join(", ")}`);
  const cities = arr(g.cities).map((c) => {
    const o = obj(c);
    const n = str(o?.name) || str(o?.key);
    const r = str(o?.radius);
    return n ? (r ? `${n} (+${r} ${str(o?.distance_unit) === "mile" ? "dặm" : "km"})` : n) : null;
  }).filter(Boolean) as string[];
  if (cities.length) out.push(`${prefix}Thành phố: ${cities.join(", ")}`);
  const pins = arr(g.custom_locations).map((c) => {
    const o = obj(c);
    const n = str(o?.name) || str(o?.address_string) || (o?.latitude != null ? `${o.latitude},${o.longitude}` : null);
    const r = str(o?.radius);
    return n ? (r ? `${n} (+${r} ${str(o?.distance_unit) === "mile" ? "dặm" : "km"})` : n) : null;
  }).filter(Boolean) as string[];
  if (pins.length) out.push(`${prefix}Ghim vị trí: ${pins.join("; ")}`);
  const zips = names(g.zips);
  if (zips.length) out.push(`${prefix}Mã bưu chính: ${zips.length}`);
  return out;
}

function detailed(spec: O | null): string[] {
  if (!spec) return [];
  const groups: Array<[string, string]> = [
    ["interests", "Sở thích"], ["behaviors", "Hành vi"], ["life_events", "Sự kiện"], ["family_statuses", "Gia đình"],
    ["industries", "Ngành"], ["work_positions", "Chức danh"], ["work_employers", "Nơi làm"], ["education_schools", "Trường"],
    ["income", "Thu nhập"], ["relationship_statuses", "Tình trạng"], ["user_adclusters", "Nhóm"],
  ];
  const out: string[] = [];
  for (const [k, label] of groups) {
    const n = names(spec[k]);
    if (n.length) out.push(`${label}: ${n.join(", ")}`);
  }
  return out;
}

export type TargetingSummary = {
  /** One short line for the table. */
  short: string | null;
  /** Labeled lines for the expanded view. */
  lines: Array<{ label: string; value: string }>;
};

/** Ad set targeting + delivery settings as readable Vietnamese. */
export function adsetSummary(cfgIn: unknown, currency: string, fmtMoney: (v: number) => string): TargetingSummary {
  const cfg = obj(cfgIn);
  const t = obj(cfg?.targeting);
  const lines: Array<{ label: string; value: string }> = [];
  const add = (label: string, value: string | null | undefined) => { if (value) lines.push({ label, value }); };
  const short: string[] = [];
  if (t) {
    const amin = str(t.age_min), amax = str(t.age_max);
    const age = amin || amax ? `${amin || "?"}–${amax || "?"}${amax === "65" ? "+" : ""}` : null;
    const ageRange = arr(t.age_range);
    add("Tuổi", age ? `${age}${ageRange.length === 2 ? ` (gợi ý ${ageRange[0]}–${ageRange[1]})` : ""}` : null);
    const g = arr(t.genders).map(Number);
    const gender = !g.length ? "Tất cả" : g.includes(1) && g.includes(2) ? "Tất cả" : g.includes(1) ? "Nam" : g.includes(2) ? "Nữ" : null;
    add("Giới tính", gender);
    if (age) short.push(age);
    if (gender && gender !== "Tất cả") short.push(gender);
    const geos = geo(obj(t.geo_locations));
    const lt = arr(obj(t.geo_locations)?.location_types).map(String);
    for (const x of geos) { const [l, ...v] = x.split(": "); add(l, v.join(": ")); }
    if (lt.length) add("Kiểu vị trí", lt.map((x) => (x === "home" ? "Sống ở" : x === "recent" ? "Gần đây" : x === "travel_in" ? "Đang du lịch" : x)).join(", "));
    const firstGeo = geos[0]?.split(": ")[1];
    if (firstGeo) short.push(firstGeo.length > 40 ? `${firstGeo.slice(0, 40)}…` : firstGeo);
    for (const x of geo(obj(t.excluded_geo_locations))) { const [l, ...v] = x.split(": "); add(`Loại trừ ${l.toLowerCase()}`, v.join(": ")); }
    const flex = arr(t.flexible_spec).map((s) => detailed(obj(s))).filter((x) => x.length);
    flex.forEach((group, i) => add(flex.length > 1 ? `Nhắm chi tiết (nhóm ${i + 1}, VÀ)` : "Nhắm chi tiết", group.join(" · ")));
    const top = detailed(t);
    if (top.length) add("Nhắm chi tiết", top.join(" · "));
    const nInterests = flex.flat().length + top.length;
    if (nInterests) short.push(`${nInterests} nhóm sở thích`);
    const ex = detailed(obj(t.exclusions));
    if (ex.length) add("Loại trừ chi tiết", ex.join(" · "));
    const ca = names(t.custom_audiences);
    if (ca.length) { add("Đối tượng tuỳ chỉnh / tương tự", ca.join(", ")); short.push(`${ca.length} đối tượng`); }
    const xca = names(t.excluded_custom_audiences);
    if (xca.length) add("Loại trừ đối tượng", xca.join(", "));
    const adv = Number(obj(t.targeting_automation)?.advantage_audience);
    if (Number.isFinite(adv)) { add("Advantage+ đối tượng", adv === 1 ? "Bật" : "Tắt"); if (adv === 1) short.push("Advantage+"); }
    const pubs = arr(t.publisher_platforms).map(String);
    const positions = [
      ...arr(t.facebook_positions).map((p) => `FB ${p}`),
      ...arr(t.instagram_positions).map((p) => `IG ${p}`),
      ...arr(t.messenger_positions).map((p) => `Messenger ${p}`),
      ...arr(t.audience_network_positions).map((p) => `AN ${p}`),
    ];
    add("Vị trí", pubs.length ? `${pubs.map((p) => PLATFORM_VI[p] || p).join(", ")}${positions.length ? ` — ${positions.join(", ")}` : ""}` : "Tự động (Advantage+ placements)");
    const devices = arr(t.device_platforms).map(String);
    if (devices.length) add("Thiết bị", devices.map((d) => (d === "mobile" ? "Di động" : d === "desktop" ? "Máy tính" : d)).join(", "));
    const locales = arr(t.locales);
    if (locales.length) add("Ngôn ngữ", `${locales.length} ngôn ngữ`);
  }
  add("Mục tiêu tối ưu", lab(GOAL_VI, cfg?.optimization_goal));
  add("Tính phí theo", lab(BILLING_VI, cfg?.billing_event));
  const bid = lab(BID_VI, cfg?.bid_strategy);
  const bidAmt = budgetValue(cfg?.bid_amount, currency);
  add("Chiến lược giá thầu", bid ? `${bid}${bidAmt != null ? ` (${fmtMoney(bidAmt)})` : ""}` : null);
  const b = budgetOf(cfg, currency);
  add("Ngân sách", b ? `${fmtMoney(b.value)} ${b.kind === "daily" ? "/ ngày" : "trọn đời"}` : null);
  const s = day(cfg?.start_time), e = day(cfg?.end_time);
  add("Lịch chạy", s ? `${s} → ${e || "không kết thúc"}` : null);
  return { short: short.length ? short.join(" · ") : null, lines };
}

export type CreativeView = {
  thumb: string | null;
  body: string | null;
  title: string | null;
  /** Vietnamese CTA label; null = Meta gave no CTA. */
  cta: string | null;
  cta_note: string | null;
  link: string | null;
  post_url: string | null;
  preview_url: string | null;
};
/** Creative fields with fallbacks into object_story_spec / asset_feed_spec (dynamic creative / Advantage+). */
export function creativeOf(cfgIn: unknown): CreativeView {
  const cfg = obj(cfgIn);
  const c = obj(cfg?.creative);
  const oss = obj(c?.object_story_spec);
  const link = obj(oss?.link_data);
  const video = obj(oss?.video_data);
  const photo = obj(oss?.photo_data);
  const feed = obj(c?.asset_feed_spec);
  const firstText = (v: unknown) => arr(v).map((x) => str(obj(x)?.text)?.trim()).find((x) => x) || null;
  const story = str(c?.effective_object_story_id);
  const ctaType =
    str(c?.call_to_action_type) || str(obj(link?.call_to_action)?.type) || str(obj(video?.call_to_action)?.type) || str(arr(feed?.call_to_action_types)[0]);
  const clean = (s: string | null) => (s ? s.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() || null : null);
  return {
    thumb: str(c?.thumbnail_url) || str(c?.image_url) || str(video?.image_url) || str(link?.picture),
    body: clean(str(c?.body) || str(link?.message) || str(video?.message) || str(photo?.caption) || firstText(feed?.bodies)),
    title: clean(str(c?.title) || str(link?.name) || str(video?.title) || firstText(feed?.titles)),
    cta: ctaType ? ctaVi(ctaType) : null,
    cta_note: ctaType ? CTA_NOTE[ctaType] || null : null,
    link: str(link?.link) || str(obj(obj(video?.call_to_action)?.value)?.link) || str(obj(arr(feed?.link_urls)[0])?.website_url),
    post_url: story ? `https://www.facebook.com/${story}` : null,
    preview_url: str(cfg?.preview_shareable_link),
  };
}
