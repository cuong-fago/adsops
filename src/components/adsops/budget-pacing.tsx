import { useEffect, useState } from "react";
import { Copy, Pencil } from "lucide-react";
import { readPacingFn, savePlanFn, type PacingRow } from "@/lib/adsops/budget-plan.functions";
import { PACE_BAD, PACE_LABEL, PACE_TONE, PACE_WARN, isRedPace } from "@/lib/adsops/budget-plan.types";
import { moneyPlain, num } from "@/lib/adsops/format";
import { cn } from "@/lib/cn";
import { Badge, Card, EmptyState } from "@/components/adsops/ui";

const dong = (v: number | null | undefined) => (v == null ? "—" : `${moneyPlain(Math.round(v))}đ`);
const signedPct = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`;
const monthVi = (m: string) => `${m.slice(5)}/${m.slice(0, 4)}`;
const dmy = (s: string) => s.split("-").reverse().join("/");

export function PaceBadge({ r }: { r: PacingRow }) {
  if (!r.plan) return <span className="text-sm text-muted">Chưa đặt kế hoạch</span>;
  if (!r.status || r.pace == null) return <span className="text-sm text-muted">Chưa có chi tiêu tháng này</span>;
  return <Badge tone={PACE_TONE[r.status]} title={`Chi ${dong(r.mtd_spend)} / kỳ vọng ${dong(r.expected)}`}>{PACE_LABEL[r.status]} {r.status === "on_track" ? "" : signedPct(r.pace)}</Badge>;
}

function Bar({ r }: { r: PacingRow }) {
  if (!r.plan || r.mtd_spend == null) return null;
  const plan = r.plan.planned_budget;
  const fill = Math.min(1, r.mtd_spend / plan);
  const mark = r.expected != null ? Math.min(1, r.expected / plan) : null;
  const tone = r.status ? PACE_TONE[r.status] : "ok";
  return (
    <div className="relative mt-2 h-2.5 rounded-sm bg-inset" title={`Đã chi ${Math.round(fill * 100)}% kế hoạch · vạch = tiến độ kỳ vọng`}>
      <div className={cn("h-full rounded-sm", tone === "danger" ? "bg-danger" : tone === "warn" ? "bg-warn" : "bg-accent")} style={{ width: `${(fill * 100).toFixed(1)}%` }} />
      {mark != null ? <div className="absolute -top-1 h-4.5 w-0.5 bg-ink" style={{ left: `calc(${(mark * 100).toFixed(1)}% - 1px)` }} /> : null}
    </div>
  );
}

function Editor({ r, onDone }: { r: PacingRow; onDone: (msg?: string) => void }) {
  const [plan, setPlan] = useState(r.plan ? String(r.plan.planned_budget) : "");
  const [conv, setConv] = useState(r.plan?.target_conv != null ? String(r.plan.target_conv) : "");
  const [cpl, setCpl] = useState(r.plan?.target_cpl != null ? String(r.plan.target_cpl) : "");
  const [cac, setCac] = useState(r.plan?.target_cac != null ? String(r.plan.target_cac) : "");
  const [roas, setRoas] = useState(r.plan?.target_roas != null ? String(r.plan.target_roas) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const digits = (s: string) => s.replace(/[^\d.]/g, "");
  async function run(action: "save" | "delete") {
    setBusy(true); setErr("");
    try {
      await savePlanFn({ data: { clientId: r.client_id, month: r.month, action, plannedBudget: digits(plan), targetConv: digits(conv), targetCpl: digits(cpl), targetCac: digits(cac), targetRoas: digits(roas) } });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const inp = "h-9 w-full rounded-md border border-line bg-paper px-2 text-sm tabular-nums";
  return (
    <div className="mt-3 grid gap-2 rounded-md border border-line bg-inset p-3 sm:grid-cols-3">
      <label className="text-xs text-muted">Ngân sách kế hoạch (VND)<input inputMode="numeric" value={plan} onChange={(e) => setPlan(e.target.value)} className={inp} placeholder="vd 30000000" /></label>
      <label className="text-xs text-muted">Mục tiêu {r.conv_label.toLowerCase()} (tuỳ chọn)<input inputMode="numeric" value={conv} onChange={(e) => setConv(e.target.value)} className={inp} /></label>
      <label className="text-xs text-muted">CPL mục tiêu (VND, tuỳ chọn)<input inputMode="numeric" value={cpl} onChange={(e) => setCpl(e.target.value)} className={inp} /></label>
      <label className="text-xs text-muted">CAC mục tiêu (VND, tuỳ chọn)<input inputMode="numeric" value={cac} onChange={(e) => setCac(e.target.value)} className={inp} /></label>
      <label className="text-xs text-muted">ROAS thực mục tiêu (lần, tuỳ chọn)<input inputMode="decimal" value={roas} onChange={(e) => setRoas(e.target.value)} className={inp} placeholder="vd 3" /></label>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
        <button type="button" disabled={busy} onClick={() => void run("save")} className="h-8 rounded-md bg-accent px-3 text-sm font-medium text-white disabled:opacity-60">Lưu</button>
        <button type="button" disabled={busy} onClick={() => onDone()} className="h-8 rounded-md border border-line bg-paper px-3 text-sm">Huỷ</button>
        {r.plan ? <button type="button" disabled={busy} onClick={() => void run("delete")} className="ml-auto h-8 rounded-md px-3 text-sm text-danger hover:bg-danger-bg">Xoá kế hoạch</button> : null}
        {err ? <span className="basis-full text-xs text-danger">{err}</span> : null}
        <span className="basis-full text-[11px] text-subtle">Chỉ lưu trong AdsOps, không thay đổi ngân sách trên Google / Meta.</span>
      </div>
    </div>
  );
}

/** "Tiến độ ngân sách" on the account overview (staff only; renders nothing for clients). */
export function PacingCard({ clientId }: { clientId: string }) {
  const [row, setRow] = useState<PacingRow | null>(null);
  const [hidden, setHidden] = useState(false);
  const [edit, setEdit] = useState(false);
  const [msg, setMsg] = useState("");
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let live = true;
    readPacingFn({ data: { clientId } })
      .then((r) => { if (live) { setRow(r.rows[0] || null); setHidden(false); } })
      .catch(() => { if (live) setHidden(true); });
    return () => { live = false; };
  }, [clientId, epoch]);
  if (hidden || !row) return null;
  const r = row;
  async function copyPrev() {
    setMsg("");
    try {
      const res = await savePlanFn({ data: { clientId, month: r.month, action: "copy_prev" } });
      if (res.message) setMsg(res.message); else setEpoch((n) => n + 1);
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  }
  const stat = (label: string, value: string, hint?: string, cls?: string) => (
    <div title={hint}><p className="text-xs text-muted">{label}</p><p className={cn("font-semibold tabular-nums", cls)}>{value}</p></div>
  );
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-lg font-semibold tracking-tight">Tiến độ ngân sách · {monthVi(r.month)}</h3>
        <PaceBadge r={r} />
        <span className="ml-auto flex items-center gap-1">
          {r.can_edit && !edit ? (
            <>
              <button type="button" onClick={() => setEdit(true)} className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-paper px-2.5 text-sm hover:bg-inset"><Pencil className="size-3.5" /> {r.plan ? "Sửa" : "Đặt kế hoạch"}</button>
              <button type="button" onClick={() => void copyPrev()} title="Chép kế hoạch tháng trước sang tháng này" className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-paper px-2.5 text-sm hover:bg-inset"><Copy className="size-3.5" /> Chép tháng trước</button>
            </>
          ) : null}
        </span>
      </div>
      {msg ? <p className="mt-1 text-xs text-warn">{msg}</p> : null}
      {!r.plan && !edit ? <p className="mt-2 text-sm text-muted">Chưa đặt kế hoạch.{r.mtd_spend != null ? ` Đã chi tháng này: ${dong(r.mtd_spend)}.` : ""}</p> : null}
      {r.plan ? (
        <>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="text-kpi-sm font-semibold tabular-nums">{dong(r.mtd_spend)}</span>
            <span className="text-muted">/ {dong(r.plan.planned_budget)} kế hoạch{r.data_through ? ` · số liệu đến ${dmy(r.data_through)} (ngày ${r.days_elapsed}/${r.days_in_month})` : ""}</span>
          </div>
          <Bar r={r} />
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {stat("Kỳ vọng đến nay", dong(r.expected), "Kế hoạch × số ngày đã qua ÷ số ngày trong tháng.")}
            {stat("Lệch tiến độ", r.pace != null ? signedPct(r.pace) : "—", `±${PACE_WARN * 100}%: đúng tiến độ; vượt ±${PACE_BAD * 100}%: đỏ.`, r.status ? (PACE_TONE[r.status] === "danger" ? "text-danger" : PACE_TONE[r.status] === "warn" ? "text-warn" : "text-ok") : undefined)}
            {stat("Dự kiến cuối tháng", dong(r.projected), "Đã chi + trung bình 7 ngày gần nhất × số ngày còn lại. Trống khi thiếu ngày trong 7 ngày.")}
            {stat("Còn lại", dong(r.remaining))}
            {stat("Cần chi mỗi ngày", dong(r.daily_needed), "(Kế hoạch − đã chi) ÷ số ngày còn lại.")}
            {stat("TB 7 ngày", dong(r.avg7))}
          </div>
          {r.plan.target_conv != null || r.plan.target_cpl != null ? (
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 sm:grid-cols-4">
              {stat(`${r.conv_label} tháng này`, r.mtd_conv != null ? num(r.mtd_conv, 0) : "—")}
              {stat(`Mục tiêu ${r.conv_label.toLowerCase()}`, r.plan.target_conv != null ? num(r.plan.target_conv, 0) : "—", r.plan.target_conv != null && r.days_elapsed ? `Kỳ vọng đến nay ≈ ${num((r.plan.target_conv * r.days_elapsed) / r.days_in_month, 0)}` : undefined)}
              {stat("CPL tháng này", dong(r.mtd_cpl), undefined, r.mtd_cpl != null && r.plan.target_cpl != null ? (r.mtd_cpl <= r.plan.target_cpl ? "text-ok" : "text-danger") : undefined)}
              {stat("CPL mục tiêu", dong(r.plan.target_cpl))}
            </div>
          ) : null}
        </>
      ) : null}
      {edit ? <Editor r={r} onDone={() => { setEdit(false); setEpoch((n) => n + 1); }} /> : null}
    </Card>
  );
}

/** Cảnh báo: accounts with red pacing (> ±25%). */
export function PacingAlertsCard({ onOpenAccount, labels }: { onOpenAccount?: (clientId: string) => void; labels?: Record<string, string> }) {
  const [rows, setRows] = useState<PacingRow[] | null>(null);
  const [month, setMonth] = useState("");
  useEffect(() => {
    let live = true;
    readPacingFn({ data: {} }).then((r) => { if (live) { setRows(r.rows); setMonth(r.month); } }).catch(() => { if (live) setRows(null); });
    return () => { live = false; };
  }, []);
  if (!rows) return null;
  const red = rows.filter((r) => isRedPace(r.status)).sort((a, b) => Math.abs(b.pace || 0) - Math.abs(a.pace || 0));
  return (
    <Card id="budget-pacing-alerts" className="mb-4 overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-lg font-semibold tracking-tight">Tiến độ ngân sách lệch nhiều · {month ? monthVi(month) : ""}</h2>
        <p className="text-xs text-subtle">Chi tiêu tháng lệch hơn ±{PACE_BAD * 100}% so với tiến độ kế hoạch. Tài khoản chưa đặt kế hoạch không được cảnh báo.</p>
      </div>
      {!red.length ? <EmptyState title="Không có tài khoản lệch tiến độ nhiều." className="py-6" /> : (
        <ul className="divide-y divide-line">
          {red.map((r) => (
            <li key={r.client_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">{labels?.[r.client_id] || r.client_id}</span>
              <PaceBadge r={r} />
              <span className="tabular-nums text-muted">Chi {dong(r.mtd_spend)} / kỳ vọng {dong(r.expected)} · dự kiến {dong(r.projected)} / KH {dong(r.plan?.planned_budget)}</span>
              {onOpenAccount ? <button type="button" onClick={() => onOpenAccount(r.client_id)} className="text-sm font-medium text-accent hover:underline">Mở →</button> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
