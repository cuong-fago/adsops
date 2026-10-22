/** "So sánh tài khoản" types + pure helpers (shared by server and UI; JSON-safe). Missing = null, never 0. */
export type ComparePlatform = "google" | "facebook" | "tiktok";
export type CompareGroup = { id: number; name: string; members: string[]; hidden_count: number; personal: boolean };
export type ComparePeriod = "this_month" | "last_month" | "last3";
export const PERIOD_LABEL: Record<ComparePeriod, string> = { this_month: "Tháng này", last_month: "Tháng trước", last3: "3 tháng đủ gần nhất" };
export type MetricKey = "spend" | "clicks" | "cpc" | "conversions" | "cpa" | "cr";
export const METRICS: MetricKey[] = ["spend", "clicks", "cpc", "conversions", "cpa", "cr"];
export const METRIC_LABEL: Record<MetricKey, string> = { spend: "Chi tiêu", clicks: "Click", cpc: "CPC", conversions: "Chuyển đổi", cpa: "Chi phí / chuyển đổi", cr: "CR" };
/** Lower is better for costs; higher is better for volume and CR. */
export const LOWER_BETTER = new Set<MetricKey>(["cpc", "cpa"]);
/** Metrics that are judged against the group (volumes depend on budget, so they are shown but not coloured). */
export const JUDGED = new Set<MetricKey>(["cpc", "cpa", "cr"]);
export type Metrics = Record<MetricKey, number | null>;
export type Raw = { clicks: number | null; cost: number | null; conversions: number | null };
export type CompareRow = {
  client_id: string; platform: ComparePlatform; label: string; customer_id_dashed: string | null;
  m: Metrics; low_data: boolean; has_data: boolean; computed_at: string | null; error: string | null;
  /** 3 full months, oldest first: per-month metrics for the trend chart. */
  trend: Array<{ month: string; m: Metrics }>;
};
export type CompareRead = {
  group: { id: number; name: string; personal?: boolean } | null; custom?: boolean; period: ComparePeriod; months: string[]; trend_months: string[];
  rows: CompareRow[]; median: Metrics; weighted: Metrics; thresholds: { conv: number; clicks: number };
  channels: string[]; can_manage: boolean; can_compute: boolean; conv_note: string | null;
};

export function derive(r: Raw): Metrics {
  const { clicks, cost, conversions } = r;
  return {
    spend: cost, clicks, conversions,
    cpc: cost != null && clicks ? cost / clicks : null,
    cpa: cost != null && conversions ? cost / conversions : null,
    cr: conversions != null && clicks ? conversions / clicks : null,
  };
}
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** Group level: median per metric, and the spend-weighted average (= pooled ratios; totals for volumes ÷ n). */
export function groupLevel(rows: Array<{ m: Metrics; has_data: boolean }>): { median: Metrics; weighted: Metrics } {
  const live = rows.filter((r) => r.has_data);
  const med = {} as Metrics;
  for (const k of METRICS) med[k] = median(live.map((r) => r.m[k]).filter((v): v is number => v != null));
  // Spend-weighted mean of each ratio: Σ(spend·x)/Σspend over accounts that have the ratio.
  const w = {} as Metrics;
  for (const k of METRICS) {
    if (k === "spend" || k === "clicks" || k === "conversions") {
      const xs = live.map((r) => r.m[k]).filter((v): v is number => v != null);
      w[k] = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
      continue;
    }
    let num = 0, den = 0;
    for (const r of live) { const x = r.m[k], s = r.m.spend; if (x != null && s != null && s > 0) { num += s * x; den += s; } }
    w[k] = den > 0 ? num / den : null;
  }
  return { median: med, weighted: w };
}
/** Deviation from the median in the "good" direction: >0 better, <0 worse. null when not comparable. */
export function deviation(k: MetricKey, v: number | null, med: number | null): number | null {
  if (v == null || med == null || med === 0) return null;
  const d = (v - med) / Math.abs(med);
  return LOWER_BETTER.has(k) ? -d : d;
}
/** "better" (green), "worse" (red: >10% worse than the median), or neutral. */
export function tone(k: MetricKey, v: number | null, med: number | null, band = 0.1): "better" | "worse" | null {
  if (!JUDGED.has(k)) return null;
  const d = deviation(k, v, med);
  if (d == null) return null;
  if (d < -band) return "worse";
  if (d > 0) return "better";
  return null;
}

/** Normalise a name for grouping (fold Vietnamese accents, lowercase, drop punctuation). */
export const foldName = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const STOP = new Set(["google", "ads", "gg", "fb", "facebook", "tiktok", "tk", "acc", "account", "tai", "khoan", "cty", "cong", "ty", "the", "and", "va", "new", "moi", "search", "pmax", "display", "video", "mcc", "vn", "com", "www"]);
export type GroupSuggestion = { name: string; key: string; members: string[] };
/**
 * "Gợi ý nhóm": accounts sharing a client / company key — a long number (tax code), a first word of ≥5 letters,
 * or the first two words. Only a suggestion; Admin confirms.
 */
export function suggestGroups(accounts: Array<{ client_id: string; names: string[] }>, existing: Array<{ members: string[] }> = []): GroupSuggestion[] {
  const by = new Map<string, { label: string; ids: Set<string> }>();
  const put = (key: string, label: string, id: string) => { const g = by.get(key) || { label, ids: new Set<string>() }; g.ids.add(id); by.set(key, g); };
  for (const a of accounts) {
    for (const raw of a.names) {
      if (!raw) continue;
      const f = foldName(raw);
      const words = f.split(" ").filter((w) => w && !STOP.has(w));
      const orig = raw.replace(/[|·\-–—_()[\]]+/g, " ").split(/\s+/).filter(Boolean);
      const pretty = (n: number) => orig.filter((w) => !STOP.has(foldName(w))).slice(0, n).join(" ");
      for (const num of f.match(/\b\d{9,14}\b/g) || []) put(`n:${num}`, `${pretty(2)} ${num}`.trim(), a.client_id);
      const alpha = words.filter((w) => /[a-z]/.test(w) && !/^\d+$/.test(w));
      if (alpha.length >= 2) put(`w2:${alpha[0]} ${alpha[1]}`, pretty(2), a.client_id);
      if (alpha[0] && alpha[0].length >= 5) put(`w1:${alpha[0]}`, pretty(1), a.client_id);
    }
  }
  const have = new Set(existing.map((g) => [...g.members].sort().join(",")));
  const seen = new Set<string>();
  const out: GroupSuggestion[] = [];
  // Most specific first: tax code, then two words, then one word.
  const rank = (k: string) => (k.startsWith("n:") ? 0 : k.startsWith("w2:") ? 1 : 2);
  for (const [key, g] of [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].ids.size - a[1].ids.size)) {
    if (g.ids.size < 2) continue;
    const sig = [...g.ids].sort().join(",");
    if (seen.has(sig) || have.has(sig)) continue;
    seen.add(sig);
    out.push({ name: g.label || key.slice(3), key, members: [...g.ids] });
  }
  return out.slice(0, 50);
}
