import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { alertBadge, type MetaFocus } from "@/components/adsops/meta-alerts-card";
import { PacingCard } from "@/components/adsops/budget-pacing";
import type { MetaAlert } from "@/lib/adsops/meta-alerts.types";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp, BarChart3, ChevronRight, Columns3, ExternalLink } from "lucide-react";
import { STATUS_ORDER, adsetSummary, budgetOf, campaignMeta, creativeOf, statusVi } from "@/lib/adsops/meta-structure";
import { readMetaAlertsFn, readMetaAnalyticsFn, type MetaAnalytics, type MetaMetrics, type MetaRow } from "@/lib/adsops/meta-ads.functions";
import { fmtDay, fmtMoney, fmtMoneyShort, fmtNum, fmtPct, fmtRange } from "@/lib/adsops/client-overview";
import type { Lang } from "@/lib/adsops/client-i18n";
import { cn } from "@/lib/cn";
import { Badge, Card, EmptyState, ErrorState, TableSkeleton } from "@/components/adsops/ui";
import { chartColors, chartTheme } from "@/components/adsops/chart-theme";

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}

const PRESETS = [7, 14, 30, 90] as const;
type KpiKey =
  | "spend" | "impressions" | "clicks" | "ctr" | "cpc" | "leads" | "messages" | "cpl" | "follows" | "cost_per_follow" | "page_engagement"
  | "reach" | "frequency" | "cpm" | "link_clicks" | "link_ctr" | "cost_per_link_click" | "lpv" | "lpv_rate"
  | "video_3s" | "thruplay" | "hook_rate" | "hold_rate" | "ret25" | "ret50" | "ret75" | "ret100"
  | "cost_per_message" | "msg_first_reply" | "msg_replied" | "msg_depth2" | "msg_depth3" | "msg_depth5" | "msg_connections" | "deep_rate"
  | "purchases" | "purchase_value" | "roas" | "cpa_purchase";
/** Lower is better for cost metrics (delta colour flips). */
const LOWER_BETTER: Partial<Record<KpiKey, true>> = { cpc: true, cpl: true, cost_per_follow: true, cpm: true, cost_per_link_click: true, cost_per_message: true, cpa_purchase: true };
/** No good/bad colour on the delta (frequency: watch the level, not the direction). */
const NEUTRAL: Partial<Record<KpiKey, true>> = { frequency: true };
const MONEY = new Set<KpiKey>(["spend", "cpc", "cpl", "cost_per_follow", "cpm", "cost_per_link_click", "cost_per_message", "purchase_value", "cpa_purchase"]);
const PCT = new Set<KpiKey>(["ctr", "link_ctr", "lpv_rate", "hook_rate", "hold_rate", "ret25", "ret50", "ret75", "ret100", "deep_rate"]);
/** Frequency ≥ these over a ~7-day window: amber / red. */
const FREQ_WARN = 3;
const FREQ_BAD = 4;
/** Vietnamese tooltips for column / card headers. */
const HINT: Partial<Record<KpiKey, string>> = {
  reach: "Số người khác nhau đã thấy quảng cáo trong khoảng ngày (Meta tính cho cả khoảng, không cộng theo ngày).",
  frequency: "Số lần trung bình mỗi người thấy quảng cáo = Hiển thị ÷ Tiếp cận. Trên 3 (vàng) / 4 (đỏ) trong ~7 ngày: dễ nhàm quảng cáo.",
  cpm: "Chi phí cho 1.000 lượt hiển thị.",
  link_clicks: "Lượt click vào liên kết trong quảng cáo (inline link clicks), không gồm click like / bình luận / xem ảnh.",
  link_ctr: "Click liên kết ÷ Hiển thị.",
  cost_per_link_click: "Chi tiêu ÷ Click liên kết.",
  lpv: "Lượt xem trang đích: người click liên kết và trang tải xong (cần Pixel).",
  lpv_rate: "Lượt xem trang đích ÷ Click liên kết: bao nhiêu click thực sự mở được trang.",
  video_3s: "Lượt xem video ít nhất 3 giây (hoặc gần hết nếu video ngắn hơn).",
  thruplay: "Lượt xem video tới 15 giây (hoặc hết video nếu ngắn hơn).",
  hook_rate: "Tỷ lệ giữ chân 3 giây đầu = Lượt xem 3s ÷ Hiển thị. Cao = mở đầu video hút.",
  hold_rate: "ThruPlay ÷ Lượt xem 3s. Cao = người xem ở lại sau đoạn mở đầu.",
  ret25: "Lượt xem tới 25% video ÷ Lượt xem 3s.",
  ret50: "Lượt xem tới 50% video ÷ Lượt xem 3s.",
  ret75: "Lượt xem tới 75% video ÷ Lượt xem 3s.",
  ret100: "Lượt xem hết video ÷ Lượt xem 3s.",
  ctr: "Tất cả click ÷ Hiển thị.",
  messages: "Cuộc trò chuyện mới bắt đầu qua Messenger / Instagram / WhatsApp (messaging_conversation_started_7d).",
  cost_per_message: "Chi tiêu ÷ Tin nhắn mới.",
  msg_first_reply: "Số cuộc trò chuyện mà khách nhận được phản hồi đầu tiên (messaging_first_reply, Meta tính).",
  msg_replied: "Cuộc trò chuyện có khách trả lời trong 7 ngày (messaging_conversation_replied_7d).",
  msg_depth2: "Khách nhắn tiếp ≥2 tin trong cuộc trò chuyện.",
  msg_depth3: "Khách nhắn tiếp ≥3 tin trong cuộc trò chuyện.",
  msg_depth5: "Khách nhắn tiếp ≥5 tin trong cuộc trò chuyện.",
  msg_connections: "Tổng số kết nối nhắn tin (total_messaging_connection).",
  deep_rate: "Khách nhắn tiếp ≥2 tin ÷ Tin nhắn mới. Chỉ là chỉ báo thay thế: Ads API không có tỷ lệ phản hồi thật của doanh nghiệp.",
  purchases: "Lượt mua hàng Meta ghi nhận (omni_purchase; nếu không có thì purchase / Pixel / mua trên Facebook, không cộng trùng).",
  purchase_value: "Giá trị mua hàng từ action_values (cùng loại với Lượt mua). Trống khi Meta không báo giá trị.",
  roas: "Giá trị mua hàng ÷ Chi tiêu.",
  cpa_purchase: "Chi tiêu ÷ Lượt mua.",
  cpc: "Chi tiêu ÷ Tất cả click.",
};

const L = {
  vi: {
    spend: "Chi tiêu", impressions: "Hiển thị", clicks: "Click", ctr: "CTR", cpc: "CPC", leads: "Leads", messages: "Tin nhắn", cpl: "CPL",
    follows: "Lượt theo dõi Trang", cost_per_follow: "Chi phí / theo dõi", page_engagement: "Tương tác Trang",
    reach: "Tiếp cận", frequency: "Tần suất", cpm: "CPM", link_clicks: "Click liên kết", link_ctr: "CTR liên kết",
    cost_per_link_click: "CPC liên kết", lpv: "Xem trang đích", lpv_rate: "Tỷ lệ xem trang đích", video_3s: "Xem video 3s",
    thruplay: "ThruPlay", hook_rate: "Hook rate", hold_rate: "Hold rate", ret25: "Xem 25%", ret50: "Xem 50%", ret75: "Xem 75%", ret100: "Xem 100%",
    cost_per_message: "Chi phí / tin nhắn mới", msg_first_reply: "Phản hồi đầu tiên", msg_replied: "Hội thoại có trả lời", msg_depth2: "Nhắn ≥2 tin",
    msg_depth3: "Nhắn ≥3 tin", msg_depth5: "Nhắn ≥5 tin", msg_connections: "Kết nối nhắn tin", deep_rate: "Tỷ lệ hội thoại sâu",
    purchases: "Lượt mua", purchase_value: "Giá trị mua hàng", roas: "ROAS", cpa_purchase: "CPA mua hàng",
    days: (n: number) => `${n} ngày`, compare: "So kỳ trước", campaigns: "Chiến dịch", adsets: "Nhóm quảng cáo", campaign: "Chiến dịch", name: "Tên",
    daily: "Chi tiêu theo ngày", loading: "Đang tải Facebook Ads…", empty: "Chưa có dữ liệu Facebook Ads trong khoảng này.",
    emptyHint: "Dữ liệu kéo mỗi ngày qua cron (35 ngày gần nhất). Không đoán số: ô trống nghĩa là Meta không báo.",
    through: "Dữ liệu đến", prev: "Kỳ trước", err: "Không tải được dữ liệu Facebook", none: "Không có dòng nào.",
  },
  en: {
    spend: "Spend", impressions: "Impressions", clicks: "Clicks", ctr: "CTR", cpc: "CPC", leads: "Leads", messages: "Messages", cpl: "CPL",
    follows: "Page follows", cost_per_follow: "Cost / follow", page_engagement: "Page engagement",
    reach: "Reach", frequency: "Frequency", cpm: "CPM", link_clicks: "Link clicks", link_ctr: "Link CTR",
    cost_per_link_click: "Cost / link click", lpv: "Landing page views", lpv_rate: "LPV rate", video_3s: "3s video views",
    thruplay: "ThruPlay", hook_rate: "Hook rate", hold_rate: "Hold rate", ret25: "Viewed 25%", ret50: "Viewed 50%", ret75: "Viewed 75%", ret100: "Viewed 100%",
    cost_per_message: "Cost / new message", msg_first_reply: "First replies", msg_replied: "Replied conversations", msg_depth2: "≥2 messages",
    msg_depth3: "≥3 messages", msg_depth5: "≥5 messages", msg_connections: "Messaging connections", deep_rate: "Deep conversation rate",
    purchases: "Purchases", purchase_value: "Purchase value", roas: "ROAS", cpa_purchase: "Cost / purchase",
    days: (n: number) => `${n} days`, compare: "Compare previous", campaigns: "Campaigns", adsets: "Ad sets", campaign: "Campaign", name: "Name",
    daily: "Daily spend", loading: "Loading Facebook Ads…", empty: "No Facebook Ads data in this range.",
    emptyHint: "Pulled daily by cron (last 35 days). Blank cells mean Meta did not report a value.",
    through: "Data through", prev: "Previous", err: "Could not load Facebook data", none: "No rows.",
  },
} as const;

/** Read-only Facebook (Meta) analytics: KPIs, daily spend, campaign + ad set tables. */
export function MetaAnalyticsView({
  clientId, allowCompare, lang = "vi", staffAlerts = false, focus = null, onFocusDone,
}: {
  clientId: string;
  allowCompare: boolean;
  lang?: Lang;
  /** Staff with Cảnh báo: fatigue / frequency / learning badges on ad set + ad rows. */
  staffAlerts?: boolean;
  /** Jump target from Cảnh báo (opens on 7 ngày, filters the ads table, scrolls to the row). */
  focus?: MetaFocus | null;
  onFocusDone?: () => void;
}) {
  const tx = L[lang];
  const [days, setDays] = useState<number>(focus ? 7 : 30);
  const [alerts, setAlerts] = useState<Map<string, MetaAlert[]>>(new Map());
  useEffect(() => {
    if (!staffAlerts) return;
    let live = true;
    readMetaAlertsFn({ data: { clientId } })
      .then((r) => {
        if (!live) return;
        const m = new Map<string, MetaAlert[]>();
        for (const a of r.alerts) { const k = `${a.level}:${a.object_id}`; m.set(k, [...(m.get(k) || []), a]); }
        setAlerts(m);
      })
      .catch(() => { /* badges are best-effort */ });
    return () => { live = false; };
  }, [clientId, staffAlerts]);
  const badgesFor = (level: "adset" | "ad") => (staffAlerts ? (r: MetaRow) => <AlertBadges list={alerts.get(`${level}:${r.id}`)} /> : undefined);
  const [hl, setHl] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [adFilter, setAdFilter] = useState<AdFilter>(focus?.level === "ad" ? { campaign: focus.campaignId || "", adset: focus.adsetId || "" } : { campaign: "", adset: "" });
  const pickAds = (f: AdFilter) => {
    setAdFilter(f);
    if (typeof document !== "undefined") document.getElementById("meta-ads-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const [data, setData] = useState<MetaAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const range = useMemo(() => ({ start: daysAgo(days), end: daysAgo(1) }), [days]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    readMetaAnalyticsFn({ data: { clientId, ...range, compare: allowCompare && compare } })
      .then((r) => { if (live) setData(r); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [clientId, range, nonce, allowCompare, compare]);

  // Same account already open: apply the jump target to the current view too.
  useEffect(() => {
    if (!focus) return;
    setDays(7);
    if (focus.level === "ad") setAdFilter({ campaign: focus.campaignId || "", adset: focus.adsetId || "" });
  }, [focus]);
  // Scroll to the focused row once the tables render.
  useEffect(() => {
    if (!focus || !data || loading) return;
    const id = `meta-row-${focus.level}-${focus.id}`;
    let tries = 0;
    const seek = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHl(id);
        window.setTimeout(() => setHl(null), 4000);
        onFocusDone?.();
      } else if (++tries < 20) window.setTimeout(seek, 150);
      else onFocusDone?.();
    };
    window.setTimeout(seek, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, data, loading]);

  const cur = data?.currency || "VND";
  const fmt = (k: KpiKey, v: number | null | undefined): string => {
    if (v == null) return "";
    if (MONEY.has(k)) return fmtMoney(lang, v, cur);
    if (PCT.has(k)) return fmtPct(lang, v);
    if (k === "roas") return `${v.toLocaleString(lang === "en" ? "en-US" : "vi-VN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}×`;
    if (k === "frequency") return v.toLocaleString(lang === "en" ? "en-US" : "vi-VN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
    return fmtNum(lang, v);
  };
  const showPrev = allowCompare && compare && data?.prev;
  // Frequency colours only make sense over ~a week (longer ranges naturally have higher frequency).
  const freqCtx = days <= 7;

  return (
    <FreqContext.Provider value={freqCtx}>
    <HlContext.Provider value={hl}>
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent" dot={false}>Facebook</Badge>
        <div className="flex gap-1 rounded-md border border-line bg-paper p-1">
          {PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={days === n}
              onClick={() => setDays(n)}
              className={cn("h-7 rounded px-2.5 text-sm font-medium", days === n ? "bg-accent-soft text-accent" : "text-muted hover:text-ink")}
            >
              {tx.days(n)}
            </button>
          ))}
        </div>
        {allowCompare ? (
          <label className="inline-flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
            {tx.compare}
          </label>
        ) : null}
        <span className="text-sm text-muted">
          {fmtRange(range.start, range.end)}
          {data?.data_through ? ` · ${tx.through} ${fmtDay(data.data_through)}` : ""}
          {showPrev && data?.prev_range ? ` · ${tx.prev} ${fmtRange(data.prev_range.start, data.prev_range.end)}` : ""}
        </span>
        {allowCompare && compare && data && data.prev_covered === false ? (
          <Badge tone="warn" title={data.history_from ? `Dữ liệu Facebook đang lưu từ ${fmtDay(data.history_from)}. Lịch sử 6 tháng được kéo dần mỗi ngày.` : undefined}>
            Chưa đủ dữ liệu kỳ trước{data.prev_range ? ` (${fmtRange(data.prev_range.start, data.prev_range.end)})` : ""}
          </Badge>
        ) : null}
      </div>

      <PacingCard clientId={clientId} />
      {error ? (
        <ErrorState title={tx.err} message={error} onRetry={() => setNonce((n) => n + 1)} />
      ) : loading && !data ? (
        <Card className="p-4"><p className="mb-3 text-sm text-muted">{tx.loading}</p><TableSkeleton rows={4} cols={6} /></Card>
      ) : !data || (!data.daily.length && !data.campaigns.length) ? (
        <Card><EmptyState icon={BarChart3} title={tx.empty} description={tx.emptyHint} /></Card>
      ) : (
        <>
          {data.state?.error ? <ErrorState title={tx.err} message={data.state.error} /> : null}
          <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8", loading && "opacity-60")}>
            {kpiOrder(data).map((k) => (
              <Kpi key={k} label={tx[k]} hint={HINT[k]} tone={freqTone(k, data.totals[k], freqCtx)} value={fmt(k, data.totals[k])} prev={showPrev ? fmt(k, data.prev![k]) : null} delta={showPrev ? delta(data.totals[k], data.prev![k], k) : null} />
            ))}
          </div>
          <Card className="p-4">
            <p className="mb-2 text-sm font-semibold text-ink">{tx.daily}</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.daily.map((d) => ({ label: fmtDay(d.date).slice(0, 5), spend: d.spend }))}>
                  <CartesianGrid {...chartTheme.grid} />
                  <XAxis dataKey="label" tick={chartTheme.axisTick} {...chartTheme.axis} minTickGap={18} />
                  <YAxis tick={chartTheme.axisTick} {...chartTheme.axis} width={64} tickFormatter={(v: number) => fmtMoneyShort(lang, v, cur)} />
                  <Tooltip contentStyle={chartTheme.tooltip.contentStyle} labelStyle={chartTheme.tooltip.labelStyle} formatter={(v: unknown) => [fmtMoney(lang, Number(v), cur), tx.spend]} />
                  <Bar dataKey="spend" fill={chartColors.primary} radius={chartTheme.bar.radius} maxBarSize={chartTheme.bar.maxBarSize} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <RowsTable
            title={tx.campaigns}
            rows={data.campaigns}
            fmt={fmt}
            tx={tx}
            compare={Boolean(showPrev)}
            extra={[
              { head: "Mục tiêu", cell: (r) => campaignMeta(r.config).objective },
              { head: "Trạng thái", cell: (r) => <StatusDot s={r.effective_status || r.status} /> },
              { head: "Loại mua", cell: (r) => campaignMeta(r.config).buying_type },
              { head: "Ngân sách", cell: (r) => budgetText(r, cur, lang) },
              { head: "Quảng cáo", cell: (r) => <PickAds onClick={() => pickAds({ campaign: r.id, adset: "" })} /> },
            ]}
          />
          <RowsTable
            title={tx.adsets}
            rows={data.adsets}
            badges={badgesFor("adset")}
            fmt={fmt}
            tx={tx}
            compare={Boolean(showPrev)}
            extra={[
              { head: tx.campaign, cell: (r) => r.campaign_name, muted: true },
              { head: "Trạng thái", cell: (r) => <StatusDot s={r.effective_status || r.status} /> },
              { head: "Nhắm mục tiêu", cell: (r) => adsetSummary(r.config, cur, (v) => fmtMoney(lang, v, cur)).short, muted: true },
              { head: "Ngân sách", cell: (r) => budgetText(r, cur, lang) },
              { head: "Quảng cáo", cell: (r) => <PickAds onClick={() => pickAds({ campaign: r.campaign_id || "", adset: r.id })} /> },
            ]}
            expand={(r) => (
              <>
                <p className="mb-2 truncate text-sm font-semibold text-ink" title={`${r.name}${r.campaign_name ? ` · Chiến dịch: ${r.campaign_name}` : ""}`}>
                  Nhắm mục tiêu · {r.name}
                  {r.campaign_name ? <span className="font-normal text-muted"> · Chiến dịch: {r.campaign_name}</span> : null}
                </p>
                <TargetingDetail lines={adsetSummary(r.config, cur, (v) => fmtMoney(lang, v, cur)).lines} />
              </>
            )}
          />
          <AdsTable badges={badgesFor("ad")} rows={data.ads} campaigns={data.campaigns} adsets={data.adsets} filter={adFilter} setFilter={setAdFilter} fmt={fmt} tx={tx} compare={Boolean(showPrev)} />
          {!data.structure_pulled_at ? <p className="text-xs text-muted">Chưa kéo cấu trúc chiến dịch (mục tiêu, nhắm mục tiêu, mẫu quảng cáo). Bấm “Kiểm tra lại” hoặc chờ lần đồng bộ hằng ngày.</p> : null}
        </>
      )}
    </div>
    </HlContext.Provider>
    </FreqContext.Provider>
  );
}

const HlContext = createContext<string | null>(null);

function AlertBadges({ list }: { list?: MetaAlert[] }) {
  if (!list?.length) return null;
  return <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">{list.map((a) => alertBadge(a))}</span>;
}

const FreqContext = createContext(false);
function freqTone(k: KpiKey, v: number | null | undefined, on: boolean): string | null {
  if (k !== "frequency" || v == null || !on) return null;
  return v > FREQ_BAD ? "text-danger font-semibold" : v > FREQ_WARN ? "text-warn font-semibold" : null;
}

function delta(cur: number | null, prev: number | null, k: KpiKey): { text: string; good: boolean | null } | null {
  if (cur == null || prev == null || prev === 0) return null;
  const d = (cur - prev) / prev;
  const up = d >= 0;
  return { text: `${up ? "+" : ""}${(d * 100).toFixed(1)}%`, good: NEUTRAL[k] ? null : LOWER_BETTER[k] ? !up : up };
}

function Kpi({ label, value, prev, delta: dl, hint, tone }: { label: string; value: string; prev: string | null; delta: { text: string; good: boolean | null } | null; hint?: string; tone?: string | null }) {
  return (
    <Card className="px-3 py-3">
      <p className={cn("text-xs font-medium text-muted", hint && "cursor-help underline decoration-dotted underline-offset-2")} title={hint}>{label}</p>
      <p className={cn("mt-1 truncate text-lg font-semibold tabular-nums text-ink", tone)} title={value}>{value || "\u00a0"}</p>
      {prev != null ? (
        <p className="mt-0.5 truncate text-xs tabular-nums text-muted">
          {prev || "—"}
          {dl ? <span className={cn("ml-1 font-medium", dl.good == null ? "text-muted" : dl.good ? "text-ok" : "text-danger")}>{dl.text}</span> : null}
        </p>
      ) : null}
    </Card>
  );
}

type Extra = { head: string; cell: (r: MetaRow) => ReactNode; muted?: boolean };
type Fmt = (k: KpiKey, v: number | null | undefined) => string;
const ALL_COLS = [
  "spend", "impressions", "reach", "frequency", "cpm", "clicks", "ctr", "cpc",
  "link_clicks", "link_ctr", "cost_per_link_click", "lpv", "lpv_rate",
  "follows", "cost_per_follow", "page_engagement", "leads", "messages", "cpl",
  "cost_per_message", "msg_first_reply", "msg_replied", "msg_depth2", "msg_depth3", "msg_depth5", "msg_connections", "deep_rate",
  "purchases", "purchase_value", "roas", "cpa_purchase",
  "video_3s", "hook_rate", "thruplay", "hold_rate", "ret25", "ret50", "ret75", "ret100",
] as const satisfies readonly (keyof MetaMetrics)[];
/** Core columns always (when chosen); the rest only when some row in this table has a value (blank otherwise). */
const CORE = new Set<KpiKey>(["spend", "impressions", "clicks", "ctr", "cpc", "cpm"]);
const DEFAULT_COLS = new Set<KpiKey>([
  "spend", "impressions", "reach", "frequency", "cpm", "clicks", "ctr", "cpc",
  "follows", "cost_per_follow", "page_engagement", "leads", "messages", "cpl", "hook_rate", "hold_rate",
  "cost_per_message", "deep_rate", "purchases", "purchase_value", "roas", "cpa_purchase",
]);
const colsFor = (rows: MetaRow[], chosen: Set<KpiKey> = DEFAULT_COLS) =>
  ALL_COLS.filter((c) => chosen.has(c) && (CORE.has(c) || rows.some((r) => r[c] != null)));

/** "Cột" choice per table, remembered in this browser. */
function useColumnChoice(table: string) {
  const key = `adsops:fb-cols:v1:${table}`;
  const [chosen, setChosen] = useState<Set<KpiKey>>(DEFAULT_COLS);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setChosen(new Set((JSON.parse(raw) as string[]).filter((k): k is KpiKey => (ALL_COLS as readonly string[]).includes(k))));
    } catch { /* ignore */ }
  }, [key]);
  const toggle = (k: KpiKey) =>
    setChosen((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      try { window.localStorage.setItem(key, JSON.stringify([...n])); } catch { /* ignore */ }
      return n;
    });
  const reset = () => { setChosen(new Set(DEFAULT_COLS)); try { window.localStorage.removeItem(key); } catch { /* ignore */ } };
  return { chosen, toggle, reset };
}

function ColumnPicker({ cc, tx }: { cc: ReturnType<typeof useColumnChoice>; tx: (typeof L)[Lang] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={box} className="relative ml-auto">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-paper px-2 text-xs font-medium text-muted hover:text-ink">
        <Columns3 className="size-3.5" /> Cột
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-40 mt-1 max-h-96 w-64 overflow-auto rounded-lg border border-line bg-paper py-1 shadow-sheet">
          {ALL_COLS.map((k) => (
            <label key={k} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-ink hover:bg-inset" title={HINT[k]}>
              <input type="checkbox" className="size-4 accent-accent" checked={cc.chosen.has(k)} onChange={() => cc.toggle(k)} />
              {tx[k]}
            </label>
          ))}
          <button type="button" onClick={cc.reset} className="mt-1 block w-full border-t border-line px-3 py-2 text-left text-xs font-medium text-accent hover:bg-inset">Mặc định</button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * KPI cards: core always; result metrics only if reported. Follow metrics lead when the account
 * runs engagement/follow campaigns (or has follows but no leads); otherwise leads lead.
 */
function kpiOrder(d: MetaAnalytics): KpiKey[] {
  const t = d.totals;
  const engagement = d.campaigns.some((c) => String(c.config?.objective || "").includes("ENGAGEMENT") || String(c.config?.objective || "") === "PAGE_LIKES");
  const followFirst = t.follows != null && (engagement || t.leads == null);
  const follow: KpiKey[] = ["follows", "cost_per_follow", "page_engagement"];
  const lead: KpiKey[] = ["leads", "cpl", "messages"];
  const results = (followFirst ? [...follow, ...lead] : [...lead, ...follow]).filter((k) => t[k] != null || (k === "leads" && t.follows == null));
  const delivery: KpiKey[] = ["reach", "frequency", "cpm"];
  // Adaptive: messaging cards only with messaging data, purchase cards only with purchases.
  const msg: KpiKey[] = t.messages != null ? ["messages", "cost_per_message", "deep_rate"] : [];
  const buy: KpiKey[] = t.purchases != null ? ["purchases", "purchase_value", "roas", "cpa_purchase"] : [];
  const res = msg.length ? results.filter((k) => k !== "messages") : results;
  const order = (followFirst
    ? ["spend", ...res.slice(0, 2), "impressions", ...delivery, "clicks", "ctr", "cpc", ...res.slice(2)]
    : ["spend", "impressions", ...delivery, "clicks", "ctr", "cpc", ...res]) as KpiKey[];
  return [...order, ...buy, ...msg];
}

function budgetText(r: MetaRow, cur: string, lang: Lang): string | null {
  const b = budgetOf(r.config, cur);
  return b ? `${fmtMoney(lang, b.value, cur)}${b.kind === "daily" ? "/ngày" : " trọn đời"}` : null;
}

function StatusDot({ s }: { s: string | null | undefined }) {
  if (!s) return null;
  const tone = s === "ACTIVE" ? "ok" : s === "DISAPPROVED" || s === "WITH_ISSUES" ? "danger" : s.includes("PAUSED") ? "neutral" : "warn";
  return <Badge tone={tone}>{statusVi(s)}</Badge>;
}

function TargetingDetail({ lines }: { lines: Array<{ label: string; value: string }> }) {
  if (!lines.length) return <p className="text-sm text-muted">Chưa có dữ liệu nhắm mục tiêu.</p>;
  return (
    <dl className="grid gap-x-6 gap-y-1.5 text-sm md:grid-cols-[12rem_1fr]">
      {lines.map((l, i) => (
        <Fragment key={i}>
          <dt className="text-muted">{l.label}</dt>
          <dd className="text-ink [overflow-wrap:anywhere]">{l.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

type SortState = { key: KpiKey; by: "value" | "change"; dir: 1 | -1 } | null;
const changeOf = (r: MetaRow, k: KpiKey): number | null => {
  const c = r.tag === "gone" ? null : r[k];
  const p = r.prev?.[k];
  return c != null && p != null && p !== 0 ? (c - p) / p : null;
};
function useSorted(rows: MetaRow[], compare: boolean) {
  const [sort, setSort] = useState<SortState>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const val = (r: MetaRow) => (sort.by === "change" ? (compare ? changeOf(r, sort.key) : null) : r.tag === "gone" ? null : r[sort.key]);
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x - y) * sort.dir;
    });
  }, [rows, sort, compare]);
  const click = (key: KpiKey, by: "value" | "change") =>
    setSort((s) => (s && s.key === key && s.by === by ? { key, by, dir: s.dir === -1 ? 1 : -1 } : { key, by, dir: -1 }));
  return { sorted, sort, click };
}

function MetricHead({ k, label, sort, click, compare }: { k: KpiKey; label: string; sort: SortState; click: (k: KpiKey, by: "value" | "change") => void; compare: boolean }) {
  const icon = (by: "value" | "change") =>
    sort && sort.key === k && sort.by === by ? (sort.dir === -1 ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />) : null;
  return (
    <th className="px-3 py-2 text-right font-medium" aria-sort={sort?.key === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <span className="inline-flex items-center justify-end gap-1">
        <button type="button" title={HINT[k]} onClick={() => click(k, "value")} className={cn("inline-flex items-center gap-0.5 hover:text-ink", HINT[k] && "underline decoration-dotted underline-offset-2")}>{label}{icon("value")}</button>
        {compare ? (
          <button type="button" title="Sắp xếp theo % thay đổi" onClick={() => click(k, "change")} className="inline-flex items-center rounded px-1 text-[11px] text-subtle hover:bg-paper hover:text-ink">Δ%{icon("change")}</button>
        ) : null}
      </span>
    </th>
  );
}

function MetricCell({ r, k, fmt, compare }: { r: MetaRow; k: KpiKey; fmt: Fmt; compare: boolean }) {
  const cur = r.tag === "gone" ? "" : fmt(k, r[k]);
  const ch = compare ? changeOf(r, k) : null;
  const good = ch == null || NEUTRAL[k] ? null : LOWER_BETTER[k] ? ch < 0 : ch > 0;
  const prevText = compare && r.prev ? fmt(k, r.prev[k]) : "";
  const freqOn = useContext(FreqContext);
  const tone = r.tag === "gone" ? null : freqTone(k, r[k], freqOn);
  return (
    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink" title={prevText ? `Kỳ trước: ${prevText}` : undefined}>
      <span className={cn("block", tone)}>{cur}</span>
      {ch != null && Math.abs(ch) >= 0.0005 ? (
        <span className={cn("block text-xs font-medium", good == null ? "text-muted" : good ? "text-ok" : "text-danger")}>{`${ch > 0 ? "+" : ""}${(ch * 100).toFixed(1)}%`}</span>
      ) : ch != null ? <span className="block text-xs text-muted">0%</span> : null}
    </td>
  );
}

function RowTag({ tag }: { tag?: MetaRow["tag"] }) {
  if (tag === "new") return <Badge tone="accent" dot={false} className="ml-1.5">Mới</Badge>;
  if (tag === "gone") return <Badge tone="neutral" dot={false} className="ml-1.5">Không chạy kỳ này</Badge>;
  return null;
}

/** Visible width of a horizontal scroll container (for panels pinned to its left edge). */
function useVisibleWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}
/** Sticky-left first column: opaque background + divider so scrolled cells don't show through. */
const STICKY = "sticky left-0 z-10 shadow-[inset_-1px_0_0_var(--color-line)]";

/** "" = no status stored (structure not synced yet). */
const statusKey = (r: MetaRow) => r.effective_status || r.status || "";

/** Multi-select status filter state; empty set = Tất cả. */
function useStatusFilter(rows: MetaRow[]) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(statusKey(r), (m.get(statusKey(r)) || 0) + 1);
    const rank = (k: string) => { const i = STATUS_ORDER.indexOf(k); return i < 0 ? (k ? 900 : 999) : i; };
    return [...m.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [rows]);
  const shown = useMemo(() => (sel.size ? rows.filter((r) => sel.has(statusKey(r))) : rows), [rows, sel]);
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  return { sel, counts, shown, toggle, clear: () => setSel(new Set()) };
}

function StatusChips({ f }: { f: ReturnType<typeof useStatusFilter> }) {
  if (!f.counts.length && !f.sel.size) return null;
  const chip = (on: boolean) =>
    cn(
      "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors",
      on ? "border-accent bg-accent-soft text-accent" : "border-line bg-paper text-muted hover:border-line-strong hover:text-ink",
    );
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Lọc theo trạng thái">
      <button type="button" aria-pressed={!f.sel.size} onClick={f.clear} className={chip(!f.sel.size)}>Tất cả</button>
      {f.counts.map(([k, n]) => (
        <button key={k || "none"} type="button" aria-pressed={f.sel.has(k)} onClick={() => f.toggle(k)} className={chip(f.sel.has(k))}>
          {k ? statusVi(k) : "Chưa có trạng thái"} <span className="tabular-nums text-subtle">{n}</span>
        </button>
      ))}
    </div>
  );
}

function RowsTable({
  title, rows, fmt, tx, extra = [], expand, compare = false, badges,
}: {
  badges?: (r: MetaRow) => ReactNode;
  title: string;
  rows: MetaRow[];
  fmt: Fmt;
  tx: (typeof L)[Lang];
  extra?: Extra[];
  expand?: (r: MetaRow) => ReactNode;
  compare?: boolean;
}) {
  const sf = useStatusFilter(rows);
  const { sorted, sort, click } = useSorted(sf.shown, compare);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const hl = useContext(HlContext);
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const cc = useColumnChoice(title === tx.campaigns ? "campaign" : "adset");
  const cols = colsFor(sf.shown, cc.chosen);
  const span = 1 + extra.length + cols.length;
  const { ref: scrollRef, w: visibleW } = useVisibleWidth();
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <p className="mr-2 text-sm font-semibold text-ink">
          {title} <span className="font-normal text-muted">({sf.sel.size ? `${sf.shown.length}/${rows.length}` : rows.length})</span>
        </p>
        <StatusChips f={sf} />
        <ColumnPicker cc={cc} tx={tx} />
      </div>
      {sf.shown.length ? (
        <div ref={scrollRef} className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-inset text-xs text-muted">
              <tr>
                <th className={cn(STICKY, "bg-inset px-4 py-2 text-left font-medium")}>{tx.name}</th>
                {extra.map((e) => <th key={e.head} className="px-3 py-2 text-left font-medium">{e.head}</th>)}
                {cols.map((c) => <MetricHead key={c} k={c} label={tx[c]} sort={sort} click={click} compare={compare} />)}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <Fragment key={r.id}>
                  <tr id={`meta-row-${title === tx.campaigns ? "campaign" : "adset"}-${r.id}`} className={cn("scroll-mt-24 border-t border-line", hl === `meta-row-${title === tx.campaigns ? "campaign" : "adset"}-${r.id}` && "bg-accent-soft ring-2 ring-inset ring-accent")}>
                    <td className={cn(STICKY, "max-w-[22rem] bg-paper px-4 py-2 text-ink")} title={r.name}>
                      {expand ? (
                        <button type="button" onClick={() => toggle(r.id)} aria-expanded={open.has(r.id)} className="inline-flex max-w-full items-center gap-1 text-left hover:text-accent">
                          <ChevronRight className={cn("size-4 shrink-0 transition-transform", open.has(r.id) && "rotate-90")} />
                          <span className="truncate">{r.name}</span>
                          <RowTag tag={r.tag} />
                          {badges?.(r)}
                        </button>
                      ) : <span className="flex min-w-0 items-center"><span className="truncate">{r.name}</span><RowTag tag={r.tag} />{badges?.(r)}</span>}
                    </td>
                    {extra.map((e) => (
                      <td key={e.head} className={cn("max-w-[18rem] truncate px-3 py-2", e.muted ? "text-muted" : "text-ink")}>{e.cell(r)}</td>
                    ))}
                    {cols.map((c) => <MetricCell key={c} r={r} k={c} fmt={fmt} compare={compare} />)}
                  </tr>
                  {expand && open.has(r.id) ? (
                    <tr className="border-t border-line bg-inset">
                      <td colSpan={span} className="p-0">
                        {/* Pinned to the visible area: stays readable while the table scrolls sideways. */}
                        <div className="sticky left-0 bg-inset px-10 py-3" style={visibleW ? { width: visibleW } : undefined}>{expand(r)}</div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-6 text-sm text-muted">{rows.length ? "Không có dòng khớp bộ lọc." : tx.none}</p>
      )}
    </Card>
  );
}

type AdFilter = { campaign: string; adset: string };

function PickAds({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-xs font-medium text-accent hover:underline">
      Xem quảng cáo
    </button>
  );
}

const SELECT = "h-9 min-w-0 max-w-[22rem] rounded-lg border border-line bg-paper px-2 text-sm text-ink hover:border-line-strong";

function AdBody({ c }: { c: ReturnType<typeof creativeOf> }) {
  const [full, setFull] = useState(false);
  const long = (c.body?.length || 0) > 160 || (c.body?.split("\n").length || 0) > 3;
  if (!c.title && !c.body) return null;
  return (
    <div className="w-[22rem]">
      {c.title ? <p className={cn("font-medium text-ink", !full && "line-clamp-2")} title={c.title}>{c.title}</p> : null}
      {c.body ? <p className={cn("whitespace-pre-line break-words text-muted", !full && "line-clamp-3")}>{c.body}</p> : null}
      {full && c.link ? (
        <a href={c.link} target="_blank" rel="noreferrer" className="mt-1 block break-all text-xs text-accent hover:underline">{c.link}</a>
      ) : null}
      {long || c.link ? (
        <button type="button" onClick={() => setFull((v) => !v)} aria-expanded={full} className="mt-1 text-xs font-medium text-accent hover:underline">
          {full ? "Thu gọn" : "Xem đầy đủ"}
        </button>
      ) : null}
    </div>
  );
}

function AdsTable({
  rows, campaigns, adsets, filter, setFilter, fmt, tx, compare = false, badges,
}: {
  badges?: (r: MetaRow) => ReactNode;
  rows: MetaRow[];
  campaigns: MetaRow[];
  adsets: MetaRow[];
  filter: AdFilter;
  setFilter: (f: AdFilter) => void;
  fmt: Fmt;
  tx: (typeof L)[Lang];
  compare?: boolean;
}) {
  const campaignOpts = useMemo(() => [...campaigns].sort((a, b) => a.name.localeCompare(b.name, "vi")), [campaigns]);
  const adsetOpts = useMemo(
    () => [...adsets].filter((a) => !filter.campaign || a.campaign_id === filter.campaign).sort((a, b) => a.name.localeCompare(b.name, "vi")),
    [adsets, filter.campaign],
  );
  const byParent = useMemo(
    () => rows.filter((r) => (!filter.campaign || r.campaign_id === filter.campaign) && (!filter.adset || r.adset_id === filter.adset)),
    [rows, filter],
  );
  // Status counts follow the campaign / ad set filter.
  const sf = useStatusFilter(byParent);
  const shown = sf.shown;
  const cc = useColumnChoice("ad");
  const hl = useContext(HlContext);
  const cols = colsFor(shown, cc.chosen);
  const { sorted, sort, click } = useSorted(shown, compare);
  const filtered = Boolean(filter.campaign || filter.adset || sf.sel.size);
  return (
    <Card id="meta-ads-table" className="overflow-hidden scroll-mt-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <p className="mr-2 text-sm font-semibold text-ink">
          Quảng cáo <span className="font-normal text-muted">({filtered ? `${shown.length}/${rows.length}` : rows.length})</span>
        </p>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Chiến dịch
          <select className={SELECT} value={filter.campaign} onChange={(e) => setFilter({ campaign: e.target.value, adset: "" })}>
            <option value="">Tất cả</option>
            {campaignOpts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Nhóm quảng cáo
          <select
            className={SELECT}
            value={filter.adset}
            onChange={(e) => {
              const id = e.target.value;
              const a = adsets.find((x) => x.id === id);
              setFilter({ campaign: id && a?.campaign_id ? a.campaign_id : filter.campaign, adset: id });
            }}
          >
            <option value="">Tất cả</option>
            {adsetOpts.map((a) => <option key={a.id} value={a.id}>{filter.campaign ? a.name : `${a.name} — ${a.campaign_name || ""}`}</option>)}
          </select>
        </label>
        {filtered ? (
          <button type="button" onClick={() => { setFilter({ campaign: "", adset: "" }); sf.clear(); }} className="text-xs font-medium text-accent hover:underline">Bỏ lọc</button>
        ) : null}
        <ColumnPicker cc={cc} tx={tx} />
        <div className="basis-full" />
        <StatusChips f={sf} />
      </div>
      {shown.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-inset text-xs text-muted">
              <tr>
                <th className="sticky left-0 z-10 w-24 min-w-24 bg-inset px-4 py-2 text-left font-medium">Mẫu</th>
                <th className="sticky left-24 z-10 bg-inset px-3 py-2 text-left font-medium shadow-[inset_-1px_0_0_var(--color-line)]">Quảng cáo</th>
                <th className="px-3 py-2 text-left font-medium">Nội dung</th>
                <th className="px-3 py-2 text-left font-medium">Nút</th>
                {cols.map((c) => <MetricHead key={c} k={c} label={tx[c]} sort={sort} click={click} compare={compare} />)}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const c = creativeOf(r.config);
                return (
                  <tr key={r.id} id={`meta-row-ad-${r.id}`} className={cn("scroll-mt-24 border-t border-line align-top", hl === `meta-row-ad-${r.id}` && "bg-accent-soft ring-2 ring-inset ring-accent")}>
                    <td className="sticky left-0 z-10 w-24 min-w-24 bg-paper px-4 py-2">
                      {c.thumb ? (
                        <img src={c.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-16 rounded-md border border-line object-cover" />
                      ) : <div className="size-16 rounded-md bg-inset" />}
                    </td>
                    <td className="sticky left-24 z-10 w-[16rem] min-w-[16rem] max-w-[16rem] bg-paper px-3 py-2 shadow-[inset_-1px_0_0_var(--color-line)]">
                      <p className="break-words font-medium text-ink">{r.name}<RowTag tag={r.tag} />{badges?.(r)}</p>
                      {r.adset_name ? <p className="mt-0.5 break-words text-xs text-muted"><span className="text-subtle">Nhóm:</span> {r.adset_name}</p> : null}
                      {r.campaign_name ? <p className="break-words text-xs text-muted"><span className="text-subtle">Chiến dịch:</span> {r.campaign_name}</p> : null}
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <StatusDot s={r.effective_status || r.status} />
                        {c.post_url ? <a href={c.post_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs font-medium text-accent hover:underline">Bài viết <ExternalLink className="size-3" /></a> : null}
                        {c.preview_url ? <a href={c.preview_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs font-medium text-accent hover:underline">Xem trước <ExternalLink className="size-3" /></a> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2"><AdBody c={c} /></td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {c.cta ? (
                        <>
                          <span className="text-ink">{c.cta}</span>
                          {c.cta_note ? <span className="block text-xs text-muted">{c.cta_note}</span> : null}
                        </>
                      ) : r.config ? <span className="text-muted">Không có nút</span> : null}
                    </td>
                    {cols.map((k) => <MetricCell key={k} r={r} k={k} fmt={fmt} compare={compare} />)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-6 text-sm text-muted">{rows.length ? "Không có quảng cáo khớp bộ lọc." : tx.none}</p>
      )}
    </Card>
  );
}
