import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp, BarChart3, ChevronRight, ExternalLink } from "lucide-react";
import { adsetSummary, budgetOf, campaignMeta, creativeOf, statusVi } from "@/lib/adsops/meta-structure";
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
type KpiKey = "spend" | "impressions" | "clicks" | "ctr" | "cpc" | "leads" | "messages" | "cpl" | "follows" | "cost_per_follow" | "page_engagement";
/** Lower is better for cost metrics (delta colour flips). */
const LOWER_BETTER: Partial<Record<KpiKey, true>> = { cpc: true, cpl: true, cost_per_follow: true };

const L = {
  vi: {
    spend: "Chi tiêu", impressions: "Hiển thị", clicks: "Click", ctr: "CTR", cpc: "CPC", leads: "Leads", messages: "Tin nhắn", cpl: "CPL",
    follows: "Lượt theo dõi Trang", cost_per_follow: "Chi phí / theo dõi", page_engagement: "Tương tác Trang",
    days: (n: number) => `${n} ngày`, compare: "So kỳ trước", campaigns: "Chiến dịch", adsets: "Nhóm quảng cáo", campaign: "Chiến dịch", name: "Tên",
    daily: "Chi tiêu theo ngày", loading: "Đang tải Facebook Ads…", empty: "Chưa có dữ liệu Facebook Ads trong khoảng này.",
    emptyHint: "Dữ liệu kéo mỗi ngày qua cron (35 ngày gần nhất). Không đoán số: ô trống nghĩa là Meta không báo.",
    through: "Dữ liệu đến", prev: "Kỳ trước", err: "Không tải được dữ liệu Facebook", none: "Không có dòng nào.",
  },
  en: {
    spend: "Spend", impressions: "Impressions", clicks: "Clicks", ctr: "CTR", cpc: "CPC", leads: "Leads", messages: "Messages", cpl: "CPL",
    follows: "Page follows", cost_per_follow: "Cost / follow", page_engagement: "Page engagement",
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
    readMetaAnalyticsFn({ data: { clientId, ...range, compare: allowCompare && compare } })
      .then((r) => { if (live) setData(r); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [clientId, range, nonce, allowCompare, compare]);

  const cur = data?.currency || "VND";
  const fmt = (k: KpiKey, v: number | null | undefined): string => {
    if (v == null) return "";
    if (k === "spend" || k === "cpc" || k === "cpl" || k === "cost_per_follow") return fmtMoney(lang, v, cur);
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
        {allowCompare && compare && data && data.prev_covered === false ? (
          <Badge tone="warn" title={data.history_from ? `Dữ liệu Facebook đang lưu từ ${fmtDay(data.history_from)}. Lịch sử 6 tháng được kéo dần mỗi ngày.` : undefined}>
            Chưa đủ dữ liệu kỳ trước{data.prev_range ? ` (${fmtRange(data.prev_range.start, data.prev_range.end)})` : ""}
          </Badge>
        ) : null}
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
          <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8", loading && "opacity-60")}>
            {kpiOrder(data).map((k) => (
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
            ]}
          />
          <RowsTable
            title={tx.adsets}
            rows={data.adsets}
            fmt={fmt}
            tx={tx}
            compare={Boolean(showPrev)}
            extra={[
              { head: tx.campaign, cell: (r) => r.campaign_name, muted: true },
              { head: "Trạng thái", cell: (r) => <StatusDot s={r.effective_status || r.status} /> },
              { head: "Nhắm mục tiêu", cell: (r) => adsetSummary(r.config, cur, (v) => fmtMoney(lang, v, cur)).short, muted: true },
              { head: "Ngân sách", cell: (r) => budgetText(r, cur, lang) },
            ]}
            expand={(r) => <TargetingDetail lines={adsetSummary(r.config, cur, (v) => fmtMoney(lang, v, cur)).lines} />}
          />
          <AdsTable rows={data.ads} fmt={fmt} tx={tx} compare={Boolean(showPrev)} />
          {!data.structure_pulled_at ? <p className="text-xs text-muted">Chưa kéo cấu trúc chiến dịch (mục tiêu, nhắm mục tiêu, mẫu quảng cáo). Bấm “Kiểm tra lại” hoặc chờ lần đồng bộ hằng ngày.</p> : null}
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

type Extra = { head: string; cell: (r: MetaRow) => ReactNode; muted?: boolean };
type Fmt = (k: KpiKey, v: number | null | undefined) => string;
const ALL_COLS = ["spend", "impressions", "clicks", "ctr", "cpc", "follows", "cost_per_follow", "page_engagement", "leads", "messages", "cpl"] as const satisfies readonly (keyof MetaMetrics)[];
/** Core columns always; result columns only when some row in this table has a value (blank otherwise). */
const CORE = new Set<KpiKey>(["spend", "impressions", "clicks", "ctr", "cpc"]);
const colsFor = (rows: MetaRow[]) => ALL_COLS.filter((c) => CORE.has(c) || rows.some((r) => r[c] != null));

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
  return [...(followFirst ? ["spend", ...results.slice(0, 2), "impressions", "clicks", "ctr", "cpc", ...results.slice(2)] : ["spend", "impressions", "clicks", "ctr", "cpc", ...results])] as KpiKey[];
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
        <button type="button" onClick={() => click(k, "value")} className="inline-flex items-center gap-0.5 hover:text-ink">{label}{icon("value")}</button>
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
  const good = ch == null ? null : LOWER_BETTER[k] ? ch < 0 : ch > 0;
  const prevText = compare && r.prev ? fmt(k, r.prev[k]) : "";
  return (
    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink" title={prevText ? `Kỳ trước: ${prevText}` : undefined}>
      <span className="block">{cur}</span>
      {ch != null && Math.abs(ch) >= 0.0005 ? (
        <span className={cn("block text-xs font-medium", good ? "text-ok" : "text-danger")}>{`${ch > 0 ? "+" : ""}${(ch * 100).toFixed(1)}%`}</span>
      ) : ch != null ? <span className="block text-xs text-muted">0%</span> : null}
    </td>
  );
}

function RowTag({ tag }: { tag?: MetaRow["tag"] }) {
  if (tag === "new") return <Badge tone="accent" dot={false} className="ml-1.5">Mới</Badge>;
  if (tag === "gone") return <Badge tone="neutral" dot={false} className="ml-1.5">Không chạy kỳ này</Badge>;
  return null;
}

function RowsTable({
  title, rows, fmt, tx, extra = [], expand, compare = false,
}: {
  title: string;
  rows: MetaRow[];
  fmt: Fmt;
  tx: (typeof L)[Lang];
  extra?: Extra[];
  expand?: (r: MetaRow) => ReactNode;
  compare?: boolean;
}) {
  const { sorted, sort, click } = useSorted(rows, compare);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const cols = colsFor(rows);
  const span = 1 + extra.length + cols.length;
  return (
    <Card className="overflow-hidden">
      <p className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">{title} <span className="font-normal text-muted">({rows.length})</span></p>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-inset text-xs text-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">{tx.name}</th>
                {extra.map((e) => <th key={e.head} className="px-3 py-2 text-left font-medium">{e.head}</th>)}
                {cols.map((c) => <MetricHead key={c} k={c} label={tx[c]} sort={sort} click={click} compare={compare} />)}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <Fragment key={r.id}>
                  <tr className="border-t border-line">
                    <td className="max-w-[22rem] px-4 py-2 text-ink" title={r.name}>
                      {expand ? (
                        <button type="button" onClick={() => toggle(r.id)} aria-expanded={open.has(r.id)} className="inline-flex max-w-full items-center gap-1 text-left hover:text-accent">
                          <ChevronRight className={cn("size-4 shrink-0 transition-transform", open.has(r.id) && "rotate-90")} />
                          <span className="truncate">{r.name}</span>
                          <RowTag tag={r.tag} />
                        </button>
                      ) : <span className="flex min-w-0 items-center"><span className="truncate">{r.name}</span><RowTag tag={r.tag} /></span>}
                    </td>
                    {extra.map((e) => (
                      <td key={e.head} className={cn("max-w-[18rem] truncate px-3 py-2", e.muted ? "text-muted" : "text-ink")}>{e.cell(r)}</td>
                    ))}
                    {cols.map((c) => <MetricCell key={c} r={r} k={c} fmt={fmt} compare={compare} />)}
                  </tr>
                  {expand && open.has(r.id) ? (
                    <tr className="bg-inset/50"><td colSpan={span} className="px-10 py-3">{expand(r)}</td></tr>
                  ) : null}
                </Fragment>
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

function AdsTable({ rows, fmt, tx, compare = false }: { rows: MetaRow[]; fmt: Fmt; tx: (typeof L)[Lang]; compare?: boolean }) {
  const cols = colsFor(rows);
  const { sorted, sort, click } = useSorted(rows, compare);
  return (
    <Card className="overflow-hidden">
      <p className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">Quảng cáo <span className="font-normal text-muted">({rows.length})</span></p>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-inset text-xs text-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Mẫu</th>
                <th className="px-3 py-2 text-left font-medium">Quảng cáo</th>
                <th className="px-3 py-2 text-left font-medium">Nội dung</th>
                <th className="px-3 py-2 text-left font-medium">Nút</th>
                {cols.map((c) => <MetricHead key={c} k={c} label={tx[c]} sort={sort} click={click} compare={compare} />)}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const c = creativeOf(r.config);
                return (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="px-4 py-2">
                      {c.thumb ? (
                        <img src={c.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-16 rounded-md border border-line object-cover" />
                      ) : <div className="size-16 rounded-md bg-inset" />}
                    </td>
                    <td className="min-w-[12rem] max-w-[16rem] px-3 py-2">
                      <p className="flex min-w-0 items-center font-medium text-ink" title={r.name}><span className="truncate">{r.name}</span><RowTag tag={r.tag} /></p>
                      <p className="truncate text-xs text-muted" title={r.adset_name || ""}>{r.adset_name || ""}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <StatusDot s={r.effective_status || r.status} />
                        {c.post_url ? <a href={c.post_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs font-medium text-accent hover:underline">Bài viết <ExternalLink className="size-3" /></a> : null}
                        {c.preview_url ? <a href={c.preview_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs font-medium text-accent hover:underline">Xem trước <ExternalLink className="size-3" /></a> : null}
                      </div>
                    </td>
                    <td className="min-w-[16rem] max-w-[26rem] px-3 py-2">
                      {c.title ? <p className="line-clamp-1 font-medium text-ink" title={c.title}>{c.title}</p> : null}
                      {c.body ? <p className="line-clamp-3 whitespace-pre-line text-muted" title={c.body}>{c.body}</p> : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink">{c.cta || ""}</td>
                    {cols.map((k) => <MetricCell key={k} r={r} k={k} fmt={fmt} compare={compare} />)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-6 text-sm text-muted">{tx.none}</p>
      )}
    </Card>
  );
}
