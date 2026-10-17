import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { readBreakdownFn, readCallsFn } from "@/lib/adsops/connect.functions";
import { DOW_ORDER, DOW_VI, type BreakdownRead, type CallsRead, type SegMetrics, type SegRow } from "@/lib/adsops/google-breakdown.types";
import { moneyPlain, num } from "@/lib/adsops/format";
import { cn } from "@/lib/cn";
import { chartColors, chartTheme } from "@/components/adsops/chart-theme";
import { TableSkeleton, cardClass } from "@/components/adsops/ui";

const dong = (v: number) => `${moneyPlain(v)}đ`;
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`);
const conv = (v: number) => num(v, Math.abs(v - Math.round(v)) < 1e-6 ? 0 : 1);
const cpl = (m: SegMetrics) => (m.conversions > 0 ? m.cost / m.conversions : null);
type Campaign = { id: string; name: string };

function CampaignFilter({ campaigns, value, onChange }: { campaigns: Campaign[]; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      Chiến dịch
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 max-w-[22rem] rounded-md border border-line bg-paper px-2 text-sm text-ink">
        <option value="">Tất cả</option>
        {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
  );
}

// ── Breakdowns ─────────────────────────────────────────────────────────────────────

/** Best / worst + text-only bid hint, per segment (needs volume; never written to Google). */
function judge(rows: SegRow[], kind: "device" | "hour" | "dow" | "geo") {
  const tot = rows.reduce((a, r) => ({ cost: a.cost + r.cost, conv: a.conv + r.conversions }), { cost: 0, conv: 0 });
  const avg = tot.conv > 0 ? tot.cost / tot.conv : null;
  const out = new Map<string, { tone: "best" | "worst"; hint: string }>();
  if (avg == null) return { avg, out };
  const where = kind === "device" ? "điều chỉnh giá thầu thiết bị" : kind === "geo" ? "điều chỉnh giá thầu vị trí" : "lịch quảng cáo (điều chỉnh giá thầu theo giờ / ngày)";
  const withConv = rows.filter((r) => r.conversions >= 3);
  const best = withConv.length >= 2 ? withConv.reduce((a, b) => (cpl(a)! <= cpl(b)! ? a : b)) : null;
  const worstConv = withConv.length >= 2 ? withConv.reduce((a, b) => (cpl(a)! >= cpl(b)! ? a : b)) : null;
  const burner = rows.filter((r) => r.conversions === 0 && r.cost >= avg * 1.5).sort((a, b) => b.cost - a.cost)[0] || null;
  const adj = (r: SegRow) => Math.max(-0.5, Math.min(0.5, Math.round((avg / cpl(r)! - 1) * 20) / 20));
  if (best && adj(best) >= 0.1) out.set(best.key, { tone: "best", hint: `CPL ${dong(cpl(best)!)} thấp hơn trung bình ${dong(avg)} — cân nhắc +${Math.round(adj(best) * 100)}% (${where}).` });
  if (burner) out.set(burner.key, { tone: "worst", hint: `Chi ${dong(burner.cost)} (≥1,5× CPL trung bình) mà 0 chuyển đổi — cân nhắc −30% hoặc loại trừ (${where}).` });
  else if (worstConv && worstConv !== best && adj(worstConv) <= -0.1) out.set(worstConv.key, { tone: "worst", hint: `CPL ${dong(cpl(worstConv)!)} cao hơn trung bình ${dong(avg)} — cân nhắc ${Math.round(adj(worstConv) * 100)}% (${where}).` });
  return { avg, out };
}

function SegTable({ title, rows, kind, chart = false }: { title: string; rows: SegRow[]; kind: "device" | "hour" | "dow" | "geo"; chart?: boolean }) {
  const { out } = useMemo(() => judge(rows, kind), [rows, kind]);
  const [all, setAll] = useState(false);
  const shown = kind === "geo" && !all ? rows.slice(0, 15) : rows;
  if (!rows.length) return (
    <section className={cn(cardClass, "p-4")}><h3 className="font-display text-lg font-semibold">{title}</h3><p className="mt-2 text-sm text-muted">Không có dữ liệu.</p></section>
  );
  return (
    <section className={cn(cardClass, "flex min-w-0 flex-col gap-3 p-4")}>
      <h3 className="font-display text-lg font-semibold tracking-tight">{title}</h3>
      {chart ? (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows.map((r) => ({ label: r.label, cost: r.cost, conv: r.conversions }))}>
              <CartesianGrid {...chartTheme.grid} />
              <XAxis dataKey="label" tick={chartTheme.axisTick} {...chartTheme.axis} interval={kind === "hour" ? 2 : 0} />
              <YAxis yAxisId="c" tick={chartTheme.axisTick} {...chartTheme.axis} width={56} tickFormatter={(v: number) => (v >= 1e6 ? `${Math.round(v / 1e6)}tr` : moneyPlain(v))} />
              <YAxis yAxisId="v" orientation="right" tick={chartTheme.axisTick} {...chartTheme.axis} width={32} />
              <Tooltip contentStyle={chartTheme.tooltip.contentStyle} labelStyle={chartTheme.tooltip.labelStyle} formatter={(v: unknown, n: unknown) => (n === "cost" ? [dong(Number(v)), "Chi tiêu"] : [conv(Number(v)), "Conv"])} />
              <Bar yAxisId="c" dataKey="cost" fill={chartColors.primary} radius={chartTheme.bar.radius} isAnimationActive={false} />
              <Bar yAxisId="v" dataKey="conv" fill={chartColors.series[1]} radius={chartTheme.bar.radius} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr>
              {["", "Chi tiêu", "Click", "CTR", "CPC", "Conv", "CPL", "Tỷ lệ CĐ"].map((h, i) => (
                <th key={h || i} className={cn("whitespace-nowrap px-2 py-1.5 font-medium", i ? "text-right" : "text-left")}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const j = out.get(r.key);
              return (
                <tr key={r.key} className={cn("border-t border-line/60 align-top", j?.tone === "best" && "bg-ok-bg/50", j?.tone === "worst" && "bg-danger-bg/50")}>
                  <td className="px-2 py-1.5">
                    <span className="font-medium">{r.label}</span>
                    {j ? <span className={cn("ml-1.5 rounded-sm px-1.5 text-[11px] font-medium", j.tone === "best" ? "bg-ok-bg text-ok" : "bg-danger-bg text-danger")}>{j.tone === "best" ? "Tốt nhất" : "Kém nhất"}</span> : null}
                    {j ? <span className="block max-w-[28rem] whitespace-normal text-xs text-muted">Gợi ý (chỉ đọc): {j.hint}</span> : null}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{dong(r.cost)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{num(r.clicks)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{pct(r.impressions > 0 ? r.clicks / r.impressions : null)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{r.clicks > 0 ? dong(r.cost / r.clicks) : "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{conv(r.conversions)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{cpl(r) != null ? dong(cpl(r)!) : "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{pct(r.clicks > 0 ? r.conversions / r.clicks : null)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {kind === "geo" && rows.length > 15 ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="self-start text-sm font-medium text-accent hover:underline">{all ? "Thu gọn" : `Xem tất cả ${rows.length}`}</button>
      ) : null}
    </section>
  );
}

function Heatmap({ heat }: { heat: BreakdownRead["heat"] }) {
  const [metric, setMetric] = useState<"conv" | "cpl">("conv");
  const val = (m: SegMetrics | undefined) => (!m ? null : metric === "conv" ? m.conversions : cpl(m));
  const vals = Object.values(heat).map(val).filter((v): v is number => v != null && v > 0);
  const max = vals.length ? Math.max(...vals) : 0;
  const min = vals.length ? Math.min(...vals) : 0;
  return (
    <section className={cn(cardClass, "flex min-w-0 flex-col gap-3 p-4")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-lg font-semibold tracking-tight" title="Giờ theo múi giờ tài khoản Google Ads.">Giờ × ngày trong tuần</h3>
        <div className="inline-flex gap-0.5 rounded-md border border-line bg-inset p-0.5">
          {(["conv", "cpl"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={metric === k} onClick={() => setMetric(k)} className={cn("h-7 rounded px-3 text-xs font-medium", metric === k ? "bg-paper text-ink shadow-sheet" : "text-muted")}>{k === "conv" ? "Conv" : "CPL"}</button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="text-[11px] tabular-nums">
          <thead>
            <tr><th />{Array.from({ length: 24 }, (_, h) => <th key={h} className="w-8 px-0.5 font-medium text-subtle">{h}</th>)}</tr>
          </thead>
          <tbody>
            {DOW_ORDER.map((d) => (
              <tr key={d}>
                <th className="pr-2 text-left font-medium text-muted">{DOW_VI[d]}</th>
                {Array.from({ length: 24 }, (_, h) => {
                  const m = heat[`${d}|${h}`];
                  const v = val(m);
                  // conv: more = greener; CPL: lower = greener.
                  const u = v == null || !(v > 0) || max === min ? (v != null && v > 0 ? 1 : 0) : metric === "conv" ? (v - min) / (max - min) : 1 - (v - min) / (max - min);
                  const title = m ? `${DOW_VI[d]} ${h}h · Chi ${dong(m.cost)} · ${num(m.clicks)} click · ${conv(m.conversions)} conv${cpl(m) != null ? ` · CPL ${dong(cpl(m)!)}` : ""}` : `${DOW_VI[d]} ${h}h · không có số`;
                  return (
                    <td key={h} title={title} className="h-7 w-8 border border-paper text-center" style={v != null && v > 0 ? { backgroundColor: `rgb(40 123 51 / ${(0.12 + 0.68 * u).toFixed(2)})` } : { backgroundColor: m ? "var(--color-inset)" : "transparent" }}>
                      {v != null && v > 0 ? (metric === "conv" ? conv(v) : "") : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-subtle">{metric === "conv" ? "Đậm hơn = nhiều chuyển đổi hơn." : "Đậm hơn = CPL thấp hơn (rê chuột để xem số). Ô xám: có chi tiêu, 0 chuyển đổi."}</p>
    </section>
  );
}

export function BreakdownView({ clientId, start, end, campaigns }: { clientId: string; start: string; end: string; campaigns: Campaign[] }) {
  const [campaignId, setCampaignId] = useState("");
  const [st, setSt] = useState<{ key: string; data: BreakdownRead | null; loading: boolean; error: boolean }>({ key: "", data: null, loading: true, error: false });
  const key = `${clientId}|${start}|${end}|${campaignId}`;
  useEffect(() => {
    let live = true;
    setSt((c) => ({ ...c, key, loading: true, error: false }));
    readBreakdownFn({ data: { clientId, start, end, campaignId: campaignId || null } })
      .then((data) => { if (live) setSt({ key, data, loading: false, error: data == null }); })
      .catch(() => { if (live) setSt({ key, data: null, loading: false, error: true }); });
    return () => { live = false; };
  }, [key, clientId, start, end, campaignId]);
  const d = st.data;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <CampaignFilter campaigns={campaigns} value={campaignId} onChange={setCampaignId} />
        <span className="text-xs text-subtle">Google tính cho cả khoảng (không cộng theo ngày) · gợi ý giá thầu chỉ là văn bản, không sửa tài khoản.</span>
      </div>
      {st.loading && !d ? <TableSkeleton rows={6} cols={6} /> : st.error || !d ? (
        <p className="rounded-md bg-inset px-4 py-6 text-sm text-muted">Chưa lấy được phân bổ từ Google Ads. Thử lại sau ít phút.</p>
      ) : (
        <div className={cn("flex flex-col gap-4", st.loading && "opacity-60")}>
          {d.errors.length ? <p className="text-xs text-warn">Một phần chưa đọc được: {d.errors.map((e) => e.split(":")[0]).join(", ")}</p> : null}
          <div className="grid gap-4 xl:grid-cols-2">
            <SegTable title="Thiết bị" rows={d.device} kind="device" chart />
            <SegTable title="Ngày trong tuần" rows={d.dow} kind="dow" chart />
          </div>
          <Heatmap heat={d.heat} />
          <SegTable title="Giờ trong ngày" rows={d.hour} kind="hour" chart />
          <SegTable title="Tỉnh / thành phố (vị trí thực tế)" rows={d.geo} kind="geo" />
        </div>
      )}
    </div>
  );
}

// ── Calls ──────────────────────────────────────────────────────────────────────────

export function useCalls(clientId: string, start: string, end: string, campaignId: string, enabled: boolean) {
  const [st, setSt] = useState<{ key: string; data: CallsRead | null; loading: boolean }>({ key: "", data: null, loading: false });
  const key = `${clientId}|${start}|${end}|${campaignId}`;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setSt((c) => ({ ...c, key, loading: true }));
    readCallsFn({ data: { clientId, start, end, campaignId: campaignId || null } })
      .then((data) => { if (live) setSt({ key, data, loading: false }); })
      .catch(() => { if (live) setSt({ key, data: null, loading: false }); });
    return () => { live = false; };
  }, [key, clientId, start, end, campaignId, enabled]);
  return st.key === key ? st : { key, data: null, loading: enabled };
}

const callTime = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : s;
};
const dur = (s: number | null) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

export function CallsView({ clientId, start, end, campaigns }: { clientId: string; start: string; end: string; campaigns: Campaign[] }) {
  const [campaignId, setCampaignId] = useState("");
  const { data, loading } = useCalls(clientId, start, end, campaignId, true);
  const calls = data?.calls || [];
  const kpi = (label: string, value: string, hint?: string) => (
    <div className={cn(cardClass, "p-4")}>
      <p className="text-[13px] font-medium text-muted" title={hint}>{label}</p>
      <p className="text-kpi-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <CampaignFilter campaigns={campaigns} value={campaignId} onChange={setCampaignId} />
        <span className="text-xs text-subtle">Từ call_view (cần bật báo cáo cuộc gọi). Chỉ hiện mã vùng người gọi, không có số điện thoại.</span>
      </div>
      {loading && !data ? <TableSkeleton rows={6} cols={5} /> : !data || data.calls == null ? (
        <p className="rounded-md bg-inset px-4 py-6 text-sm text-muted">Chưa đọc được dữ liệu cuộc gọi (báo cáo cuộc gọi có thể chưa bật).</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {kpi("Tổng cuộc gọi", num(data.total))}
            {kpi("Gọi ≥60 giây", num(data.long60), "Cuộc gọi kéo dài từ 60 giây trở lên.")}
            {kpi("% ≥60 giây", data.total ? pct(data.long60 / data.total) : "—")}
            {kpi("Gọi nhỡ", num(data.missed), "call_status = MISSED.")}
            {kpi("Chi phí / cuộc gọi ≥60s", data.spend != null && data.long60 > 0 ? dong(data.spend / data.long60) : "—", "Tổng chi tiêu (cùng khoảng, cùng chiến dịch) ÷ số cuộc gọi ≥60 giây.")}
            {kpi("Chuyển đổi cuộc gọi", data.call_conversions != null ? conv(data.call_conversions) : "—", data.call_actions.length ? `Conversion action loại Gọi điện: ${data.call_actions.map((a) => `${a.name} (${conv(a.conversions)})`).join(", ")}` : "Không có conversion action loại Gọi điện.")}
          </div>
          <section className={cn(cardClass, "min-w-0 p-4")}>
            <h3 className="font-display text-lg font-semibold tracking-tight">Danh sách cuộc gọi <span className="text-sm font-normal text-muted">({calls.length})</span></h3>
            {calls.length ? (
              <div className="mt-2 max-h-[60vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-paper text-xs text-muted">
                    <tr>{["Thời gian", "Thời lượng", "Trạng thái", "Mã vùng", "Chiến dịch › Nhóm"].map((h) => <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {calls.map((c, i) => (
                      <tr key={`${c.start}|${i}`} className="border-t border-line/60">
                        <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{callTime(c.start)}</td>
                        <td className={cn("px-2 py-1.5 tabular-nums", c.duration != null && c.duration >= 60 && "font-semibold text-ok")}>{dur(c.duration)}</td>
                        <td className="px-2 py-1.5">{c.status === "MISSED" ? <span className="text-danger">Nhỡ</span> : c.status === "RECEIVED" ? "Đã nghe" : c.status || "—"}</td>
                        <td className="px-2 py-1.5 tabular-nums">{c.area ? `${c.country ? `${c.country} ` : ""}${c.area}` : "—"}</td>
                        <td className="px-2 py-1.5 text-muted">{c.campaign_name}{c.ad_group_name ? ` › ${c.ad_group_name}` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="mt-2 text-sm text-muted">Không có cuộc gọi trong khoảng này.</p>}
          </section>
        </>
      )}
    </div>
  );
}
