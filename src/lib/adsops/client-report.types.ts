/** "Báo cáo khách hàng" — shared types + deterministic summary text. No server imports. */

export type Totals = {
  spend: number | null;
  leads: number | null;
  valid: number | null;
  closed: number | null;
  revenue: number | null;
  cpl: number | null;
  cost_per_valid: number | null;
  roas: number | null;
  /** Outcomes (valid / closed / revenue) only exist for whole calendar months entered by staff. */
  has_outcome: boolean;
};

export type Channel = { spend: number | null; leads: number | null; cpl: number | null };
export type CampRow = { platform: "google" | "facebook" | "chatgpt"; name: string; spend: number; leads: number | null; cpl: number | null };

export type ReportData = {
  version: 1;
  client_name: string;
  period: { kind: "week" | "month" | "custom"; start: string; end: string; label: string };
  prev: { start: string; end: string; label: string };
  accounts: { client_id: string; label: string; platform: "google" | "facebook" | "chatgpt" }[];
  data_through: string | null;
  cur: Totals;
  prev_totals: Totals;
  targets: { cpl: number | null; cac: number | null; roas: number | null; leads: number | null; budget: number | null };
  /** chatgpt is absent on snapshots made before ChatGPT Ads existed. */
  channels: { google: Channel | null; facebook: Channel | null; chatgpt?: Channel | null };
  campaigns: { top: CampRow[]; bottom: CampRow[]; no_lead: CampRow[] };
  /** Google "Nhật ký tối ưu"; null = no Google account. */
  work: { keywords_added: number; negatives_added: number; est_savings: number | null; est_terms: number; est_basis: string } | null;
  suggestions: string[];
  appendix: { impressions: number | null; clicks: number | null; cpm: number | null; ctr: number | null; cpc: number | null; is: number | null; is_lost_budget: number | null; qs: number | null };
  notes_data: string[];
  generated_at: string;
};

export type ReportNotes = { good?: string; issues?: string; plan?: string; edited?: boolean };
export type ReportOptions = { show_work?: boolean; show_appendix?: boolean };

export type ReportListRow = {
  id: number;
  scope_kind: "group" | "account";
  scope_id: string;
  title: string;
  period_kind: string;
  start_date: string;
  end_date: string;
  status: "draft" | "sent";
  generated: boolean;
  auto: boolean;
  sent_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  links: { id: number; expires_at: string; revoked: boolean; views: number }[];
};

export type ScopeMember = { id: string; label: string; name: string | null; ext: string | null; platform: "google" | "facebook" | "chatgpt" };
export type ScopeOption = { kind: "group" | "account"; id: string; label: string; accounts: string[]; schedule: "weekly" | "monthly" | null; members: ScopeMember[] };

export const STATUS_VI: Record<"draft" | "sent", string> = { draft: "Nháp", sent: "Đã gửi" };

const dong = (v: number) => `${Math.round(v).toLocaleString("vi-VN")}đ`;
const n0 = (v: number) => Math.round(v).toLocaleString("vi-VN");
const pctAbs = (v: number) => `${Math.abs(Math.round(v * 100))}%`;
export function delta(cur: number | null, prev: number | null): number | null {
  return cur != null && prev != null && prev > 0 ? cur / prev - 1 : null;
}

/** Plain-sentence summary from the snapshot only (template, never invented). */
export function summarize(d: ReportData): string[] {
  const out: string[] = [];
  const c = d.cur, p = d.prev_totals;
  if (c.spend == null) {
    out.push(`Chưa có số liệu chi tiêu cho ${d.period.label}.`);
    return out;
  }
  const parts: string[] = [];
  if (d.channels.facebook?.spend != null) parts.push(`Facebook ${dong(d.channels.facebook.spend)}`);
  if (d.channels.google?.spend != null) parts.push(`Google ${dong(d.channels.google.spend)}`);
  if (d.channels.chatgpt?.spend != null) parts.push(`ChatGPT Ads ${dong(d.channels.chatgpt.spend)}`);
  const ds = delta(c.spend, p.spend);
  out.push(`Trong ${d.period.label}, tổng chi tiêu quảng cáo là ${dong(c.spend)}${parts.length > 1 ? ` (${parts.join(", ")})` : ""}${ds != null && Math.abs(ds) >= 0.005 ? `, ${ds > 0 ? "tăng" : "giảm"} ${pctAbs(ds)} so với kỳ trước` : ""}.`);
  if (c.leads != null) {
    const dl = delta(c.leads, p.leads);
    let s = `Quảng cáo mang về ${n0(c.leads)} lead${dl != null && Math.abs(dl) >= 0.005 ? ` (${dl > 0 ? "tăng" : "giảm"} ${pctAbs(dl)} so với kỳ trước)` : ""}`;
    if (c.valid != null) s += `, trong đó ${n0(c.valid)} lead hợp lệ${c.leads > 0 ? ` (${Math.round((c.valid / c.leads) * 100)}%)` : ""}`;
    out.push(`${s}.`);
  }
  if (c.cpl != null) {
    const bits: string[] = [];
    if (d.targets.cpl != null) bits.push(c.cpl <= d.targets.cpl ? `đạt mục tiêu (≤ ${dong(d.targets.cpl)})` : `cao hơn mục tiêu ${dong(d.targets.cpl)}`);
    const dc = delta(c.cpl, p.cpl);
    if (dc != null && Math.abs(dc) >= 0.005) bits.push(`${dc < 0 ? "giảm" : "tăng"} ${pctAbs(dc)} so với kỳ trước`);
    out.push(`Chi phí trung bình mỗi lead (CPL) là ${dong(c.cpl)}${bits.length ? `, ${bits.join("; ")}` : ""}.`);
  }
  if (c.closed != null || c.revenue != null) {
    const bits: string[] = [];
    if (c.closed != null) bits.push(`chốt được ${n0(c.closed)} khách hàng`);
    if (c.revenue != null) bits.push(`doanh thu ghi nhận ${dong(c.revenue)}`);
    if (c.roas != null) bits.push(`tương đương ROAS thực ${c.roas.toFixed(2)} lần chi phí quảng cáo`);
    out.push(`Theo số liệu kinh doanh đã nhập, ${bits.join(", ")}.`);
  }
  return out;
}
