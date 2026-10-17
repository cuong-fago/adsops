import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, ChevronRight } from "lucide-react";
import { PacingCard } from "@/components/adsops/budget-pacing";
import { BusinessCard } from "@/components/adsops/business-outcomes";
import type { CampFields } from "@/lib/adsops/openai-structure";
import { readOpenAIViewFn, type OAMetrics, type OANode, type OAView } from "@/lib/adsops/openai-ads.functions";
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

type K = keyof OAMetrics;
const PRESETS: Array<{ n: number; label: string }> = [
  { n: 1, label: "Hôm nay" },
  { n: 7, label: "7 ngày" },
  { n: 14, label: "14 ngày" },
  { n: 30, label: "30 ngày" },
  { n: 90, label: "90 ngày" },
];
const KPIS: K[] = ["spend", "impressions", "reach", "frequency", "clicks", "ctr", "cpc", "cpm", "conversions", "cpa", "sales"];
const COLS: K[] = ["spend", "impressions", "reach", "frequency", "clicks", "ctr", "cpc", "cpm", "conversions", "cpa"];
const LABEL: Record<K, string> = {
  spend: "Chi tiêu", impressions: "Hiển thị", clicks: "Click", ctr: "CTR", cpc: "CPC", cpm: "CPM",
  reach: "Phạm vi tiếp cận", frequency: "Tần suất",
  conversions: "Chuyển đổi", cpa: "Chi phí / chuyển đổi", sales: "Doanh số ghi nhận",
};
const HINT: Record<K, string> = {
  spend: "Chi phí quảng cáo ChatGPT Ads trong khoảng ngày (tiền tệ của tài khoản).",
  impressions: "Số lần quảng cáo hiển thị trong ChatGPT.",
  clicks: "Số lượt click vào quảng cáo.",
  reach: "Số người khác nhau đã thấy quảng cáo trong cả khoảng ngày (OpenAI tính cho cả khoảng, không cộng theo ngày).",
  frequency: "Số lần trung bình mỗi người thấy quảng cáo = Hiển thị ÷ Phạm vi tiếp cận.",
  ctr: "Click ÷ Hiển thị.",
  cpc: "Chi tiêu ÷ Click.",
  cpm: "Chi phí cho 1.000 lượt hiển thị.",
  conversions: "Chuyển đổi mục tiêu của chiến dịch (click trong 30 ngày + xem trong 1 ngày, theo ngày tương tác quảng cáo). Tính là “lead” trong tổng đa kênh.",
  cpa: "Chi tiêu ÷ Chuyển đổi. Trống khi chưa có chuyển đổi.",
  sales: "Giá trị đơn hàng (order_created) OpenAI ghi nhận cho quảng cáo, cấp tài khoản. Trống khi OpenAI không trả về.",
};
const MONEY = new Set<K>(["spend", "cpc", "cpm", "cpa", "sales"]);
const PCT = new Set<K>(["ctr"]);
const LOWER = new Set<K>(["cpc", "cpm", "cpa"]);
const STATUS_VI: Record<string, string> = { active: "Đang chạy", paused: "Tạm dừng", archived: "Lưu trữ", deleted: "Đã xoá", pending: "Chờ duyệt", draft: "Nháp" };
const statusVi = (s: string | null) => (s ? STATUS_VI[s] || s : "");

function delta(c: number | null | undefined, p: number | null | undefined, k: K): { text: string; good: boolean } | null {
  if (c == null || p == null || p === 0) return null;
  const d = (c - p) / p;
  return { text: `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}%`, good: LOWER.has(k) ? d < 0 : d >= 0 };
}

type StatusPick = "all" | "active" | "paused" | "other";
const passes = (s: string | null, f: StatusPick) => f === "all" || (f === "active" ? s === "active" : f === "paused" ? s === "paused" : s !== "active" && s !== "paused");

export function OpenAIAnalyticsView({ clientId, allowCompare }: { clientId: string; allowCompare: boolean }) {
  const [days, setDays] = useState(30);
  const [compare, setCompare] = useState(false);
  const [status, setStatus] = useState<StatusPick>("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<string | null>(null);
  const [data, setData] = useState<OAView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const range = useMemo(() => ({ start: daysAgo(days - 1), end: daysAgo(0) }), [days]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    readOpenAIViewFn({ data: { clientId, ...range, compare: allowCompare && compare } })
      .then((r) => { if (live) setData(r); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [clientId, range, nonce, allowCompare, compare]);

  const cur = data?.currency || "VND";
  const fmt = (k: K, v: number | null | undefined) =>
    v == null ? "" : MONEY.has(k) ? fmtMoney("vi", v, cur) : PCT.has(k) ? fmtPct("vi", v)
      : k === "frequency" ? v.toLocaleString("vi-VN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : fmtNum("vi", v);
  const showPrev = Boolean(allowCompare && compare && data?.prev_totals);
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chart = (data?.daily || []).map((d) => ({ d: fmtDay(d.date).slice(0, 5), "Chi tiêu": d.spend, "Hiển thị": d.impressions }));
  const hasSpend = (data?.daily || []).some((d) => (d.spend ?? 0) > 0);

  const levelOf = (depth: number) => (depth === 0 ? "campaign" : depth === 1 ? "ad_group" : "ad");
  const Row = ({ n, depth, kids, label }: { n: OANode; depth: number; kids?: number; label: string }) => {
    const id = `${depth}:${n.id}`;
    const isOpen = detail === id;
    const info = n.info;
    const dash = <span className="text-muted">-</span>;
    return (
      <>
        <tr className={cn("cursor-pointer border-t border-line hover:bg-inset/50", isOpen && "bg-accent-soft/40")} onClick={() => setDetail(isOpen ? null : id)} title="Bấm để xem chi tiết">
          <td className="sticky left-0 z-10 bg-paper py-1.5 pr-2 shadow-[inset_-1px_0_0_var(--color-line)]" style={{ paddingLeft: 8 + depth * 18 }}>
            <div className="flex items-start gap-2">
              {kids ? (
                <button type="button" onClick={(ev) => { ev.stopPropagation(); toggle(id); }} className="mt-0.5 text-muted hover:text-ink" aria-label="Mở / đóng">
                  <ChevronRight className={cn("size-4 transition-transform", open.has(id) && "rotate-90")} />
                </button>
              ) : <span className="inline-block w-4" />}
              {depth === 2 ? <Thumb clientId={clientId} adId={n.id} has managerUrl={data?.manager_url || null} /> : null}
              <div className="min-w-0 max-w-[320px]">
                <p className="truncate font-medium text-ink" title={n.name || n.id}>{n.name || n.id || "—"}</p>
                <p className="text-xs text-muted">{label}{n.status ? ` · ${statusVi(n.status)}` : ""}{info?.review ? ` · ${info.review}` : ""}{kids ? ` · ${kids}` : ""}</p>
                {n.title ? <p className="truncate text-xs text-ink" title={n.title}>{n.title}</p> : null}
                {n.body ? <p className="truncate text-xs text-muted" title={n.body}>{n.body}</p> : null}
                {n.link ? <a href={n.link} onClick={(ev) => ev.stopPropagation()} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-accent hover:underline" title={n.link}>{n.link.replace(/^https?:\/\//, "").split("?")[0]}</a> : null}
              </div>
            </div>
          </td>
          <td className="px-2 py-1.5 text-xs">{depth === 0 ? info?.kind || dash : ""}</td>
          <td className="px-2 py-1.5 text-xs">{depth < 2 ? info?.bid_strategy || dash : ""}</td>
          <td className="min-w-[340px] px-2 py-1.5 align-top text-xs">
            {depth === 1 ? (info?.hints.length ? <ul className="ml-4 list-disc space-y-0.5 whitespace-normal text-ink">{info.hints.map((h, i) => <li key={i}>{h}</li>)}</ul> : dash) : ""}
          </td>
          {CAMP_COLS.map((c) => (
            <td key={c.key} className={cn("px-2 py-1.5 align-top text-xs", c.wide && "min-w-[220px]")}>
              {depth === 0 ? c.cell(info?.camp ?? null) ?? dash : depth === 1 ? <span className="text-muted">Theo chiến dịch</span> : ""}
            </td>
          ))}
          {COLS.map((k) => {
            const dl = showPrev && n.prev ? delta(n.m[k], n.prev[k], k) : null;
            return (
              <td key={k} className={cn("px-2 py-1.5 text-right tabular-nums", !n.delivered && n.m[k] == null && "text-muted")}>
                {/* No delivery in range (OpenAI returns no row): "-" like Ads Manager. */}
                {!n.delivered && n.m[k] == null ? "-" : fmt(k, n.m[k])}
                {dl ? <div className={cn("text-xs", dl.good ? "text-ok" : "text-danger")}>{dl.text}</div> : null}
              </td>
            );
          })}
        </tr>
        {isOpen ? (
          <tr className="border-t border-line bg-inset">
            <td colSpan={COLS.length + 4 + CAMP_COLS.length} className="p-0">
              <div className="sticky left-0 max-w-[min(100vw-4rem,1100px)] px-6 py-3">
                <DetailPanel level={levelOf(depth)} n={n} clientId={clientId} managerUrl={data?.manager_url || null} />
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
        <Badge tone="ok" dot={false}>ChatGPT Ads</Badge>
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
        <ErrorState title="Không tải được số liệu ChatGPT Ads" message={error} onRetry={() => setNonce((x) => x + 1)} />
      ) : loading && !data ? (
        <Card className="p-4"><TableSkeleton rows={4} cols={6} /></Card>
      ) : !data || (!data.daily.length && !data.campaigns.length) ? (
        <Card><EmptyState icon={BarChart3} title="Chưa có số liệu ChatGPT Ads" description={data?.error || "Tài khoản chưa có hiển thị trong khoảng ngày này, hoặc chưa kéo số liệu (Kiểm tra lại)."} /></Card>
      ) : (
        <>
          {data.error ? <ErrorState title="Lần kéo gần nhất bị lỗi" message={data.error} /> : null}
          <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5", loading && "opacity-60")}>
            {KPIS.map((k) => {
              const dl = showPrev ? delta(data.totals[k], data.prev_totals![k], k) : null;
              return (
                <Card key={k} className="px-3 py-3">
                  <p className="cursor-help text-xs font-medium text-muted underline decoration-dotted underline-offset-2" title={HINT[k]}>{LABEL[k]}</p>
                  <p className="mt-1 truncate text-lg font-semibold tabular-nums text-ink">{fmt(k, data.totals[k]) || "\u00a0"}</p>
                  {showPrev ? (
                    <p className="mt-0.5 truncate text-xs tabular-nums text-muted">
                      {fmt(k, data.prev_totals![k]) || "—"}
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
                    <Bar dataKey={hasSpend ? "Chi tiêu" : "Hiển thị"} fill="#10a37f" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ) : null}
          <Card className="overflow-x-auto p-0">
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <p className="text-sm font-semibold text-ink">Chiến dịch → Nhóm quảng cáo → Quảng cáo</p>
              <div className="ml-auto flex gap-1 rounded-md border border-line bg-paper p-1 text-sm">
                {(["all", "active", "paused", "other"] as StatusPick[]).map((s) => (
                  <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}
                    className={cn("h-7 rounded px-2.5 font-medium", status === s ? "bg-accent-soft text-accent" : "text-muted hover:text-ink")}>
                    {{ all: "Tất cả", active: "Đang chạy", paused: "Tạm dừng", other: "Khác" }[s]}
                  </button>
                ))}
              </div>
            </div>
            <table className="w-full min-w-[2200px] text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="sticky left-0 z-10 bg-paper px-2 py-1 text-left">Tên</th>
                  <th className="cursor-help px-2 py-1 text-left" title="Mục tiêu chiến dịch (Ads Manager: Loại).">Loại</th>
                  <th className="cursor-help px-2 py-1 text-left" title="Chiến dịch: kiểu đặt giá thầu; nhóm quảng cáo: chiến lược giá thầu.">Chiến lược giá thầu</th>
                  <th className="cursor-help px-2 py-1 text-left" title="Gợi ý ngữ cảnh của nhóm quảng cáo: các tình huống hội thoại nên hiện quảng cáo.">Gợi ý ngữ cảnh</th>
                  {CAMP_COLS.map((c) => <th key={c.key} className="cursor-help px-2 py-1 text-left" title={c.hint}>{c.label}</th>)}
                  {COLS.map((k) => <th key={k} className="cursor-help px-2 py-1 text-right" title={HINT[k]}>{LABEL[k]}</th>)}
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
            <p className="px-4 py-2 text-xs text-muted">Bấm vào một dòng để xem chi tiết. Ô trống = OpenAI chưa trả số liệu (không phải 0). Ngày không có hiển thị thì OpenAI không trả dòng nào.</p>
          </Card>
        </>
      )}
    </div>
  );
}

const list = (a: string[]) => (a.length ? <ul className="space-y-0.5">{a.map((x, i) => <li key={i}>{x}</li>)}</ul> : null);
/** Campaign-level settings (Ads Manager campaign edit page). Ad groups inherit → "Theo chiến dịch". */
const CAMP_COLS: Array<{ key: string; label: string; hint: string; wide?: boolean; cell: (c: CampFields | null) => ReactNode }> = [
  { key: "billing", label: "Thanh toán", hint: "Sự kiện tính phí của chiến dịch.", cell: (c) => c?.billing || null },
  { key: "loc_in", label: "Vị trí bao gồm", hint: "Khu vực nhắm mục tiêu của chiến dịch.", wide: true, cell: (c) => list(c?.loc_include || []) },
  { key: "loc_ex", label: "Vị trí loại trừ", hint: "Khu vực bị loại trừ.", cell: (c) => list(c?.loc_exclude || []) },
  { key: "platforms", label: "Nền tảng đủ điều kiện", hint: "Nền tảng ChatGPT được phép hiển thị. Không giới hạn = Tất cả nền tảng.", cell: (c) => c?.platforms || null },
  { key: "tracking", label: "Tham số theo dõi", hint: "Tham số gắn vào URL đích (cấu hình trang đích của chiến dịch).", cell: (c) => c?.tracking || null },
  { key: "aud_in", label: "Đối tượng tùy chỉnh bao gồm", hint: "Tệp đối tượng tùy chỉnh được nhắm.", cell: (c) => list(c?.aud_include || []) },
  { key: "aud_ex", label: "Đối tượng tùy chỉnh loại trừ", hint: "Tệp đối tượng tùy chỉnh bị loại trừ.", cell: (c) => list(c?.aud_exclude || []) },
  { key: "budget", label: "Ngân sách", hint: "Giới hạn chi tiêu của chiến dịch.", cell: (c) => c?.budget || null },
  { key: "start", label: "Ngày bắt đầu", hint: "Trống trên OpenAI = bắt đầu ngay khi bật.", cell: (c) => c?.start || null },
  { key: "end", label: "Ngày kết thúc", hint: "Trống trên OpenAI = chạy liên tục.", cell: (c) => c?.end || null },
];

function Thumb({ clientId, adId, has, managerUrl, big = false }: { clientId: string; adId: string; has: boolean; managerUrl: string | null; big?: boolean }) {
  const [failed, setFailed] = useState(false);
  const size = big ? "size-40" : "size-12";
  if (!has || failed) {
    return (
      <div className={cn(size, "flex shrink-0 items-center justify-center rounded border border-dashed border-line bg-inset p-1 text-center text-[10px] leading-tight text-muted")} title="OpenAI chưa cho tải ảnh qua API">
        {big ? (
          <span>OpenAI chưa cho tải ảnh qua API.{managerUrl ? <> <a href={managerUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Mở Ads Manager</a></> : null}</span>
        ) : "Không có ảnh"}
      </div>
    );
  }
  return (
    <img
      src={`/api/openai-ad-image?client=${encodeURIComponent(clientId)}&ad=${encodeURIComponent(adId)}`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn(size, "shrink-0 rounded border border-line bg-inset object-cover")}
    />
  );
}

function DetailPanel({ level, n, clientId, managerUrl }: { level: string; n: OANode; clientId: string; managerUrl: string | null }) {
  const info = n.info;
  const lines = info?.details || [];
  return (
    <div className="flex flex-col gap-3 text-sm md:flex-row">
      {level === "ad" ? <Thumb clientId={clientId} adId={n.id} has managerUrl={managerUrl} big /> : null}
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
        {level === "ad_group" ? (
          <div className="mt-2">
            <p className="text-xs text-muted">Gợi ý ngữ cảnh ({info?.hints.length || 0})</p>
            {info?.hints.length ? <ul className="ml-4 list-disc text-ink">{info.hints.map((h, i) => <li key={i}>{h}</li>)}</ul> : <p className="text-muted">-</p>}
          </div>
        ) : null}
        {managerUrl ? <a href={managerUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs text-accent hover:underline">Mở trong Ads Manager</a> : null}
      </div>
    </div>
  );
}
