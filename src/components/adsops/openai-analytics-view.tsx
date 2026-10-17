import { Fragment, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, ChevronRight } from "lucide-react";
import { PacingCard } from "@/components/adsops/budget-pacing";
import { BusinessCard } from "@/components/adsops/business-outcomes";
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

  const Row = ({ n, depth, kids, label }: { n: OANode; depth: number; kids?: number; label: string }) => {
    const id = `${depth}:${n.id}`;
    return (
      <tr className="border-t border-line">
        <td className="py-1.5 pr-2" style={{ paddingLeft: 8 + depth * 18 }}>
          <div className="flex items-start gap-1">
            {kids ? (
              <button type="button" onClick={() => toggle(id)} className="mt-0.5 text-muted hover:text-ink" aria-label="Mở / đóng">
                <ChevronRight className={cn("size-4 transition-transform", open.has(id) && "rotate-90")} />
              </button>
            ) : <span className="inline-block w-4" />}
            <div className="min-w-0">
              <p className="truncate font-medium text-ink" title={n.name || n.id}>{n.name || n.id || "—"}</p>
              <p className="text-xs text-muted">{label}{n.status ? ` · ${statusVi(n.status)}` : ""}{kids ? ` · ${kids}` : ""}</p>
              {n.title ? <p className="truncate text-xs text-ink" title={n.body || n.title}>{n.title}</p> : null}
              {n.link ? <a href={n.link} target="_blank" rel="noopener noreferrer" className="block max-w-[360px] truncate text-xs text-accent hover:underline" title={n.link}>{n.link.replace(/^https?:\/\//, "").split("?")[0]}</a> : null}
            </div>
          </div>
        </td>
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
            <table className="w-full min-w-[900px] text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="px-2 py-1 text-left">Tên</th>
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
            <p className="px-4 py-2 text-xs text-muted">Ô trống = OpenAI chưa trả số liệu (không phải 0). Ngày không có hiển thị thì OpenAI không trả dòng nào.</p>
          </Card>
        </>
      )}
    </div>
  );
}
