/** Standard conversion groups (Google) + auto classification. Shared by server and UI. */
export type ConvGroup = "call" | "zalo" | "messenger" | "form" | "purchase" | "other";
export const CONV_GROUPS: ConvGroup[] = ["call", "zalo", "messenger", "form", "purchase", "other"];
export const CONV_GROUP_LABEL: Record<ConvGroup, string> = {
  call: "Gọi điện", zalo: "Zalo", messenger: "Chat Facebook/Messenger", form: "Đăng ký form", purchase: "Mua hàng", other: "Khác",
};
export type ConvActionRow = {
  id: string; name: string; category: string | null; type: string | null; status: string | null;
  primary: boolean; auto_group: ConvGroup; group: ConvGroup; overridden: boolean;
};
export type ConvActionsRead = { actions: ConvActionRow[]; can_edit: boolean; fetched_at: string | null; error: string | null };
/** month -> action id -> [conversions, all_conversions] */
export type ConvByMonth = Record<string, Record<string, [number, number]>>;

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase();
const CALL_TYPES = /^(AD_CALL|WEBSITE_CALL|CLICK_TO_CALL|CALL_FROM_ADS|GOOGLE_PLAY_.*CALL|STORE_.*CALL)$/;
export function autoGroup(name: string, category: string | null, type: string | null): ConvGroup {
  const n = fold(name);
  const cat = (category || "").replace(/^CONVERSION_ACTION_CATEGORY_/, "");
  const t = (type || "").replace(/^CONVERSION_ACTION_TYPE_/, "");
  if (/zalo/.test(n)) return "zalo";
  if (/mess|chat|\bfb\b|facebook/.test(n)) return "messenger";
  if (cat === "PHONE_CALL_LEAD" || CALL_TYPES.test(t) || /call|goi|hotline|phone|dien thoai/.test(n)) return "call";
  if (cat === "SUBMIT_LEAD_FORM" || cat === "IMPORTED_LEAD" || cat === "QUALIFIED_LEAD" || cat === "CONVERTED_LEAD" || cat === "SIGNUP" || t === "LEAD_FORM_SUBMIT" || /form|dang ky|submit|lead/.test(n)) return "form";
  if (cat === "PURCHASE" || /purchase|mua|thanh toan|checkout/.test(n)) return "purchase";
  return "other";
}
