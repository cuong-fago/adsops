import { Fragment, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, ChevronRight } from "lucide-react";
import { PacingCard } from "@/components/adsops/budget-pacing";
import { BusinessCard } from "@/components/adsops/business-outcomes";
import { readTikTokViewFn, type TTMetrics, type TTNode, type TTView } from "@/lib/adsops/tiktok-ads.functions";
import { ttStatusVi } from "@/lib/adsops/tiktok-structure";
import { fmtDay, fmtMoney, fmtNum, fmtPct, fmtRange } from "@/lib/adsops/client-overview";
import { cn } from "@/lib/cn";
import { Badge, Card, EmptyState, ErrorState, TableSkeleton } from "@/components/adsops/ui";

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}

type K = keyof TTMetrics;
const PRESETS = [{ n: 1, label: "Hôm nay" }, { n: 7, label: "7 ngày" }, { n: 14, label: "14 ngày" }, { n: 30, label: "30 ngày" }, { n: 90, label: "90 ngày" }];
const KPIS: K[] = ["spend", "impressions", "reach", "frequency", "clicks", "ctr", "cpc", "cpm", "conversions", "cpa", "leads", "cpl", "video_play_actions", "video_watched_2s", "video_watched_6s", "video_views_p100"];
const COLS: K[] = ["spend", "impressions", "reach", "clicks", "ctr", "cpc", "cpm", "conversions", "cpa", "leads", "video_play_actions", "video_watched_2s", "video_watched_6s", "video_views_p100"];
const LABEL: Record<K, string> = {
  spend: "Chi tiêu", impressions: "Hiển thị", reach: "Phạm vi tiếp cận", frequency: "Tần suất", clicks: "Click", ctr: "CTR", cpc: "CPC", cpm: "CPM",
  conversions: "Chuyển đổi", cpa: "Chi phí / chuyển đổi", leads: "Khách hàng tiềm năng", cpl: "Chi phí / KHTN",
  video_play_actions: "Lượt xem video", video_watched_2s: "Xem ≥ 2 giây", video_watched_6s: "Xem ≥ 6 giây", video_views_p100: "Xem hết 100%",
};
const SHORT: Partial<Record<K, string>> = { reach: "Tiếp cận", cpa: "Chi phí/CĐ", leads: "KHTN", video_play_actions: "Xem video", video_watched_2s: "Xem 2s", video_watched_6s: "Xem 6s", video_views_p100: "Xem 100%" };
const HINT: Record<K, string> = {
  spend: "Chi phí quảng cáo TikTok trong khoảng ngày (tiền tệ của tài khoản).",
  impressions: "Số lần quảng cáo hiển thị.",
  reach: "Số người khác nhau đã thấy quảng cáo trong cả khoảng ngày (TikTok tính cho cả khoảng, không cộng theo ngày).",
  frequency: "Hiển thị ÷ Phạm vi tiếp cận.",
  clicks: "Số lượt click (đích đến).", ctr: "Click ÷ Hiển thị.", cpc: "Chi tiêu ÷ Click.", cpm: "Chi phí cho 1.000 lượt hiển thị.",
  conversions: "Chuyển đổi theo mục tiêu tối ưu của nhóm quảng cáo (TikTok “Conversions”). Tính là “lead” trong tổng đa kênh.",
  cpa: "Chi tiêu ÷ Chuyển đổi. Trống khi chưa có chuyển đổi.",
  leads: "Số biểu mẫu tức thì được gửi (Instant Form). Trống khi TikTok không trả về.",
  cpl: "Chi tiêu ÷ Khách hàng tiềm năng.",
  video_play_actions: "Số lần video bắt đầu phát.", video_watched_2s: "Số lần xem video ít nhất 2 giây.", video_watched_6s: "Số lần xem video ít nhất 6 giây.", video_views_p100: "Số lần xem hết video.",
};
const MONEY = new Set<K>(["spend", "cpc", "cpm", "cpa", "cpl"]);
const LOWER = new Set<K>(["cpc", "cpm", "cpa", "cpl"]);

function delta(c: number | null | undefined, p: number | null | undefined, k: K): { text: string; good: boolean } | null {
  if (c == null || p == null || p === 0) return null;
  const d = (c - p) / p;
  return { text: `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}%`, good: LOWER.has(k) ? d < 0 : d >= 0 };
}
type StatusPick = "all" | "active" | "paused" | "other";
const isActive = (s: string | null) => !!s && /(ENABLE|DELIVERY_OK|ACTIVE)$/i.test(s) && !/NOT_DELIVER/i.test(s);
const isPaused = (s: string | null) => !!s && /(DISABLE|PAUSE)/i.test(s);
const passes = (s: string | null, f: StatusPick) => f === "all" || (f === "active" ? isActive(s) : f === "paused" ? isPaused(s) : !isActive(s) && !isPaused(s));

/** TikTok Ads account view (read-only). Missing values show "-", never 0. */
export function TikTokAnalyticsView({ clientId, allowCompare }: { clientId: string; allowCompare: boolean }) {
  const [days, setDays] = useState(30);
  const [compare, setCompare] = useState(false);
  const [status, setStatus] = useState<StatusPick>("all");
  const [mode, setModeState] = useState<"perf" | "settings">("perf");
  useEffect(() => {
    try { if (localStorage.getItem("adsops.tt.tableMode") === "settings") setModeState("settings"); } catch { /* private mode */ }
  }, []);
  const setMode = (m: "perf" | "settings") => {
    setModeState(m);
    try { localStorage.setItem("adsops.tt.tableMode", m); } catch { /* ignore */ }
  };
  const perf = mode === "perf";
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<string | null>(null);
  const [data, setData] = useState<TTView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const range = useMemo(() => ({ start: daysAgo(days - 1), end: daysAgo(0) }), [days]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    readTikTokViewFn({ data: { clientId, ...range, compare: allowCompare && compare } })
      .then((r) => { if (live) setData(r); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [clientId, range, nonce, allowCompare, compare]);

  const cur = data?.currency || "VND";
  const fmt = (k: K, v: number | null | undefined) =>
    v == null ? "" : MONEY.has(k) ? fmtMoney("vi", v, cur) : k === "ctr" ? fmtPct("vi", v)
      : k === "frequency" ? v.toLocaleString("vi-VN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : fmtNum("vi", v);
  const showPrev = Boolean(allowCompare && compare && data?.prev_totals);
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chart = (data?.daily || []).map((d) => ({ d: fmtDay(d.date).slice(0, 5), "Chi tiêu": d.spend, "Hiển thị": d.impressions }));
  const hasSpend = (data?.daily || []).some((d) => (d.spend ?? 0) > 0);
  const dash = <span className="text-muted">-</span>;
  const SET_COLS: Array<{ key: string; label: string; hint: string; cell: (n: TTNode, depth: number) => string | null }> = [
    { key: "objective", label: "Mục tiêu", hint: "Mục tiêu chiến dịch.", cell: (n, d) => (d === 0 ? n.info.objective : null) },
    { key: "budget", label: "Ngân sách", hint: "Ngân sách chiến dịch / nhóm quảng cáo.", cell: (n, d) => (d < 2 ? n.info.budget : null) },
    { key: "bid", label: "Giá thầu", hint: "Chiến lược giá thầu của nhóm quảng cáo.", cell: (n, d) => (d === 1 ? n.info.bid : null) },
    { key: "optimize", label: "Tối ưu cho", hint: "Mục tiêu tối ưu của nhóm quảng cáo.", cell: (n, d) => (d === 1 ? n.info.optimize : null) },
    { key: "placement", label: "Vị trí", hint: "Vị trí đặt quảng cáo.", cell: (n, d) => (d === 1 ? n.info.placement : null) },
    { key: "schedule", label: "Lịch chạy", hint: "Ngày bắt đầu / kết thúc.", cell: (n, d) => (d === 1 ? n.info.schedule : null) },
    { key: "location", label: "Khu vực", hint: "Khu vực nhắm mục tiêu.", cell: (n, d) => (d === 1 ? n.info.location : null) },
    { key: "format", label: "Định dạng", hint: "Định dạng quảng cáo.", cell: (n, d) => (d === 2 ? n.info.format : null) },
    { key: "cta", label: "Kêu gọi hành động", hint: "Nút CTA của quảng cáo.", cell: (n, d) => (d === 2 ? n.info.cta : null) },
  ];

  const Row = ({ n, depth, kids, label }: { n: TTNode; depth: number; kids?: number; label: string }) => {
    const id = `${depth}:${n.id}`;
    const isOpen = detail === id;
    return (
      <>
        <tr className={cn("cursor-pointer border-t border-line hover:bg-inset/50", isOpen && "bg-accent-soft/40")} onClick={() => setDetail(isOpen ? null : id)} title="Bấm để xem chi tiết">
          <td className={cn("sticky left-0 z-10 w-[300px] min-w-[300px] max-w-[300px] py-1.5 pr-2 shadow-[inset_-1px_0_0_var(--color-line)]", isOpen ? "bg-accent-soft" : "bg-paper")} style={{ paddingLeft: 8 + depth * 18 }}>
            <div className="flex items-start gap-2">
              {kids ? (
                <button type="button" onClick={(ev) => { ev.stopPropagation(); toggle(id); }} className="mt-0.5 text-muted hover:text-ink" aria-label="Mở / đóng">
                  <ChevronRight className={cn("size-4 transition-transform", open.has(id) && "rotate-90")} />
                </button>
              ) : <span className="inline-block w-4" />}
              {depth === 2 ? <Thumb clientId={clientId} adId={n.id} has={n.info.has_thumb} /> : null}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink" title={n.name || n.id}>{n.name || n.id || "—"}</p>
                <p className="text-xs text-muted">{label}{n.status ? ` · ${ttStatusVi(n.status)}` : ""}{kids ? ` · ${kids}` : ""}</p>
                {depth === 2 && n.info.text ? <p className="truncate text-xs text-ink" title={n.info.text}>{n.info.text}</p> : null}
              </div>
            </div>
          </td>
          {!perf ? SET_COLS.map((c) => <td key={c.key} className="px-2 py-1.5 align-top text-xs">{c.cell(n, depth) || (depth === 0 && c.key === "objective") ? c.cell(n, depth) || dash : ""}</td>) : null}
          {perf && COLS.map((k) => {
            const dl = showPrev && n.prev ? delta(n.m[k], n.prev[k], k) : null;
            return (
              <td key={k} className={cn("whitespace-nowrap px-2 py-1.5 text-right tabular-nums", n.m[k] == null && "text-muted")}>
                {n.m[k] == null ? "-" : fmt(k, n.m[k])}
                {dl ? <div className={cn("text-xs", dl.good ? "text-ok" : "text-danger")}>{dl.text}</div> : null}
              </td>
            );
          })}
        </tr>
        {isOpen ? (
          <tr className="border-t border-line bg-inset">
            <td colSpan={perf ? COLS.length + 1 : SET_COLS.length + 1} className="p-0">
              <div className="sticky left-0 max-w-[min(100vw-4rem,1100px)] px-6 py-3">
                <DetailPanel isAd={depth === 2} n={n} clientId={clientId} managerUrl={data?.manager_url || null} />
              </div>
            </td>
          </tr>
        ) : null}
      </>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="danger" dot={false}>TikTok Ads</Badge>
        <div className="flex gap-1 rounded-md border border-line bg-paper p-1">
          {PRESETS.map((p) => (
            <button key={p.n} type="button" aria-pressed={days === p.n} onClick={() => setDays(p.n)}
              className={cn("h-7 rounded px-2.5 text-sm font-medium", days === p.n ? "bg-accent-soft text-accent" : "text-muted hover:text-ink")}>
              {p.label}
            </button>
          ))}
        </div>
        {allowCompare ? (
          <label className="inline-flex items-center gap-2 text-sm text-ink" title="So với khoảng ngày liền trước, cùng độ dài. Chỉ nhân sự thấy.">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> So với kỳ trước
          </label>
        ) : null}
        <span className="text-sm text-muted">
          {fmtRange(range.start, range.end)}
          {data?.insights_through ? ` · số liệu đến ${fmtDay(data.insights_through)}` : ""}
          {showPrev && data?.prev_start && data.prev_end ? ` · kỳ trước ${fmtRange(data.prev_start, data.prev_end)}` : ""}
        </span>
      </div>

      <PacingCard clientId={clientId} />
      <BusinessCard clientId={clientId} />
      {error ? (
        <ErrorState title="Không tải được số liệu TikTok Ads" message={error} onRetry={() => setNonce((x) => x + 1)} />
      ) : loading && !data ? (
        <Card className="p-4"><TableSkeleton rows={4} cols={6} /></Card>
      ) : !data || (!data.daily.length && !data.campaigns.length) ? (
        <Card><EmptyState icon={BarChart3} title="Chưa có số liệu TikTok Ads" description={data?.error || "Tài khoản chưa có hiển thị trong khoảng ngày này, hoặc chưa kéo số liệu (Kiểm tra lại)."} /></Card>
      ) : (
        <>
          {data.error ? <ErrorState title="Lần kéo gần nhất bị lỗi" message={data.error} /> : null}
          <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8", loading && "opacity-60")}>
            {KPIS.map((k) => {
              const dl = showPrev ? delta(data.totals[k], data.prev_totals![k], k) : null;
              return (
                <Card key={k} className="px-3 py-3">
                  <p className="cursor-help truncate text-xs font-medium text-muted underline decoration-dotted underline-offset-2" title={HINT[k]}>{LABEL[k]}</p>
                  <p className="mt-1 truncate text-lg font-semibold tabular-nums text-ink">{fmt(k, data.totals[k]) || "-"}</p>
                  {showPrev ? (
                    <p className="mt-0.5 truncate text-xs tabular-nums text-muted">
                      {fmt(k, data.prev_totals![k]) || "-"}
                      {dl ? <span className={cn("ml-1 font-medium", dl.good ? "text-ok" : "text-danger")}>{dl.text}</span> : null}
                    </p>
                  ) : null}
                </Card>
              );
            })}
          </div>
          {chart.length > 1 ? (
            <Card className="p-4">
              <p className="mb-2 text-sm font-semibold text-ink">{hasSpend ? "Chi tiêu theo ngày" : "Hiển thị theo ngày"}</p>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="d" fontSize={11} />
                    <YAxis fontSize={11} width={60} />
                    <Tooltip />
                    <Bar dataKey={hasSpend ? "Chi tiêu" : "Hiển thị"} fill="#0f766e" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ) : null}
          <Card className="overflow-x-auto p-0">
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <p className="text-sm font-semibold text-ink">Chiến dịch → Nhóm quảng cáo → Quảng cáo</p>
              <div className="ml-auto flex gap-1 rounded-md border border-line bg-paper p-1 text-sm" role="group" aria-label="Chế độ bảng">
                {([["perf", "Hiệu suất"], ["settings", "Cài đặt"]] as const).map(([m, l]) => (
                  <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                    className={cn("h-7 rounded px-3 font-medium", mode === m ? "bg-accent text-white" : "text-muted hover:text-ink")}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="flex gap-1 rounded-md border border-line bg-paper p-1 text-sm">
                {(["all", "active", "paused", "other"] as StatusPick[]).map((s) => (
                  <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}
                    className={cn("h-7 rounded px-2.5 font-medium", status === s ? "bg-accent-soft text-accent" : "text-muted hover:text-ink")}>
                    {{ all: "Tất cả", active: "Đang chạy", paused: "Tạm dừng", other: "Khác" }[s]}
                  </button>
                ))}
              </div>
            </div>
            <table className={cn("w-full text-sm", perf ? "min-w-[1500px]" : "min-w-[1300px]")}>
              <thead className="text-xs text-muted">
                <tr>
                  <th className="sticky left-0 z-10 w-[300px] min-w-[300px] bg-paper px-2 py-1 text-left">Tên</th>
                  {!perf
                    ? SET_COLS.map((c) => <th key={c.key} className="cursor-help whitespace-nowrap px-2 py-1 text-left" title={c.hint}>{c.label}</th>)
                    : COLS.map((k) => <th key={k} className="min-w-[84px] cursor-help whitespace-nowrap px-2 py-1 text-right" title={`${LABEL[k]}: ${HINT[k]}`}>{SHORT[k] || LABEL[k]}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.campaigns.filter((c) => passes(c.status, status)).map((c) => (
                  <Fragment key={c.id || "_"}>
                    <Row n={c} depth={0} kids={c.ad_groups.length} label="Chiến dịch" />
                    {open.has(`0:${c.id}`) ? c.ad_groups.filter((g) => passes(g.status, status)).map((g) => (
                      <Fragment key={g.id || "_g"}>
                        <Row n={g} depth={1} kids={g.ads.length} label="Nhóm quảng cáo" />
                        {open.has(`1:${g.id}`) ? g.ads.filter((a) => passes(a.status, status)).map((a) => <Row key={a.id} n={a} depth={2} label="Quảng cáo" />) : null}
                      </Fragment>
                    )) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
            <p className="px-4 py-2 text-xs text-muted">Bấm vào một dòng để xem chi tiết. Ô “-” = TikTok chưa trả số liệu (không phải 0).</p>
          </Card>
        </>
      )}
    </div>
  );
}

function Thumb({ clientId, adId, has, big = false }: { clientId: string; adId: string; has: boolean; big?: boolean }) {
  const [failed, setFailed] = useState(false);
  const size = big ? "size-40" : "size-12";
  if (!has || failed) {
    return <div className={cn(size, "flex shrink-0 items-center justify-center rounded border border-dashed border-line bg-inset p-1 text-center text-[10px] leading-tight text-muted")}>Không có ảnh</div>;
  }
  return (
    <img src={`/api/tiktok-ad-image?client=${encodeURIComponent(clientId)}&ad=${encodeURIComponent(adId)}`} alt="" loading="lazy" onError={() => setFailed(true)}
      className={cn(size, "shrink-0 rounded border border-line bg-inset object-cover")} />
  );
}

function DetailPanel({ isAd, n, clientId, managerUrl }: { isAd: boolean; n: TTNode; clientId: string; managerUrl: string | null }) {
  const lines = n.info.details || [];
  return (
    <div className="flex flex-col gap-3 text-sm md:flex-row">
      {isAd ? <Thumb clientId={clientId} adId={n.id} has={n.info.has_thumb} big /> : null}
      <div className="min-w-0 flex-1">
        <p className="mb-2 font-semibold text-ink">{n.name || n.id}<span className="ml-2 text-xs font-normal text-muted">{n.id}</span></p>
        {lines.length ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 md:grid-cols-2">
            {lines.map((d, i) => (
              <div key={i} className={cn(d.long && "md:col-span-2")}>
                <dt className="text-xs text-muted">{d.label}</dt>
                <dd className="whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{/^https?:\/\//.test(d.value) ? <a href={d.value} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{d.value}</a> : d.value}</dd>
              </div>
            ))}
          </dl>
        ) : <p className="text-muted">-</p>}
        {managerUrl ? <a href={managerUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs text-accent hover:underline">Mở trong TikTok Ads Manager</a> : null}
      </div>
    </div>
  );
}
