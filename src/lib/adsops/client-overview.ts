/**
 * Pure computations for the customer overview screen. Every number shown to a
 * customer comes from the analytics warehouse rows passed in — nothing is
 * estimated, and missing days are never filled with zero.
 *
 * No previous-period comparison lives here on purpose (customers do not get
 * compare data; the server also strips it).
 */
import type { AnalyticsSnap, DailyRow } from "./analytics";
import { addDays } from "./format";
import { statusText, t, type Lang } from "./client-i18n";

export type Totals = {
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conv_call: number;
  conv_zalo: number;
  conv_form: number;
  conv_facebook_chat: number;
  conv_other: number;
  ctr: number | null;
  cpc: number | null;
  cost_per_conversion: number | null;
};

export type DayPoint = {
  date: string;
  /** false = no warehouse row for this day (chart gap, never 0). */
  has: boolean;
  cost: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  ctr: number | null;
  cpc: number | null;
  cost_per_conversion: number | null;
  conv_call: number | null;
  conv_zalo: number | null;
  conv_form: number | null;
  conv_facebook_chat: number | null;
  conv_other: number | null;
};

export type CampaignLine = {
  id: string;
  name: string;
  status: string;
  type: string;
  cost: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cost_per_conversion: number | null;
  share: number;
};

export type Overview = {
  start: string;
  end: string;
  dayCount: number;
  daysWithData: number;
  missingDays: number;
  totals: Totals;
  series: DayPoint[];
  campaigns: CampaignLine[];
  hasData: boolean;
};

export type PresetId = "7" | "14" | "30" | "this_month" | "last_month" | "all" | "custom";

const SUM = [
  "cost",
  "impressions",
  "clicks",
  "conversions",
  "conv_call",
  "conv_zalo",
  "conv_form",
  "conv_facebook_chat",
  "conv_other",
] as const;

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

function emptyTotals(): Totals {
  return {
    cost: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    conv_call: 0,
    conv_zalo: 0,
    conv_form: 0,
    conv_facebook_chat: 0,
    conv_other: 0,
    ctr: null,
    cpc: null,
    cost_per_conversion: null,
  };
}

function finish(tot: Totals): Totals {
  tot.ctr = ratio(tot.clicks, tot.impressions);
  tot.cpc = ratio(tot.cost, tot.clicks);
  tot.cost_per_conversion = ratio(tot.cost, tot.conversions);
  return tot;
}

function addRow(tot: Totals, row: DailyRow) {
  for (const k of SUM) tot[k] += n(row[k]);
}

export function lastDataDay(snap: AnalyticsSnap): string {
  return snap.warehouse_end || snap.data_through || "";
}

export function daysBetween(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00`).getTime();
  const b = new Date(`${end}T00:00:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/** Presets are anchored to the last day that has data, not "today". */
export function presetRange(snap: AnalyticsSnap, id: PresetId): { start: string; end: string } | null {
  const end = lastDataDay(snap);
  if (!end) return null;
  if (id === "7" || id === "14" || id === "30") return { start: addDays(end, -(Number(id) - 1)), end };
  if (id === "this_month") return { start: `${end.slice(0, 7)}-01`, end };
  if (id === "last_month") {
    const y = Number(end.slice(0, 4));
    const m = Number(end.slice(5, 7)) - 1; // 0-based current month
    const first = new Date(y, m - 1, 1);
    const last = new Date(y, m, 0);
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { start: iso(first), end: iso(last) };
  }
  if (id === "all") return { start: snap.warehouse_start || addDays(end, -29), end };
  return null;
}

export function buildOverview(snap: AnalyticsSnap, start: string, end: string): Overview {
  const accountRows = (snap.daily?.account || []).filter((r) => r.date >= start && r.date <= end);
  const byDate = new Map<string, DailyRow>();
  for (const r of accountRows) byDate.set(r.date, r);

  const totals = emptyTotals();
  for (const r of accountRows) addRow(totals, r);
  finish(totals);

  const series: DayPoint[] = [];
  const dayCount = daysBetween(start, end);
  let cur = start;
  for (let i = 0; i < dayCount && i < 800; i += 1) {
    const r = byDate.get(cur);
    if (r) {
      const cost = n(r.cost);
      const clicks = n(r.clicks);
      const impressions = n(r.impressions);
      const conversions = n(r.conversions);
      series.push({
        date: cur,
        has: true,
        cost,
        impressions,
        clicks,
        conversions,
        ctr: ratio(clicks, impressions),
        cpc: ratio(cost, clicks),
        cost_per_conversion: ratio(cost, conversions),
        conv_call: n(r.conv_call),
        conv_zalo: n(r.conv_zalo),
        conv_form: n(r.conv_form),
        conv_facebook_chat: n(r.conv_facebook_chat),
        conv_other: n(r.conv_other),
      });
    } else {
      series.push({
        date: cur,
        has: false,
        cost: null,
        impressions: null,
        clicks: null,
        conversions: null,
        ctr: null,
        cpc: null,
        cost_per_conversion: null,
        conv_call: null,
        conv_zalo: null,
        conv_form: null,
        conv_facebook_chat: null,
        conv_other: null,
      });
    }
    cur = addDays(cur, 1);
  }

  // Campaigns: range metrics + status from the campaign list.
  const meta = new Map((snap.campaigns || []).map((c) => [String(c.id), c]));
  const agg = new Map<string, Totals & { name: string; status: string; type: string }>();
  for (const r of snap.daily?.campaign || []) {
    if (r.date < start || r.date > end) continue;
    const id = String(r.campaign_id || "");
    if (!id) continue;
    let a = agg.get(id);
    if (!a) {
      const m = meta.get(id);
      a = {
        ...emptyTotals(),
        name: m?.name || String(r.campaign_name || id),
        status: m?.status || String(r.status || ""),
        type: m?.type || String(r.campaign_type || ""),
      };
      agg.set(id, a);
    }
    addRow(a, r);
  }
  const campaigns: CampaignLine[] = [];
  for (const [id, a] of agg) {
    if (a.cost === 0 && a.clicks === 0 && a.impressions === 0 && a.conversions === 0) continue;
    campaigns.push({
      id,
      name: a.name,
      status: a.status,
      type: a.type,
      cost: a.cost,
      clicks: a.clicks,
      impressions: a.impressions,
      conversions: a.conversions,
      cost_per_conversion: ratio(a.cost, a.conversions),
      share: totals.cost > 0 ? a.cost / totals.cost : 0,
    });
  }
  campaigns.sort((x, y) => y.cost - x.cost);
  // Running campaigns with no activity in the range still appear (status list).
  for (const c of snap.campaigns || []) {
    const id = String(c.id);
    if (agg.has(id) && campaigns.some((x) => x.id === id)) continue;
    if (String(c.status).toUpperCase() !== "ENABLED") continue;
    campaigns.push({
      id,
      name: c.name,
      status: c.status,
      type: c.type,
      cost: 0,
      clicks: 0,
      impressions: 0,
      conversions: 0,
      cost_per_conversion: null,
      share: 0,
    });
  }

  const daysWithData = accountRows.length;
  return {
    start,
    end,
    dayCount,
    daysWithData,
    missingDays: Math.max(0, dayCount - daysWithData),
    totals,
    series,
    campaigns,
    hasData: daysWithData > 0,
  };
}

// ── formatting ────────────────────────────────────────────────────────────────

export function locale(lang: Lang) {
  return lang === "en" ? "en-US" : "vi-VN";
}

export function fmtMoney(lang: Lang, v: number | null | undefined, currency = "VND"): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v).toLocaleString(locale(lang))} ${currency === "VND" ? "₫" : currency}`;
}

/** Compact money for tight spaces: 1,2 tr / 1.2M. */
export function fmtMoneyShort(lang: Lang, v: number | null | undefined, currency = "VND"): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sym = currency === "VND" ? "₫" : ` ${currency}`;
  const opt = { maximumFractionDigits: 1 };
  if (abs >= 1e9) return `${(v / 1e9).toLocaleString(locale(lang), opt)}${lang === "en" ? "B" : " tỷ"}${sym}`;
  if (abs >= 1e6) return `${(v / 1e6).toLocaleString(locale(lang), opt)}${lang === "en" ? "M" : " tr"}${sym}`;
  if (abs >= 1e3) return `${(v / 1e3).toLocaleString(locale(lang), { maximumFractionDigits: 0 })}${lang === "en" ? "K" : "k"}${sym}`;
  return `${Math.round(v).toLocaleString(locale(lang))}${sym}`;
}

export function fmtNum(lang: Lang, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const frac = Math.abs(v - Math.round(v)) > 1e-9;
  return v.toLocaleString(locale(lang), { maximumFractionDigits: frac ? 1 : 0, minimumFractionDigits: 0 });
}

export function fmtPct(lang: Lang, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toLocaleString(locale(lang), { maximumFractionDigits: 2 })}%`;
}

export function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

export function fmtRange(start: string, end: string): string {
  return start === end ? fmtDay(start) : `${fmtDay(start)} – ${fmtDay(end)}`;
}

// ── commentary ───────────────────────────────────────────────────────────────

/**
 * Deterministic, rule-based sentences built only from `ov` numbers.
 * No comparisons to other periods; conversions are always described as
 * "recorded by Google Ads", never as leads.
 */
export function commentary(lang: Lang, ov: Overview, currency: string): string[] {
  const out: string[] = [];
  if (!ov.hasData) return out;
  const tt = ov.totals;
  const M = (v: number | null) => fmtMoney(lang, v, currency);
  const N = (v: number | null) => fmtNum(lang, v);
  const P = (v: number | null) => fmtPct(lang, v);
  const range = fmtRange(ov.start, ov.end);
  const vi = lang === "vi";

  out.push(
    vi
      ? `Trong ${range} (${ov.daysWithData} ngày có số liệu), tài khoản chi ${M(tt.cost)}, nhận ${N(tt.impressions)} lượt hiển thị và ${N(tt.clicks)} lượt click (CTR ${P(tt.ctr)}, CPC trung bình ${M(tt.cpc)}).`
      : `In ${range} (${ov.daysWithData} days with data), the account spent ${M(tt.cost)}, got ${N(tt.impressions)} impressions and ${N(tt.clicks)} clicks (CTR ${P(tt.ctr)}, average CPC ${M(tt.cpc)}).`,
  );

  if (tt.conversions > 0) {
    const parts: string[] = [];
    const push = (v: number, viL: string, enL: string) => {
      if (v > 0) parts.push(`${N(v)} ${vi ? viL : enL}`);
    };
    push(tt.conv_call, "Gọi", "calls");
    push(tt.conv_zalo, "Zalo", "Zalo");
    push(tt.conv_form, "Form", "forms");
    push(tt.conv_facebook_chat, "chat Facebook", "Facebook chats");
    push(tt.conv_other, "khác", "other");
    out.push(
      vi
        ? `Google Ads ghi nhận ${N(tt.conversions)} chuyển đổi${parts.length ? ` (${parts.join(", ")})` : ""}, chi phí trung bình ${M(tt.cost_per_conversion)} cho mỗi chuyển đổi Google Ads ghi nhận.`
        : `Google Ads recorded ${N(tt.conversions)} conversions${parts.length ? ` (${parts.join(", ")})` : ""}, at an average of ${M(tt.cost_per_conversion)} per Google Ads-recorded conversion.`,
    );
  } else if (tt.cost > 0) {
    out.push(
      vi
        ? "Google Ads chưa ghi nhận chuyển đổi nào trong khoảng này."
        : "Google Ads recorded no conversions in this range.",
    );
  }

  const spent = ov.campaigns.filter((c) => c.cost > 0);
  const top = spent[0];
  if (top && spent.length > 1) {
    out.push(
      vi
        ? `Chiến dịch chi nhiều nhất: "${top.name}" — ${M(top.cost)} (${P(top.share)} tổng chi tiêu), ${N(top.conversions)} chuyển đổi Google Ads ghi nhận.`
        : `Top-spending campaign: "${top.name}" — ${M(top.cost)} (${P(top.share)} of spend), ${N(top.conversions)} Google Ads-recorded conversions.`,
    );
  }
  const bestConv = [...spent].sort((a, b) => b.conversions - a.conversions || a.cost - b.cost)[0];
  if (bestConv && bestConv.conversions > 0 && spent.length > 1 && bestConv.id !== top?.id) {
    out.push(
      vi
        ? `Nhiều chuyển đổi nhất: "${bestConv.name}" — ${N(bestConv.conversions)} chuyển đổi, ${M(bestConv.cost_per_conversion)}/chuyển đổi.`
        : `Most conversions: "${bestConv.name}" — ${N(bestConv.conversions)} conversions at ${M(bestConv.cost_per_conversion)} each.`,
    );
  }
  const zero = spent.filter((c) => c.conversions === 0 && c.share >= 0.05);
  if (zero.length && tt.conversions > 0) {
    const names = zero.slice(0, 2).map((c) => `"${c.name}" (${M(c.cost)})`);
    const more = zero.length > 2 ? (vi ? ` và ${zero.length - 2} chiến dịch khác` : ` and ${zero.length - 2} more`) : "";
    out.push(
      vi
        ? `Có chi tiêu nhưng chưa ghi nhận chuyển đổi: ${names.join(", ")}${more}.`
        : `Spend without recorded conversions: ${names.join(", ")}${more}.`,
    );
  }

  const days = ov.series.filter((d) => d.has && d.cost != null);
  if (days.length > 1) {
    const peak = days.reduce((a, b) => ((b.cost || 0) > (a.cost || 0) ? b : a));
    const convPeak = days.reduce((a, b) => ((b.conversions || 0) > (a.conversions || 0) ? b : a));
    let s = vi
      ? `Ngày chi cao nhất: ${fmtDay(peak.date)} (${M(peak.cost)}).`
      : `Highest-spend day: ${fmtDay(peak.date)} (${M(peak.cost)}).`;
    if ((convPeak.conversions || 0) > 0) {
      s += vi
        ? ` Ngày nhiều chuyển đổi nhất: ${fmtDay(convPeak.date)} (${N(convPeak.conversions)}).`
        : ` Most conversions on ${fmtDay(convPeak.date)} (${N(convPeak.conversions)}).`;
    }
    out.push(s);
  }

  const running = ov.campaigns.filter((c) => String(c.status).toUpperCase() === "ENABLED").length;
  const idle = ov.campaigns.filter((c) => String(c.status).toUpperCase() === "ENABLED" && c.cost === 0).length;
  if (running) {
    out.push(
      vi
        ? `${running} chiến dịch đang ở trạng thái "${statusText(lang, "ENABLED")}"${idle ? `, trong đó ${idle} chiến dịch không chi tiêu trong khoảng này` : ""}.`
        : `${running} campaign(s) are "${statusText(lang, "ENABLED")}"${idle ? `; ${idle} of them had no spend in this range` : ""}.`,
    );
  }

  if (ov.missingDays > 0) out.push(t(lang, "missing_days", { n: ov.missingDays, range }));
  return out;
}
