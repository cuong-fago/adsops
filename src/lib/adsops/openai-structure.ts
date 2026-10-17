/** Turn stored OpenAI objects into Vietnamese detail lines. Pure; "-" never invented here — absent = omitted / "-" in UI. */
export type OADetail = { label: string; value: string; long?: boolean };
export type OAInfo = {
  kind: string | null;
  bid_strategy: string | null;
  hints: string[];
  details: OADetail[];
  has_image: boolean;
  review: string | null;
};

const MAP: Record<string, Record<string, string>> = {
  objective: { conversions: "Lượt chuyển đổi", clicks: "Lượt click", traffic: "Lưu lượng truy cập", awareness: "Nhận biết", impressions: "Lượt hiển thị", reach: "Phạm vi tiếp cận", sales: "Doanh số", leads: "Khách hàng tiềm năng" },
  bidding_type: { conversions: "Tối ưu chuyển đổi", clicks: "Tối ưu click", impressions: "Tối ưu hiển thị" },
  billing: { click: "Theo click (CPC)", impression: "Theo hiển thị (CPM)", conversion: "Theo chuyển đổi" },
  strategy: { maximize_conversions: "Tối đa hoá chuyển đổi", maximize_clicks: "Tối đa hoá click", fixed_bid: "Giá thầu cố định", target_cpa: "CPA mục tiêu", target_cost: "Chi phí mục tiêu", cost_cap: "Giới hạn chi phí", bid_cap: "Giới hạn giá thầu", lowest_cost: "Chi phí thấp nhất", manual: "Thủ công" },
  review: { approved: "Đã duyệt", pending: "Đang duyệt", in_review: "Đang duyệt", rejected: "Bị từ chối", disapproved: "Bị từ chối", needs_changes: "Cần sửa" },
  creative: { chat_card: "Thẻ trong chat", product: "Sản phẩm", product_template: "Mẫu sản phẩm" },
  platform: { web: "Web", desktop_web: "Web máy tính", ios_web: "Web iOS", android_web: "Web Android", ios_app: "Ứng dụng iOS", android_app: "Ứng dụng Android" },
};
const tr = (group: string, v: unknown) => (typeof v === "string" && v ? MAP[group]?.[v] || v : null);
const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const money = (micros: unknown, cur: string) => (typeof micros === "number" ? `${Math.round(micros / 1_000_000).toLocaleString("vi-VN")}${cur === "VND" ? "đ" : ` ${cur}`}` : null);
const dt = (v: unknown) => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v * 1000 : Date.parse(String(v));
  return Number.isFinite(n) ? new Date(n).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : null;
};

function targeting(t: unknown): OADetail[] {
  if (!isObj(t)) return [];
  const out: OADetail[] = [];
  const loc = isObj(t.locations) ? t.locations : null;
  const names = (arr: unknown) => (Array.isArray(arr) ? arr.map((x) => (isObj(x) ? String(x.name || x.id || "") : String(x))).filter(Boolean) : []);
  if (loc) {
    const inc = [...names(loc.include), ...names(loc.countries)];
    const exc = names(loc.exclude);
    if (inc.length) out.push({ label: "Vị trí nhắm", value: inc.join(", "), long: true });
    if (exc.length) out.push({ label: "Vị trí loại trừ", value: exc.join(", "), long: true });
  }
  const pl = isObj(t.platforms) ? t.platforms : null;
  if (pl && Array.isArray(pl.included) && pl.included.length) out.push({ label: "Nền tảng", value: pl.included.map((x) => tr("platform", x) || String(x)).join(", ") });
  for (const [k, v] of Object.entries(t)) {
    if (k === "locations" || k === "platforms" || v == null) continue;
    out.push({ label: `Nhắm mục tiêu: ${k}`, value: typeof v === "string" ? v : JSON.stringify(v), long: true });
  }
  return out;
}

function push(out: OADetail[], label: string, v: string | null | undefined, long = false) {
  if (v != null && v !== "") out.push({ label, value: v, long });
}

export function infoFor(level: string, raw: unknown, currency: string): OAInfo {
  const o = isObj(raw) && isObj(raw.obj) ? raw.obj : null;
  const r = isObj(raw) ? raw : {};
  const out: OADetail[] = [];
  let kind: string | null = null, bid: string | null = null, hints: string[] = [], review: string | null = null;
  if (o && level === "campaign") {
    kind = tr("objective", o.objective);
    const b = isObj(o.budget) ? o.budget : {};
    push(out, "Loại (mục tiêu)", kind);
    push(out, "Kiểu đặt giá thầu", tr("bidding_type", o.bidding_type));
    push(out, "Tính phí", tr("billing", o.billing_event_type));
    push(out, "Ngân sách / ngày", money(b.daily_spend_limit_micros, currency));
    push(out, "Ngân sách trọn đời", money(b.lifetime_spend_limit_micros, currency));
    push(out, "Bắt đầu", dt(o.start_time));
    push(out, "Kết thúc", dt(o.end_time) || (o.start_time || o.end_time ? null : "Không đặt (chạy liên tục)"));
    push(out, "Sự kiện chuyển đổi", Array.isArray(o.conversion_event_setting_ids) && o.conversion_event_setting_ids.length ? `${o.conversion_event_setting_ids.length} sự kiện` : null);
    out.push(...targeting(o.targeting));
    push(out, "Mô tả", typeof o.description === "string" ? o.description : null, true);
    bid = tr("bidding_type", o.bidding_type);
  } else if (o && level === "ad_group") {
    const bc = isObj(o.bidding_config) ? o.bidding_config : {};
    bid = tr("strategy", bc.strategy);
    push(out, "Chiến lược giá thầu", bid);
    push(out, "Giá thầu tối đa", money(bc.max_bid_micros, currency));
    push(out, "Giá thầu mục tiêu", money(bc.target_bid_micros ?? bc.target_cpa_micros, currency));
    push(out, "Tính phí", tr("billing", bc.billing_event_type));
    hints = Array.isArray(o.context_hints) ? o.context_hints.map(String) : [];
    if (isObj(o.product_set)) push(out, "Bộ sản phẩm", JSON.stringify(o.product_set), true);
    if (Array.isArray(o.audience_bid_multipliers) && o.audience_bid_multipliers.length) push(out, "Hệ số giá thầu theo tệp", JSON.stringify(o.audience_bid_multipliers), true);
    push(out, "Mô tả", typeof o.description === "string" ? o.description : null, true);
  } else if (o && level === "ad") {
    const c = isObj(o.creative) ? o.creative : {};
    review = tr("review", o.review_status ?? (isObj(o.review) ? o.review.status : null));
    push(out, "Định dạng", tr("creative", c.type));
    push(out, "Tiêu đề", typeof c.title === "string" ? c.title : null, true);
    push(out, "Mô tả", typeof c.body === "string" ? c.body : null, true);
    push(out, "URL đích", typeof c.target_url === "string" ? c.target_url : null, true);
    push(out, "Nút kêu gọi (CTA)", typeof c.cta === "string" ? c.cta : typeof c.call_to_action === "string" ? c.call_to_action : null);
    push(out, "Trạng thái duyệt", review);
    if (Array.isArray(o.serving_issues)) push(out, "Vấn đề phân phối", o.serving_issues.length ? o.serving_issues.map((x) => (isObj(x) ? String(x.message || x.code || JSON.stringify(x)) : String(x))).join("; ") : "Không có", true);
    if (o.appeal) push(out, "Kháng nghị", JSON.stringify(o.appeal), true);
    if (o.geographic_targeting_blocked === true) push(out, "Nhắm vị trí", "Bị chặn");
  }
  if (o) {
    push(out, "Tạo lúc", dt(o.created_at));
    push(out, "Cập nhật", dt(o.updated_at));
    push(out, "Mã nội bộ", typeof o.user_external_id === "string" ? o.user_external_id : null, true);
  }
  return { kind, bid_strategy: bid, hints, details: out, has_image: r.has_image === true, review };
}
