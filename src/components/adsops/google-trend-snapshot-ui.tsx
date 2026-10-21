import { useEffect, useMemo, useState } from "react";
import { readTrendSnapshotsFn } from "@/lib/adsops/connect.functions";
import { CHANNEL_LABEL } from "@/lib/adsops/google-trend.types";
import { ALERT_STEP, METRIC_LABEL, VERDICT_BAND, type TrendSnapshot } from "@/lib/adsops/google-trend-snapshot.types";
import { Card } from "@/components/adsops/ui";
import { cn } from "@/lib/cn";

export const TREND_CARD_ID = "google-trend-card";
const mL = (m: string) => `T${Number(m.slice(5))}/${m.slice(2, 4)}`;
const p = (d: number | null) => (d == null ? "-" : `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}%`);
const mom = (a: number | null, b: number | null) => (a == null || b == null || a === 0 ? null : (b - a) / a);
const when = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });

export function trendTip(s: TrendSnapshot): string {
  if (s.verdict === "error") return `Lỗi khi tính (${when(s.computed_at)} giờ VN): ${s.error || "không rõ"}`;
  const lines = [`Cùng loại, chỉ chiến dịch chạy đủ 3 tháng. Tính lúc ${when(s.computed_at)} (giờ VN).`];
  if (!s.channels.length) lines.push("Không có chiến dịch chạy đủ 3 tháng.");
  for (const c of s.channels) {
    const [a, b, d] = c.months;
    lines.push(`${CHANNEL_LABEL[c.channel]}${c.channel === s.primary_channel ? " (dùng để đánh giá)" : ""} · ${c.like_count}/${c.total_count} CD · ${a ? mL(a.month) : ""}→${d ? mL(d.month) : ""}`);
    if (!a || !b || !d) continue;
    const lo = [a, b, d].filter((m) => m.low_data).map((m) => mL(m.month));
    lines.push(`  CPC ${p(mom(a.cpc, b.cpc))}, ${p(mom(b.cpc, d.cpc))} · Giá/CĐ ${p(mom(a.cpa, b.cpa))}, ${p(mom(b.cpa, d.cpa))} · Tỷ lệ CĐ ${p(mom(a.cvr, b.cvr))}, ${p(mom(b.cvr, d.cvr))}${lo.length ? ` · ít dữ liệu: ${lo.join(", ")}` : ""}`);
  }
  lines.push(`↑ xấu đi / ↓ tốt lên: trung bình thay đổi xấu của CPC, Giá/CĐ, Tỷ lệ CĐ (tháng cuối so với tháng trước) vượt ±${VERDICT_BAND * 100}%.`);
  return lines.join("\n");
}

export function TrendBadge({ s }: { s: TrendSnapshot | undefined }) {
  if (!s) return <span className="text-subtle" title="Chưa tính (chạy hằng đêm)">-</span>;
  const t = trendTip(s);
  const ch = s.primary_channel ? CHANNEL_LABEL[s.primary_channel] : "";
  switch (s.verdict) {
    case "worse": return <span title={t} className="whitespace-nowrap font-medium text-danger">↑ xấu đi <span className="text-[11px] font-normal text-muted">{ch} {p(s.score)}</span></span>;
    case "better": return <span title={t} className="whitespace-nowrap font-medium text-ok">↓ tốt lên <span className="text-[11px] font-normal text-muted">{ch}</span></span>;
    case "stable": return <span title={t} className="whitespace-nowrap text-ink">→ ổn <span className="text-[11px] text-muted">{ch}</span></span>;
    case "low": return <span title={t} className="whitespace-nowrap text-subtle">ít dữ liệu</span>;
    case "error": return <span title={t} className="rounded bg-danger-bg px-1.5 text-[11px] text-danger">lỗi</span>;
    default: return <span title={t} className="text-subtle">-</span>;
  }
}

/** Cảnh báo: a metric worsened > 10% in both of the last two month-over-month steps (like-for-like, per channel). */
export function GoogleTrendAlertsCard({ labels, onOpen }: { labels: Record<string, string>; onOpen?: (clientId: string) => void }) {
  const [rows, setRows] = useState<Record<string, TrendSnapshot> | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    readTrendSnapshotsFn().then((r) => live && setRows(r.rows)).catch((e: unknown) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, []);
  const list = useMemo(() => Object.values(rows || {}).flatMap((s) => s.alerts.map((a) => ({ s, a }))).sort((x, y) => (y.a.d1 + y.a.d2) - (x.a.d1 + x.a.d2)), [rows]);
  const errs = Object.values(rows || {}).filter((s) => s.verdict === "error").length;
  if (rows && !list.length && !errs) return null;
  return (
    <Card className="mb-4 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <p className="text-sm font-semibold text-ink" title={`Một chỉ số xấu đi hơn ${ALERT_STEP * 100}% hai tháng liên tiếp (T-2→T-1 và T-1→T), cùng loại chiến dịch, chỉ chiến dịch chạy đủ 3 tháng. Bỏ qua tháng ít dữ liệu. Tính hằng đêm.`}>Google: xu hướng 3 tháng xấu đi</p>
        <span className="rounded bg-accent-soft px-1.5 text-[11px] font-semibold text-accent">Nội bộ</span>
        {rows ? <span className="text-xs text-muted">{list.length} cảnh báo{errs ? ` · ${errs} tài khoản lỗi khi tính` : ""}</span> : null}
      </div>
      {err ? <p className="px-4 py-3 text-sm text-danger">{err}</p> : !rows ? <p className="px-4 py-3 text-sm text-muted">Đang tải…</p> : (
        <ul className="divide-y divide-line">
          {list.map(({ s, a }) => (
            <li key={`${s.client_id}-${a.channel}-${a.metric}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
              <button type="button" disabled={!onOpen} onClick={() => onOpen?.(s.client_id)} className={cn("font-medium text-ink", onOpen && "hover:text-accent hover:underline")} title="Mở thẻ Xu hướng 3 tháng của tài khoản">
                {labels[s.client_id] || s.client_id}
              </button>
              <span className="rounded bg-line px-1.5 text-[11px] text-muted">{CHANNEL_LABEL[a.channel]}</span>
              <span className="text-danger">
                {METRIC_LABEL[a.metric]} {a.metric === "cvr" ? "giảm" : "tăng"} {(a.d1 * 100).toFixed(0)}% ({mL(a.months[0])}→{mL(a.months[1])}) rồi {(a.d2 * 100).toFixed(0)}% ({mL(a.months[1])}→{mL(a.months[2])})
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** One-shot request to open the trend table at a campaign (set before navigating to the account). */
export type TrendFocus = { clientId: string; channel: string; campaignId: string | null };
let FOCUS: TrendFocus | null = null;
export function setTrendFocus(f: TrendFocus | null) { FOCUS = f; }
export function takeTrendFocus(clientId: string): TrendFocus | null {
  if (!FOCUS || FOCUS.clientId !== clientId) return null;
  const f = FOCUS; FOCUS = null; return f;
}
/** Scroll to an element that mounts later (retries for ~8 s). */
export function scrollWhenReady(id: string) {
  let n = 0;
  const tick = () => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); else if (n++ < 40) setTimeout(tick, 200); };
  setTimeout(tick, 200);
}
