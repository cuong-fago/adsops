import type { ReactNode } from "react";
import { moneyPlain, num } from "@/lib/adsops/format";
import { QS_COMPONENT_VI, WASTE_MIN_CLICKS, qsTone, type QsRead, type WasteRead } from "@/lib/adsops/google-qs.types";
import { cn } from "@/lib/cn";
import { cardClass } from "@/components/adsops/ui";

const dong = (v: number) => `${moneyPlain(v)}đ`;
const pct1 = (v: number) => `${(v * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
const dmy = (s: string) => s.split("-").reverse().join("/");

export const QS_TONE_CLASS = { danger: "text-danger font-semibold", warn: "text-warn font-semibold", ok: "text-ok font-semibold" } as const;

function QsBadge({ qs }: { qs: number }) {
  const t = qsTone(qs);
  return (
    <span className={cn("inline-flex min-w-7 justify-center rounded-sm px-1.5 py-0.5 text-xs font-semibold tabular-nums",
      t === "danger" ? "bg-danger-bg text-danger" : t === "warn" ? "bg-warn-bg text-warn" : "bg-ok-bg text-ok")}>{qs}</span>
  );
}

function Head({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="font-display text-lg font-semibold tracking-tight" title={hint}>{title}</h3>
      {right}
    </div>
  );
}

/** Overview: impression-weighted QS + "Từ khoá QS thấp tốn tiền". */
export function QsOverviewCard({ data, loading }: { data: QsRead | null; loading: boolean }) {
  return (
    <section className={cn(cardClass, "p-4")}>
      <Head
        title="Quality Score"
        hint="QS là ảnh chụp hiện tại từ Google (không có lịch sử); trung bình có trọng số theo lượt hiển thị của từ khoá trong khoảng ngày."
        right={data?.snapshot_date ? <span className="text-xs text-subtle">Ảnh chụp {dmy(data.snapshot_date)}</span> : null}
      />
      {loading && !data ? <p className="mt-3 text-sm text-muted">Đang tải…</p> : !data?.snapshot_date ? (
        <p className="mt-3 text-sm text-muted">Chưa có ảnh chụp Quality Score cho tài khoản này.</p>
      ) : (
        <>
          <div className="mt-2 flex items-baseline gap-3">
            <span className={cn("text-kpi-sm tabular-nums", data.weighted_qs != null && QS_TONE_CLASS[qsTone(Math.round(data.weighted_qs))!])}>
              {data.weighted_qs != null ? data.weighted_qs.toLocaleString("vi-VN", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : "—"}
            </span>
            <span className="text-xs text-muted">
              QS trung bình theo hiển thị
              {data.weighted_basis ? ` · phủ ${pct1(data.weighted_basis.total_impressions ? data.weighted_basis.impressions / data.weighted_basis.total_impressions : 0)} hiển thị từ khoá` : ""}
              {data.partial ? " · dữ liệu từ khoá chưa đủ khoảng" : ""}
            </span>
          </div>
          <p className="mt-3 text-sm font-semibold text-ink">Từ khoá QS thấp tốn tiền <span className="font-normal text-muted">(QS ≤ 4, theo chi tiêu)</span></p>
          {data.low.length ? (
            <ul className="mt-1 divide-y divide-line">
              {data.low.map((r) => (
                <li key={r.id} className="grid grid-cols-[auto_1fr_auto] items-start gap-x-3 py-2 text-sm">
                  <QsBadge qs={r.qs} />
                  <span className="min-w-0">
                    <span className="block font-medium [overflow-wrap:anywhere]">{r.keyword}{r.match_type ? <span className="ml-1 text-xs font-normal text-subtle">{r.match_type}</span> : null}</span>
                    <span className="block truncate text-xs text-muted" title={`${r.campaign_name || ""} › ${r.ad_group_name || ""}`}>{r.campaign_name} › {r.ad_group_name}</span>
                    <span className="block text-xs text-subtle">
                      Liên quan QC: {r.creative ? QS_COMPONENT_VI[r.creative] : "—"} · Trang đích: {r.post_click ? QS_COMPONENT_VI[r.post_click] : "—"} · CTR dự kiến: {r.ctr ? QS_COMPONENT_VI[r.ctr] : "—"}
                    </span>
                  </span>
                  <span className="text-right tabular-nums">
                    <span className="block font-medium">{dong(r.cost)}</span>
                    <span className="block text-xs text-muted">{num(r.clicks)} click · {num(r.conversions, 0)} conv</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-1 text-sm text-muted">Không có từ khoá QS ≤ 4 có chi tiêu trong khoảng này.</p>}
        </>
      )}
    </section>
  );
}

/** Wasted search-term spend (0 conv and 0 all conv). `compact` = overview card (top 8). */
export function WasteCard({ data, loading, compact = false }: { data: WasteRead | null; loading: boolean; compact?: boolean }) {
  const cur = data?.cur;
  const prev = data?.prev;
  const share = cur && cur.total_cost > 0 ? cur.waste_cost / cur.total_cost : null;
  const prevShare = prev && prev.total_cost > 0 ? prev.waste_cost / prev.total_cost : null;
  const delta = cur && prev && prev.waste_cost > 0 ? cur.waste_cost / prev.waste_cost - 1 : null;
  const top = cur ? (compact ? cur.top.slice(0, 8) : cur.top) : [];
  return (
    <section className={cn(cardClass, "p-4")}>
      <Head
        title="Chi tiêu search term lãng phí"
        hint="Chi tiêu cho cụm từ tìm kiếm có 0 chuyển đổi và 0 all conversions trong khoảng ngày (Google tính cho cả khoảng). % trên tổng chi tiêu search term."
        right={data ? <span className="text-xs text-subtle">{dmy(data.start)}–{dmy(data.end)}{data.clamped_start ? " · Google chỉ giữ ~90 ngày cụm từ" : ""}</span> : null}
      />
      {loading && !data ? <p className="mt-3 text-sm text-muted">Đang tải…</p> : !cur ? (
        <p className="mt-3 text-sm text-muted">{data?.error ? "Chưa lấy được cụm từ tìm kiếm từ Google Ads." : "Không có dữ liệu cụm từ tìm kiếm trong khoảng này."}</p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-kpi-sm tabular-nums">{dong(cur.waste_cost)}</span>
            <span className="text-sm text-muted tabular-nums">{share != null ? `${pct1(share)} chi tiêu search term` : ""} · {num(cur.waste_terms)} cụm từ</span>
            {prev ? (
              <span className={cn("text-xs tabular-nums", delta == null ? "text-subtle" : delta > 0.005 ? "text-danger" : delta < -0.005 ? "text-ok" : "text-subtle")}>
                Kỳ trước {dong(prev.waste_cost)}{prevShare != null ? ` (${pct1(prevShare)})` : ""}{delta != null ? ` · ${delta > 0 ? "▲" : "▼"} ${Math.round(Math.abs(delta) * 100)}%` : ""}
              </span>
            ) : null}
          </div>
          <p className="mt-3 text-sm font-semibold text-ink">Cụm từ lãng phí nhiều nhất <span className="font-normal text-muted">(≥{WASTE_MIN_CLICKS} click, 0 chuyển đổi)</span></p>
          {top.length ? (
            <div className="mt-1 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-1.5 pr-3 text-left font-medium">Cụm từ</th>
                    {!compact ? <th className="py-1.5 pr-3 text-left font-medium">Chiến dịch › Nhóm</th> : null}
                    <th className="py-1.5 pr-3 text-right font-medium">Click</th>
                    <th className="py-1.5 text-right font-medium">Chi tiêu</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((t, i) => (
                    <tr key={`${t.term}|${t.campaign_name}|${t.ad_group_name}|${i}`} className="border-t border-line/60 align-top">
                      <td className="py-1.5 pr-3">
                        <span className="font-medium [overflow-wrap:anywhere]">{t.term}</span>
                        {t.excluded ? <span className="ml-1.5 rounded-sm bg-inset px-1.5 text-[11px] font-medium text-muted">Đã loại trừ</span> : (
                          <span className="ml-1.5 rounded-sm bg-warn-bg px-1.5 text-[11px] font-medium text-warn" title="Cân nhắc thêm làm từ khoá phủ định (kiểm tra ý định tìm kiếm trước)">Nên thêm phủ định</span>
                        )}
                        {compact ? <span className="block truncate text-xs text-muted" title={`${t.campaign_name} › ${t.ad_group_name}`}>{t.campaign_name} › {t.ad_group_name}</span> : null}
                      </td>
                      {!compact ? <td className="py-1.5 pr-3 text-xs text-muted [overflow-wrap:anywhere]">{t.campaign_name} › {t.ad_group_name}</td> : null}
                      <td className="py-1.5 pr-3 text-right tabular-nums">{num(t.clicks)}</td>
                      <td className="py-1.5 text-right font-medium tabular-nums">{dong(t.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="mt-1 text-sm text-muted">Không có cụm từ ≥{WASTE_MIN_CLICKS} click mà 0 chuyển đổi.</p>}
        </>
      )}
    </section>
  );
}
