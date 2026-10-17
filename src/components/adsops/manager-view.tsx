import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { readManagerFn, type ManagerRead } from "@/lib/adsops/manager.functions";
import { CHURN_LEVEL_VI, CHURN_RULES, HEALTH_GREEN, HEALTH_RULES, HEALTH_YELLOW, type ClientSpend, type HealthRow, type Kpis } from "@/lib/adsops/manager.types";
import { cn } from "@/lib/cn";
import { Badge, Card, EmptyState } from "@/components/adsops/ui";
import { StaffPerfView } from "@/components/adsops/staff-perf-view";

const dong = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v).toLocaleString("vi-VN")}đ`);
const tr = (v: number | null | undefined) => (v == null ? "—" : `${(v / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}tr`);
const n0 = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("vi-VN"));
const pctD = (c: number | null, p: number | null) => (c == null || p == null || p <= 0 ? null : c / p - 1);

function Delta({ c, p, lowerBetter = false }: { c: number | null; p: number | null; lowerBetter?: boolean }) {
  const d = pctD(c, p);
  if (d == null) return <span className="text-xs text-subtle">— kỳ trước</span>;
  const good = lowerBetter ? d < 0 : d > 0;
  return <span className={cn("text-xs", Math.abs(d) < 0.005 ? "text-muted" : good ? "text-ok" : "text-danger")}>{d > 0 ? "▲" : d < 0 ? "▼" : "="} {Math.abs(Math.round(d * 100))}% so với kỳ trước</span>;
}
function Tile({ label, value, sub, hint }: { label: string; value: string; sub?: React.ReactNode; hint?: string }) {
  return <div className="rounded-md border border-line bg-paper p-3" title={hint}><p className="text-xs text-muted">{label}</p><p className="text-kpi-sm font-semibold tabular-nums">{value}</p>{sub}</div>;
}
function KpiTiles({ c, p, d }: { c: Kpis; p: Kpis; d: ManagerRead }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
      <Tile label="Tổng chi tiêu" value={tr(c.spend.total)} sub={<Delta c={c.spend.total} p={p.spend.total} />} hint={`Kỳ trước (${d.prev.label}): ${dong(p.spend.total)}`} />
      <Tile label="Google" value={tr(c.spend.google)} sub={<Delta c={c.spend.google} p={p.spend.google} />} />
      <Tile label="Facebook" value={tr(c.spend.facebook)} sub={<Delta c={c.spend.facebook} p={p.spend.facebook} />} />
      {c.spend.chatgpt != null || p.spend.chatgpt != null ? <Tile label="ChatGPT Ads" value={tr(c.spend.chatgpt)} sub={<Delta c={c.spend.chatgpt} p={p.spend.chatgpt} />} /> : null}
      <Tile label="Khách / TK đang chạy" value={`${c.active_clients} / ${c.active_accounts}`} sub={<span className="text-xs text-muted">kỳ trước {p.active_clients} / {p.active_accounts}</span>} hint="Có chi tiêu trong kỳ. Khách = nhóm trong Quản trị → Khách hàng (TK chưa gán nhóm tính riêng)." />
      <Tile label="Lead" value={n0(c.leads)} sub={<Delta c={c.leads} p={p.leads} />} hint="Google: chuyển đổi; Facebook: lead (không có thì tin nhắn); ChatGPT Ads: chuyển đổi mục tiêu (click + view)." />
      <Tile label="CPL blended" value={dong(c.cpl)} sub={<Delta c={c.cpl} p={p.cpl} lowerBetter />} hint="Tổng chi tiêu ÷ tổng lead (FB + Google)." />
      <Tile label="Doanh thu đã nhập" value={c.revenue != null ? tr(c.revenue) : "Chưa có"} sub={<span className="text-xs text-subtle">{c.revenue_basis || "Chưa nhập số liệu"}</span>} />
      <Tile label="ROAS thực blended" value={c.roas != null ? `${c.roas.toFixed(2)}×` : "—"} sub={<Delta c={c.roas} p={p.roas} />} hint="Doanh thu đã nhập ÷ chi tiêu của cùng tài khoản và tháng." />
    </div>
  );
}

function SpendTable({ rows, title, hint, onOpen, showDelta }: { rows: ClientSpend[]; title: string; hint: string; onOpen?: (id: string) => void; showDelta?: boolean }) {
  return (
    <Card className="p-4">
      <h3 className="font-semibold" title={hint}>{title}</h3>
      {!rows.length ? <p className="mt-2 text-sm text-muted">Không có.</p> : (
        <table className="mt-2 w-full text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="py-1">Khách hàng</th><th className="text-right">Chi tiêu</th><th className="text-right">{showDelta ? "Thay đổi" : "Lead"}</th><th className="text-right">CPL</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.key} className="border-t border-line/60">
              <td className="py-1">{onOpen ? <button type="button" onClick={() => onOpen(r.open_id)} className="text-left hover:text-accent hover:underline">{r.label}</button> : r.label}</td>
              <td className="text-right tabular-nums">{tr(r.spend)}</td>
              <td className={cn("text-right tabular-nums", showDelta && r.delta != null && (r.delta > 0 ? "text-ok" : "text-danger"))}>{showDelta ? `${r.delta! > 0 ? "+" : ""}${tr(r.delta)}${r.prev ? ` (${Math.round((r.delta! / r.prev) * 100)}%)` : ""}` : n0(r.leads)}</td>
              <td className="text-right tabular-nums">{dong(r.cpl)}</td>
            </tr>))}</tbody>
        </table>
      )}
    </Card>
  );
}

function HealthBadge({ h }: { h: HealthRow }) {
  if (h.score == null) return <span className="text-xs text-subtle">Không đủ dữ liệu</span>;
  const tone = h.color === "green" ? "ok" : h.color === "yellow" ? "warn" : "danger";
  const tip = h.components.map((c) => `${c.label} (trọng số ${c.weight}): ${c.score == null ? "thiếu dữ liệu" : `${c.score}/100`} — ${c.detail}`).join("\n");
  return <Badge tone={tone} title={tip}>{h.score}/100</Badge>;
}

export function ManagerView({ onOpenAccount }: { onOpenAccount?: (id: string) => void }) {
  const [mode, setMode] = useState<"mtd" | "custom">("mtd");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [range, setRange] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [data, setData] = useState<ManagerRead | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [openHealth, setOpenHealth] = useState<string | null>(null);
  const [section, setSection] = useState<"agency" | "staff">("agency");
  useEffect(() => {
    let live = true;
    setLoading(true);
    readManagerFn({ data: range }).then((r) => { if (live) { setData(r); setError(""); } }).catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); }).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [range]);
  if (error) return <EmptyState title={error} />;
  if (!data) return <p className="px-1 py-16 text-center text-sm text-muted">Đang tính…</p>;
  const d = data;
  const trend = d.trend.map((t) => ({ m: `${t.month.slice(5)}/${t.month.slice(2, 4)}`, Google: t.google, Facebook: t.facebook, "ChatGPT Ads": t.chatgpt }));
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-2">
          <h2 className="font-display text-xl font-semibold">Bảng điều hành</h2>
          <span className="text-sm text-muted">{d.period.label} · so với {d.prev.label}{d.data_through ? ` · số liệu đến ${d.data_through.split("-").reverse().join("/")}` : ""}</span>
          <span className="ml-auto flex flex-wrap items-end gap-2">
            <select value={mode} onChange={(e) => { const v = e.target.value as "mtd" | "custom"; setMode(v); if (v === "mtd") setRange({ start: null, end: null }); }} className="h-8 rounded-md border border-line bg-paper px-2 text-sm"><option value="mtd">Tháng này đến nay</option><option value="custom">Tuỳ chọn</option></select>
            {mode === "custom" ? <>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 rounded-md border border-line bg-paper px-2 text-sm" />
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 rounded-md border border-line bg-paper px-2 text-sm" />
              <button type="button" disabled={!from || !to} onClick={() => setRange({ start: from, end: to })} className="h-8 rounded-md bg-accent px-3 text-sm font-medium text-white disabled:opacity-60">Xem</button>
            </> : null}
            {loading ? <span className="text-xs text-muted">Đang tải…</span> : null}
          </span>
        </div>
        <div className="mt-2 flex gap-1">
          {([["agency", "Tổng quan agency"], ["staff", "Hiệu suất nhân sự"]] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setSection(k)} className={cn("h-8 rounded-md px-3 text-sm", section === k ? "bg-accent text-white" : "border border-line bg-paper hover:bg-inset")}>{l}</button>)}
        </div>
        {section === "agency" ? <div className="mt-3"><KpiTiles c={d.cur} p={d.prev_kpis} d={d} /></div> : null}
        {section === "agency" ? <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
          <p title="Bắt đầu chi tiêu trong kỳ, 60 ngày trước đó không chi tiêu (cần đủ dữ liệu lưu)."><b>Mới chạy ({d.new_accounts.length}):</b> {d.new_accounts.length ? d.new_accounts.map((a) => a.label).join(", ") : "—"}</p>
          <p title="Quy tắc hiện có: không chi tiêu 10 ngày (đã có chi tiêu từ kỳ trước)."><b>Đã dừng ({d.stopped_accounts.length}):</b> {d.stopped_accounts.length ? d.stopped_accounts.map((a) => a.label).join(", ") : "—"}</p>
        </div> : null}
      </Card>

      {section === "staff" ? <StaffPerfView range={range} onOpenAccount={onOpenAccount} /> : null}
      {section === "agency" ? <>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="p-4 xl:col-span-1">
          <h3 className="font-semibold">Chi tiêu 6 tháng</h3>
          <div className="mt-2 h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="m" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${Math.round(v / 1e6)}tr`} width={44} />
                <Tooltip formatter={(v: unknown) => (v == null ? "—" : dong(Number(v)))} /><Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Google" stackId="s" fill="#0891b2" /><Bar dataKey="Facebook" stackId="s" fill="#6366f1" /><Bar dataKey="ChatGPT Ads" stackId="s" fill="#10a37f" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <SpendTable rows={d.top_clients} title="Khách chi tiêu nhiều nhất" hint="Theo kỳ đang chọn" onOpen={onOpenAccount} />
        <SpendTable rows={d.movers} title="Thay đổi chi tiêu lớn nhất" hint="Chênh lệch tuyệt đối so với kỳ trước" onOpen={onOpenAccount} showDelta />
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="font-semibold">Sức khoẻ khách hàng</h3>
          <span className="text-xs text-muted">0–100 · xanh ≥ {HEALTH_GREEN}, vàng {HEALTH_YELLOW}–{HEALTH_GREEN - 1}, đỏ &lt; {HEALTH_YELLOW} · chỉ chấm thành phần có dữ liệu (chia lại trọng số) · xếp từ thấp nhất</span>
        </div>
        <details className="mt-1 text-xs text-muted"><summary className="cursor-pointer">Cách tính</summary><ul className="mt-1 list-disc pl-5">{Object.entries(HEALTH_RULES).map(([k, v]) => <li key={k}>{v}</li>)}</ul></details>
        {!d.health.length ? <p className="mt-2 text-sm text-muted">Không có khách đang chạy.</p> : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="py-1">Khách hàng</th><th>Điểm</th>{d.health[0].components.map((c) => <th key={c.key} className="text-right" title={HEALTH_RULES[c.key]}>{c.label}</th>)}</tr></thead>
              <tbody>{d.health.map((h) => (
                <tr key={h.key} className="border-t border-line/60 align-top">
                  <td className="py-1.5">
                    <button type="button" onClick={() => onOpenAccount?.(h.open_id)} className="text-left hover:text-accent hover:underline">{h.label}</button>
                    {h.accounts.length > 1 ? <span className="block text-[11px] text-subtle">{h.accounts.length} tài khoản</span> : null}
                    {h.missing.length ? <button type="button" onClick={() => setOpenHealth(openHealth === h.key ? null : h.key)} className="block text-[11px] text-subtle underline decoration-dotted">Thiếu: {h.missing.length} thành phần</button> : null}
                    {openHealth === h.key ? <span className="block text-[11px] text-subtle">{h.missing.join(", ")}</span> : null}
                  </td>
                  <td><HealthBadge h={h} /></td>
                  {h.components.map((c) => <td key={c.key} className={cn("text-right tabular-nums", c.score == null ? "text-subtle" : c.score >= HEALTH_GREEN ? "text-ok" : c.score >= HEALTH_YELLOW ? "text-warn" : "text-danger")} title={c.detail}>{c.score == null ? "—" : c.score}</td>)}
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="font-semibold">Nguy cơ rời bỏ</h3>
          <span className="text-xs text-muted" title={`Điểm: chi tiêu giảm ${CHURN_RULES.spendDropPoints}, ngân sách < 3 ngày ${CHURN_RULES.runwayPoints}, CPL vượt mục tiêu ${CHURN_RULES.cplPoints}, không tối ưu ${CHURN_RULES.noOptPoints}, ROAS dưới mục tiêu ${CHURN_RULES.roasPoints}, chưa gửi báo cáo ${CHURN_RULES.reportPoints}. ≥5 cao, 3–4 trung bình.`}>
            Theo quy tắc: chi tiêu giảm ≥{CHURN_RULES.spendDropPct * 100}%/tuần ≥{CHURN_RULES.spendDropWeeks} tuần liền · CPL vượt mục tiêu ≥{CHURN_RULES.cplMonths} tháng · ≥{CHURN_RULES.noOptDays} ngày không tối ưu · ngân sách &lt; {CHURN_RULES.runwayDays} ngày · ROAS dưới mục tiêu ≥{CHURN_RULES.roasMonths} tháng · &gt;{CHURN_RULES.reportDays} ngày chưa gửi báo cáo
          </span>
        </div>
        {!d.churn.length ? <p className="mt-2 text-sm text-muted">Không có khách nào có dấu hiệu.</p> : (
          <ul className="mt-2 divide-y divide-line">
            {d.churn.map((c) => (
              <li key={c.key} className="flex flex-wrap items-start gap-2 py-2">
                <Badge tone={c.level === "high" ? "danger" : c.level === "medium" ? "warn" : "neutral"}>{CHURN_LEVEL_VI[c.level]}</Badge>
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => onOpenAccount?.(c.open_id)} className="font-medium hover:text-accent hover:underline">{c.label}</button>
                  {c.no_report ? <span className="ml-2 rounded-sm bg-warn-bg px-1.5 text-[11px] text-warn">Chưa gửi báo cáo &gt;{CHURN_RULES.reportDays} ngày</span> : null}
                  <ul className="mt-0.5 list-disc pl-5 text-sm text-muted">{c.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      </> : null}
    </div>
  );
}
