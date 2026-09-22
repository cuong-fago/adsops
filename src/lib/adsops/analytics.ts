import { addDays, isoDate } from "./format";

export type MetricMap = Record<string, number>;

export type DailyRow = {
  date: string;
  campaign_id?: string;
  campaign_name?: string;
  campaign_type?: string;
  ad_group_id?: string;
  ad_group_name?: string;
  keyword_id?: string;
  keyword_text?: string;
  query?: string;
  match_type?: string;
  status?: string;
  impressions?: number;
  clicks?: number;
  invalid_clicks?: number;
  cost?: number;
  conversions?: number;
  conv_call?: number;
  conv_zalo?: number;
  conv_facebook_chat?: number;
  conv_form?: number;
  conv_other?: number;
};

export type BudgetTicket = {
  id: string;
  scope: string;
  label: string;
  campaigns: { id: string; name: string; daily_budget: number }[];
  daily_budget: number;
  cost_today: number;
  remaining: number;
  hours_elapsed: number;
  hours_remaining: number | null;
  threshold_hours: number;
  firing: boolean;
  blocks_propose: boolean;
  separate_from_guard: boolean;
  message: string;
};

export type BudgetEmail = {
  channel: string;
  to: string[];
  subject: string;
  body: string;
  status: string;
  not_merged_with_guard: boolean;
  sent: boolean;
  note: string;
};

export type BudgetPace = {
  module: string;
  client_id: string;
  separate_from_guard: boolean;
  blocks_propose: boolean;
  status: "firing" | "ok" | "missing";
  missing_label: string;
  firing: boolean;
  today: string;
  timezone: string;
  currency: string;
  hours_elapsed: number;
  tickets: BudgetTicket[];
  ok: BudgetTicket[];
  email: BudgetEmail;
  formula: string;
};

export type ConvGroup = {
  id: string;
  label: string;
  metric: string;
  actions: string[];
};

export type AnalyticsSnap = {
  client_id: string;
  display_name: string;
  customer_id: string;
  timezone: string;
  currency: string;
  adapter: string;
  data_through: string;
  warehouse_start: string | null;
  warehouse_end: string | null;
  pmax_note: string;
  metrics: { id: string; label: string }[];
  conversion_groups: {
    groups: ConvGroup[];
    skipped: { action: string; reason: string }[];
  };
  campaigns: {
    id: string;
    name: string;
    type: string;
    status: string;
    pmax: boolean;
  }[];
  ad_groups?: {
    id: string;
    name: string;
    campaign_id: string;
    status: string;
  }[];
  daily: {
    account: DailyRow[];
    campaign: DailyRow[];
    ad_group: DailyRow[];
    keyword: DailyRow[];
    search_term: DailyRow[];
  };
  week_choices: number[];
  month_choices: number[];
  rules: Record<string, boolean | string | number>;
  budget_pace: BudgetPace;
  analytics_lookback_days?: number;
  lookback_days?: number;
  day_count?: number;
};

const SUM_KEYS = [
  "impressions",
  "clicks",
  "invalid_clicks",
  "cost",
  "conversions",
  "conv_call",
  "conv_zalo",
  "conv_facebook_chat",
  "conv_form",
  "conv_other",
] as const;

export function derivedMetrics(raw: MetricMap): MetricMap {
  const impressions = raw.impressions || 0;
  const clicks = raw.clicks || 0;
  const invalid = raw.invalid_clicks || 0;
  const cost = raw.cost || 0;
  const conversions = raw.conversions || 0;
  return {
    ...raw,
    invalid_click_rate: clicks ? invalid / clicks : 0,
    cpc: clicks ? cost / clicks : 0,
    cost_per_conversion: conversions ? cost / conversions : 0,
    ctr: impressions ? clicks / impressions : 0,
    cr: clicks ? conversions / clicks : 0,
  };
}

export function windowComplete(dates: string[], start: string, end: string) {
  return windowCoverage(dates, start, end).complete;
}

export function windowCoverage(dates: string[], start: string, end: string) {
  const have = new Set(dates);
  let missing = 0;
  let present = 0;
  let cur = start;
  while (cur <= end) {
    if (have.has(cur)) present += 1;
    else missing += 1;
    cur = addDays(cur, 1);
  }
  return {
    missing,
    present,
    complete: missing === 0 && present > 0,
  };
}

export function warehouseDates(snap: AnalyticsSnap) {
  return snap.daily.account.map((r) => r.date);
}

function inRange(row: DailyRow, start: string, end: string) {
  return row.date >= start && row.date <= end;
}

function sumChunk(rows: DailyRow[]): MetricMap {
  const acc: MetricMap = {};
  for (const key of SUM_KEYS) acc[key] = 0;
  for (const row of rows) {
    for (const key of SUM_KEYS) {
      acc[key] += Number(row[key] || 0);
    }
  }
  return derivedMetrics(acc);
}

function hasNumbers(m: MetricMap) {
  return SUM_KEYS.some((k) => (m[k] || 0) !== 0);
}

export type LayerRow = {
  id: string;
  name: string;
  status?: string;
  type?: string;
  pmax?: boolean;
  match_type?: string;
  match_type_label?: string;
  campaign_id?: string;
  campaign_name?: string;
  ad_group_id?: string;
  metrics: MetricMap;
};

export type LayerBlock = {
  complete: boolean;
  missing_label?: string;
  rows: LayerRow[];
  pmax_note: string | null;
};

const MATCH: Record<string, string> = {
  EXACT: "Chính xác",
  PHRASE: "Cụm từ",
  BROAD: "Rộng",
};

export function layerRows(
  snap: AnalyticsSnap,
  opts: {
    layer: string;
    start: string;
    end: string;
    campaignId?: string | null;
    adGroupId?: string | null;
    onlyWithConv?: boolean;
  },
): LayerBlock {
  const dates = warehouseDates(snap);
  const cov = windowCoverage(dates, opts.start, opts.end);
  if (cov.present === 0) {
    return { complete: false, missing_label: "Thiếu dữ liệu", rows: [], pmax_note: null };
  }
  const camp = snap.campaigns.find((c) => c.id === opts.campaignId);
  if (
    camp?.pmax &&
    (opts.layer === "ad_group" || opts.layer === "keyword" || opts.layer === "search_term")
  ) {
    return {
      complete: cov.complete,
      missing_label: cov.complete ? undefined : "Thiếu dữ liệu",
      rows: [],
      pmax_note: snap.pmax_note,
    };
  }

  const block = computeLayer(snap, opts);
  return {
    ...block,
    complete: cov.complete,
    missing_label: cov.complete ? undefined : "Thiếu dữ liệu",
  };
}

function computeLayer(
  snap: AnalyticsSnap,
  opts: {
    layer: string;
    start: string;
    end: string;
    campaignId?: string | null;
    adGroupId?: string | null;
    onlyWithConv?: boolean;
  },
): LayerBlock {
  if (opts.layer === "account") {
    const part = snap.daily.account.filter((r) => inRange(r, opts.start, opts.end));
    return {
      complete: true,
      pmax_note: null,
      rows: [
        {
          id: snap.client_id,
          name: snap.display_name,
          pmax: false,
          metrics: sumChunk(part),
        },
      ],
    };
  }

  if (opts.layer === "campaign") {
    const part = snap.daily.campaign.filter((r) => inRange(r, opts.start, opts.end));
    const by = new Map<string, DailyRow[]>();
    for (const row of part) {
      const id = String(row.campaign_id || "");
      const list = by.get(id) || [];
      list.push(row);
      by.set(id, list);
    }
    const meta = Object.fromEntries(snap.campaigns.map((c) => [c.id, c]));
    let rows: LayerRow[] = [];
    for (const [id, chunk] of by) {
      const m = meta[id];
      const metrics = sumChunk(chunk);
      if (!hasNumbers(metrics)) continue;
      rows.push({
        id,
        name: m?.name || String(chunk[0]?.campaign_name || id),
        status: m?.status || String(chunk[0]?.status || ""),
        type: m?.type || "",
        pmax: Boolean(m?.pmax),
        metrics,
      });
    }
    if (opts.onlyWithConv) rows = rows.filter((r) => (r.metrics.conversions || 0) > 0);
    rows.sort((a, b) => (b.metrics.cost || 0) - (a.metrics.cost || 0));
    return { complete: true, rows, pmax_note: null };
  }

  if (opts.layer === "ad_group") {
    let part = snap.daily.ad_group.filter((r) => inRange(r, opts.start, opts.end));
    if (opts.campaignId) part = part.filter((r) => String(r.campaign_id) === opts.campaignId);
    const by = new Map<string, DailyRow[]>();
    for (const row of part) {
      const id = String(row.ad_group_id || "");
      const list = by.get(id) || [];
      list.push(row);
      by.set(id, list);
    }
    let rows: LayerRow[] = [];
    for (const [id, chunk] of by) {
      const metrics = sumChunk(chunk);
      if (!hasNumbers(metrics)) continue;
      rows.push({
        id,
        name: String(chunk[0]?.ad_group_name || id),
        status: String(chunk[0]?.status || ""),
        campaign_id: String(chunk[0]?.campaign_id || ""),
        pmax: false,
        metrics,
      });
    }
    if (opts.onlyWithConv) rows = rows.filter((r) => (r.metrics.conversions || 0) > 0);
    rows.sort((a, b) => (b.metrics.cost || 0) - (a.metrics.cost || 0));
    return { complete: true, rows, pmax_note: null };
  }

  if (opts.layer === "keyword") {
    let part = snap.daily.keyword.filter((r) => inRange(r, opts.start, opts.end));
    if (opts.campaignId) part = part.filter((r) => String(r.campaign_id) === opts.campaignId);
    if (opts.adGroupId) part = part.filter((r) => String(r.ad_group_id) === opts.adGroupId);
    const by = new Map<string, DailyRow[]>();
    for (const row of part) {
      const id = String(row.keyword_id || "");
      const list = by.get(id) || [];
      list.push(row);
      by.set(id, list);
    }
    let rows: LayerRow[] = [];
    for (const [id, chunk] of by) {
      const metrics = sumChunk(chunk);
      if (!hasNumbers(metrics)) continue;
      const code = String(chunk[0]?.match_type || "");
      rows.push({
        id,
        name: String(chunk[0]?.keyword_text || id),
        match_type: code,
        match_type_label: MATCH[code] || code,
        status: String(chunk[0]?.status || ""),
        ad_group_id: String(chunk[0]?.ad_group_id || ""),
        campaign_id: String(chunk[0]?.campaign_id || ""),
        pmax: false,
        metrics,
      });
    }
    if (opts.onlyWithConv) rows = rows.filter((r) => (r.metrics.conversions || 0) > 0);
    rows.sort((a, b) => (b.metrics.cost || 0) - (a.metrics.cost || 0));
    return { complete: true, rows, pmax_note: null };
  }

  if (opts.layer === "search_term") {
    let part = snap.daily.search_term.filter((r) => inRange(r, opts.start, opts.end));
    if (opts.campaignId) part = part.filter((r) => String(r.campaign_id) === opts.campaignId);
    if (opts.adGroupId) part = part.filter((r) => String(r.ad_group_id) === opts.adGroupId);
    const by = new Map<string, DailyRow[]>();
    for (const row of part) {
      const key = `${row.query}|${row.campaign_id}|${row.ad_group_id}`;
      const list = by.get(key) || [];
      list.push(row);
      by.set(key, list);
    }
    let rows: LayerRow[] = [];
    for (const chunk of by.values()) {
      const metrics = sumChunk(chunk);
      if (!hasNumbers(metrics)) continue;
      const rec = chunk[0];
      const code = String(rec?.match_type || "");
      const q = String(rec?.query || "");
      rows.push({
        id: `${rec?.campaign_id}:${rec?.ad_group_id}:${q}`,
        name: q,
        match_type: code,
        match_type_label: MATCH[code] || code,
        campaign_id: String(rec?.campaign_id || ""),
        campaign_name: String(rec?.campaign_name || ""),
        ad_group_id: String(rec?.ad_group_id || ""),
        pmax: false,
        metrics,
      });
    }
    if (opts.onlyWithConv) rows = rows.filter((r) => (r.metrics.conversions || 0) > 0);
    rows.sort((a, b) => (b.metrics.cost || 0) - (a.metrics.cost || 0));
    return { complete: true, rows, pmax_note: null };
  }

  return { complete: true, rows: [], pmax_note: null };
}

export function previousWeeks(before: string, n: number) {
  const d = new Date(`${before}T00:00:00`);
  const weekday = d.getDay(); // 0 Sun
  const mondayOffset = weekday === 0 ? 6 : weekday - 1;
  const monday = new Date(d);
  monday.setDate(d.getDate() - mondayOffset);
  const weekEnd = new Date(monday);
  weekEnd.setDate(monday.getDate() - 1);
  const out: { start: string; end: string }[] = [];
  let end = weekEnd;
  for (let i = 0; i < n; i += 1) {
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    out.push({ start: isoDate(start), end: isoDate(end) });
    const next = new Date(start);
    next.setDate(start.getDate() - 1);
    end = next;
  }
  return out.reverse();
}

export function previousMonths(of: string, n: number) {
  const d = new Date(`${of}T00:00:00`);
  const out: { start: string; end: string; label: string }[] = [];
  let y = d.getFullYear();
  let m = d.getMonth();
  for (let i = 0; i < n; i += 1) {
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0);
    out.push({
      start: isoDate(start),
      end: isoDate(end),
      label: `T${m + 1}/${y}`,
    });
  }
  return out.reverse();
}

export function defaultRange(snap: AnalyticsSnap) {
  const end = snap.warehouse_end || snap.data_through;
  const firstSpend = (snap.daily.account || []).find((row) => (row.cost || 0) > 0)?.date;
  if (firstSpend) {
    return { start: `${firstSpend.slice(0, 7)}-01`, end };
  }
  if (snap.warehouse_start) return { start: snap.warehouse_start, end };
  return { start: addDays(end, -29), end };
}

export function previousEqualRange(start: string, end: string) {
  const days =
    Math.round(
      (new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 86400000,
    ) + 1;
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(days - 1));
  return { start: prevStart, end: prevEnd };
}

export function monthsOverlapping(start: string, end: string) {
  const out: {
    start: string;
    end: string;
    calendar_start: string;
    calendar_end: string;
    label: string;
  }[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7)) - 1;
  const endY = Number(end.slice(0, 4));
  const endM = Number(end.slice(5, 7)) - 1;
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(endY) || !Number.isFinite(endM)) {
    return out;
  }
  while (y < endY || (y === endY && m <= endM)) {
    const monthStart = isoDate(new Date(y, m, 1));
    const monthEnd = isoDate(new Date(y, m + 1, 0));
    const clipStart = start > monthStart ? start : monthStart;
    const clipEnd = end < monthEnd ? end : monthEnd;
    if (clipStart <= clipEnd) {
      out.push({
        start: clipStart,
        end: clipEnd,
        calendar_start: monthStart,
        calendar_end: monthEnd,
        label: `T${m + 1}/${y}`,
      });
    }
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

export type MixPart = { id: string; label: string; value: number };

export function mixParts(
  metrics: MetricMap,
  groups: { id: string; label: string; metric: string }[],
): MixPart[] {
  return groups.map((g) => ({
    id: g.id,
    label: g.label,
    value: Number(metrics[g.metric] || 0),
  }));
}
