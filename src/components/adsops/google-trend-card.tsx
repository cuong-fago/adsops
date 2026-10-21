import { useEffect, useState } from "react";
import { readGoogleTrendFn } from "@/lib/adsops/connect.functions";
import type { TrendMonth, TrendRead } from "@/lib/adsops/google-trend.types";
import { LOW_CLICKS, LOW_CONV } from "@/lib/adsops/google-trend.types";
import { Card } from "@/components/adsops/ui";
import { cn } from "@/lib/cn";
import { GoogleTrendTree } from "@/components/adsops/google-trend-tree";

type K = "cpc" | "cpa" | "cvr";
const ROWS: Array<{ k: K; label: string; hint: string; upBad: boolean }> = [
  { k: "cpc", label: "CPC trung bình", hint: "Chi phí ÷ Click trong tháng.", upBad: true },
  { k: "cpa", label: "Giá/chuyển đổi", hint: "Chi phí ÷ Chuyển đổi (cột Chuyển đổi của Google Ads).", upBad: true },
  { k: "cvr", label: "Tỷ lệ chuyển đổi", hint: "Chuyển đổi ÷ Click.", upBad: false },
];
const dong = (v: number) => `${Math.round(v).toLocaleString("vi-VN")}đ`;
const fmt = (k: K, v: number | null) => (v == null ? "-" : k === "cvr" ? `${(v * 100).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%` : dong(v));
const n0 = (v: number | null) => (v == null ? "-" : Math.round(v).toLocaleString("vi-VN"));
const mLabel = (m: TrendMonth) => `T${Number(m.month.slice(5))}/${m.month.slice(2, 4)}`;

function Spark({ values, upBad }: { values: (number | null)[]; upBad: boolean }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (pts.length < 2) return <span className="text-xs text-subtle">-</span>;
  const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  const W = 64, H = 20, n = values.length - 1 || 1;
  const xy = pts.map((p) => `${(p.i / n) * W},${hi === lo ? H / 2 : H - ((p.v - lo) / (hi - lo)) * (H - 4) - 2}`);
  const last = pts[pts.length - 1].v, first = pts[0].v;
  const bad = upBad ? last > first : last < first;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <polyline points={xy.join(" ")} fill="none" strokeWidth="2" className={last === first ? "stroke-subtle" : bad ? "stroke-danger" : "stroke-ok"} />
    </svg>
  );
}

function Change({ a, b, upBad, quiet }: { a: number | null; b: number | null; upBad: boolean; quiet: boolean }) {
  if (a == null || b == null || a === 0) return null;
  const d = (b - a) / a;
  const bad = upBad ? d > 0 : d < 0;
  return <span className={cn("ml-1 text-xs font-medium", quiet || Math.abs(d) < 0.005 ? "text-muted" : bad ? "text-danger" : "text-ok")}>{d >= 0 ? "+" : ""}{(d * 100).toFixed(1)}%</span>;
}

/** Staff-only "Xu hướng 3 tháng" for a Google account. */
export function GoogleTrendCard({ clientId }: { clientId: string }) {
  const [d, setD] = useState<TrendRead | null>(null);
  const [err, setErr] = useState("");
  const [partial, setPartial] = useState(false);
  useEffect(() => {
    let live = true;
    setD(null); setErr("");
    readGoogleTrendFn({ data: { clientId } }).then((r) => { if (live) setD(r); }).catch((e: unknown) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [clientId]);
  if (err) return <Card className="p-4"><p className="text-sm font-semibold">Xu hướng 3 tháng</p><p className="text-sm text-danger">{err}</p></Card>;
  if (!d) return <Card className="p-4"><p className="text-sm font-semibold">Xu hướng 3 tháng</p><p className="text-sm text-muted">Đang tải…</p></Card>;
  const cols: TrendMonth[] = partial && d.current ? [...d.months, d.current] : d.months;
  const th = "px-3 py-1.5 text-right font-medium whitespace-nowrap";
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-ink" title="Toàn tài khoản (cộng mọi loại chiến dịch; xem bảng Theo loại chiến dịch để so sánh cùng loại). 3 tháng dương lịch đã trọn gần nhất. Dữ liệu Google Ads (chỉ đọc), làm mới mỗi 6 giờ. Chỉ nhân sự thấy.">Xu hướng 3 tháng</p>
        <span className="rounded bg-accent-soft px-1.5 text-[11px] font-semibold text-accent">Nội bộ</span>
        {d.current ? (
          <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted" title="Thêm tháng hiện tại (chưa trọn tháng). CPC / giá/chuyển đổi / tỷ lệ là tỷ lệ nên so được; click, chuyển đổi, chi phí hiện thêm mức trung bình/ngày.">
            <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} /> Gồm tháng này (chưa trọn tháng)
          </label>
        ) : null}
      </div>
      {d.error ? <p className="mt-1 text-sm text-danger">{d.error}</p> : null}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Chỉ số</th>
              {cols.map((m) => (
                <th key={m.month} className={th}>
                  {mLabel(m)}
                  {m.partial ? <span className="block text-[10px] font-normal text-warn">chưa trọn tháng ({m.days} ngày)</span> : null}
                  {m.low_data && m.clicks != null ? <span className="block text-[10px] font-normal text-subtle" title={`Dưới ${LOW_CONV} chuyển đổi hoặc dưới ${LOW_CLICKS} click: không tô màu, không chẩn đoán.`}>ít dữ liệu</span> : null}
                </th>
              ))}
              <th className={th}>Xu hướng</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.k} className="border-t border-line">
                <td className="cursor-help px-3 py-1.5 text-ink" title={r.hint}>{r.label}</td>
                {cols.map((m, i) => (
                  <td key={m.month} className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                    {fmt(r.k, m[r.k])}
                    {i > 0 ? <Change a={cols[i - 1][r.k]} b={m[r.k]} upBad={r.upBad} quiet={m.low_data || cols[i - 1].low_data} /> : null}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right"><Spark values={cols.map((m) => m[r.k])} upBad={r.upBad} /></td>
              </tr>
            ))}
            {([["clicks", "Click"], ["conversions", "Chuyển đổi"], ["spend", "Chi phí"]] as const).map(([k, label]) => (
              <tr key={k} className="border-t border-line text-xs text-muted">
                <td className="px-3 py-1">{label}</td>
                {cols.map((m) => (
                  <td key={m.month} className="whitespace-nowrap px-3 py-1 text-right tabular-nums">
                    {k === "spend" ? (m.spend == null ? "-" : dong(m.spend)) : k === "conversions" && m.conversions != null ? m.conversions.toLocaleString("vi-VN", { maximumFractionDigits: 1 }) : n0(m[k])}
                    {m[k] != null && m.days > 0 ? <span className="block text-[10px] text-subtle">{k === "spend" ? dong(m[k]! / m.days) : (m[k]! / m.days).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}/ngày</span> : null}
                  </td>
                ))}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.diagnoses.length ? (
        <ul className="mt-3 flex flex-col gap-2">
          {d.diagnoses.map((x) => (
            <li key={x.kind} className="rounded-lg border border-warn/40 bg-warn-bg/40 px-3 py-2 text-sm">
              <p className="font-semibold text-ink">{x.title}</p>
              <p className="text-ink">{x.detail}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted">Không có chẩn đoán tự động{d.months.some((m) => m.low_data) ? " (có tháng ít dữ liệu nên không đánh giá)" : ""}.</p>
      )}
      <GoogleTrendTree clientId={clientId} partial={partial && !!d.current} />
    </Card>
  );
}
