import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3 } from "lucide-react";
import { readMetaAnalyticsFn, type MetaAnalytics, type MetaMetrics, type MetaRow } from "@/lib/adsops/meta-ads.functions";
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
type KpiKey = "spend" | "impressions" | "clicks" | "ctr" | "cpc" | "leads" | "messages" | "cpl";
/** Lower is better for cost metrics (delta colour flips). */
const LOWER_BETTER: Partial<Record<KpiKey, true>> = { cpc: true, cpl: true };

const L = {
  vi: {
    spend: "Chi tiêu", impressions: "Hiển thị", clicks: "Click", ctr: "CTR", cpc: "CPC", leads: "Leads", messages: "Tin nhắn", cpl: "CPL",
    days: (n: number) => `${n} ngày`, compare: "So kỳ trước", campaigns: "Chiến dịch", adsets: "Nhóm quảng cáo", campaign: "Chiến dịch", name: "Tên",
    daily: "Chi tiêu theo ngày", loading: "Đang tải Facebook Ads…", empty: "Chưa có dữ liệu Facebook Ads trong khoảng này.",
    emptyHint: "Dữ liệu kéo mỗi ngày qua cron (35 ngày gần nhất). Không đoán số: ô trống nghĩa là Meta không báo.",
    through: "Dữ liệu đến", prev: "Kỳ trước", err: "Không tải được dữ liệu Facebook", none: "Không có dòng nào.",
  },
  en: {
    spend: "Spend", impressions: "Impressions", clicks: "Clicks", ctr: "CTR", cpc: "CPC", leads: "Leads", messages: "Messages", cpl: "CPL",
    days: (n: number) => `${n} days`, compare: "Compare previous", campaigns: "Campaigns", adsets: "Ad sets", campaign: "Campaign", name: "Name",
    daily: "Daily spend", loading: "Loading Facebook Ads…", empty: "No Facebook Ads data in this range.",
    emptyHint: "Pulled daily by cron (last 35 days). Blank cells mean Meta did not report a value.",
    through: "Data through", prev: "Previous", err: "Could not load Facebook data", none: "No rows.",
  },
} as const;

/** Read-only Facebook (Meta) analytics: KPIs, daily spend, campaign + ad set tables. */
export function MetaAnalyticsView({ clientId, allowCompare, lang = "vi" }: { clientId: string; allowCompare: boolean; lang?: Lang }) {
  const tx = L[lang];
  const [days, setDays] = useState<number>(30);
  const [compare, setCompare] = useState(false);
  const [data, setData] = useState<MetaAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const range = useMemo(() => ({ start: daysAgo(days), end: daysAgo(1) }), [days]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    readMetaAnalyticsFn({ data: { clientId, ...range } })
      .then((r) => { if (live) setData(r); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [clientId, range, nonce]);

  const cur = data?.currency || "VND";
  const fmt = (k: KpiKey, v: number | null | undefined): string => {
    if (v == null) return "";
    if (k === "spend" || k === "cpc" || k === "cpl") return fmtMoney(lang, v, cur);
    if (k === "ctr") return fmtPct(lang, v);
    return fmtNum(lang, v);
  };
  const showPrev = allowCompare && compare && data?.prev;

  return (
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
      </div>

      {error ? (
        <ErrorState title={tx.err} message={error} onRetry={() => setNonce((n) => n + 1)} />
      ) : loading && !data ? (
        <Card className="p-4"><p className="mb-3 text-sm text-muted">{tx.loading}</p><TableSkeleton rows={4} cols={6} /></Card>
      ) : !data || (!data.daily.length && !data.campaigns.length) ? (
        <Card><EmptyState icon={BarChart3} title={tx.empty} description={tx.emptyHint} /></Card>
      ) : (
        <>
          {data.state?.error ? <ErrorState title={tx.err} message={data.state.error} /> : null}
          <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8", loading && "opacity-60")}>
            {(["spend", "impressions", "clicks", "ctr", "cpc", "leads", "messages", "cpl"] as const).map((k) => (
              <Kpi key={k} label={tx[k]} value={fmt(k, data.totals[k])} prev={showPrev ? fmt(k, data.prev![k]) : null} delta={showPrev ? delta(data.totals[k], data.prev![k], k) : null} />
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
          <RowsTable title={tx.campaigns} rows={data.campaigns} fmt={fmt} tx={tx} />
          <RowsTable title={tx.adsets} rows={data.adsets} fmt={fmt} tx={tx} withCampaign />
        </>
      )}
    </div>
  );
}

function delta(cur: number | null, prev: number | null, k: KpiKey): { text: string; good: boolean } | null {
  if (cur == null || prev == null || prev === 0) return null;
  const d = (cur - prev) / prev;
  const up = d >= 0;
  return { text: `${up ? "+" : ""}${(d * 100).toFixed(1)}%`, good: LOWER_BETTER[k] ? !up : up };
}

function Kpi({ label, value, prev, delta: dl }: { label: string; value: string; prev: string | null; delta: { text: string; good: boolean } | null }) {
  return (
    <Card className="px-3 py-3">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums text-ink" title={value}>{value || "\u00a0"}</p>
      {prev != null ? (
        <p className="mt-0.5 truncate text-xs tabular-nums text-muted">
          {prev || "—"}
          {dl ? <span className={cn("ml-1 font-medium", dl.good ? "text-ok" : "text-danger")}>{dl.text}</span> : null}
        </p>
      ) : null}
    </Card>
  );
}

function RowsTable({
  title, rows, fmt, tx, withCampaign = false,
}: {
  title: string;
  rows: MetaRow[];
  fmt: (k: KpiKey, v: number | null | undefined) => string;
  tx: (typeof L)[Lang];
  withCampaign?: boolean;
}) {
  const cols = ["spend", "impressions", "clicks", "ctr", "cpc", "leads", "messages", "cpl"] as const satisfies readonly (keyof MetaMetrics)[];
  return (
    <Card className="overflow-hidden">
      <p className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">{title} <span className="font-normal text-muted">({rows.length})</span></p>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-inset text-xs text-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">{tx.name}</th>
                {withCampaign ? <th className="px-3 py-2 text-left font-medium">{tx.campaign}</th> : null}
                {cols.map((c) => <th key={c} className="px-3 py-2 text-right font-medium">{tx[c]}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="max-w-[22rem] truncate px-4 py-2 text-ink" title={r.name}>{r.name}</td>
                  {withCampaign ? <td className="max-w-[16rem] truncate px-3 py-2 text-muted" title={r.campaign_name || ""}>{r.campaign_name || ""}</td> : null}
                  {cols.map((c) => <td key={c} className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink">{fmt(c, r[c])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-6 text-sm text-muted">{tx.none}</p>
      )}
    </Card>
  );
}
