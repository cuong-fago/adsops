import { Fragment, useEffect, useMemo, useState } from "react";
import { computeNeedsBatchFn, readNeedsActionFn, saveNeedThresholdsFn, setNeedStatusFn } from "@/lib/adsops/connect.functions";
import { CHANNEL_LABEL, type ChannelKey } from "@/lib/adsops/google-trend.types";
import { STATUS_LABEL, type NeedAccount, type NeedLevel, type NeedMetric, type NeedRow, type NeedsRead, type NeedStatus, type NeedThresholds } from "@/lib/adsops/needs-action.types";
import { Card } from "@/components/adsops/ui";
import { cn } from "@/lib/cn";

const MET_LABEL: Record<NeedMetric, string> = { cpc: "CPC", cpa: "Giá/chuyển đổi", cvr: "Tỷ lệ chuyển đổi" };
const LEVEL_LABEL: Record<NeedLevel, string> = { account: "Tài khoản", campaign: "Chiến dịch", ad_group: "Nhóm quảng cáo", asset_group: "Nhóm tài sản" };
const mL = (m: string) => `T${Number(m.slice(5))}/${m.slice(2, 4)}`;
const dong = (v: number) => `${Math.round(v).toLocaleString("vi-VN")}đ`;
const val = (k: NeedMetric, v: number | null) => (v == null ? "-" : k === "cvr" ? `${(v * 100).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%` : dong(v));
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "-");

function Step({ s, upBad, th }: { s: number | null; upBad: boolean; th: number }) {
  if (s == null) return <span className="text-subtle" title="Thiếu số liệu hoặc tháng ít dữ liệu: không đánh giá">-</span>;
  const bad = upBad ? s : -s;
  return <span className={cn("tabular-nums", bad > th ? "font-medium text-danger" : bad < -th ? "font-medium text-ok" : "text-muted")}>{s >= 0 ? "+" : ""}{(s * 100).toFixed(1)}%</span>;
}

type Filters = { status: NeedStatus | "all"; showDone: boolean; metric: NeedMetric | "all"; level: "all" | "account" | "campaign" | "group"; channel: ChannelKey | "all"; owner: string; better: boolean; q: string };

export function NeedsActionView({ onOpen }: { onOpen?: (clientId: string, channel: string, campaignId: string | null) => void }) {
  const [d, setD] = useState<NeedsRead | null>(null);
  const [err, setErr] = useState("");
  const [f, setF] = useState<Filters>({ status: "all", showDone: false, metric: "all", level: "all", channel: "all", owner: "", better: false, q: "" });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [nonce, setNonce] = useState(0);
  const [run, setRun] = useState<{ done: number; total: number; errors: Array<{ id: string; msg: string }>; busy: boolean } | null>(null);
  async function computeNow(ids: string[]) {
    const st = { done: 0, total: ids.length, errors: [] as Array<{ id: string; msg: string }>, busy: true };
    setRun({ ...st });
    let next = 0;
    // One account per call, 3 calls in flight: each call stays far inside the function time limit.
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++];
        try {
          const [r] = await computeNeedsBatchFn({ data: { clientIds: [id] } });
          if (!r.ok) st.errors.push({ id, msg: r.error || "lỗi không rõ" });
        } catch (e) { st.errors.push({ id, msg: e instanceof Error ? e.message : String(e) }); }
        st.done += 1;
        setRun({ ...st, errors: [...st.errors] });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setRun({ ...st, errors: [...st.errors], busy: false });
    setNonce((n) => n + 1);
  }
  // Local status edits (key -> row fields) so the list updates without a reload.
  const [edits, setEdits] = useState<Record<string, Pick<NeedRow, "status" | "note" | "status_by" | "status_at" | "reopened">>>({});
  const withEdit = (r: NeedRow): NeedRow => (edits[r.key] ? { ...r, ...edits[r.key] } : r);
  const save = async (clientId: string, r: NeedRow, status: NeedStatus, note: string | null) => {
    const month = d?.months[2];
    if (!month) return;
    const prev = edits[r.key];
    setEdits((e) => ({ ...e, [r.key]: { status, note, status_by: r.status_by, status_at: r.status_at, reopened: false } }));
    try {
      const x = await setNeedStatusFn({ data: { clientId, level: r.level, entityId: r.entity_id, channel: r.channel, metric: r.metric, month, status, note: note ?? "" } });
      setEdits((e) => ({ ...e, [r.key]: { status: x.status, note: x.note, status_by: x.status_by, status_at: x.status_at, reopened: false } }));
    } catch (err) {
      setEdits((e) => { const n = { ...e }; if (prev) n[r.key] = prev; else delete n[r.key]; return n; });
      window.alert(err instanceof Error ? err.message : String(err));
    }
  };
  useEffect(() => {
    let live = true;
    setErr("");
    readNeedsActionFn().then((r) => live && setD(r)).catch((e: unknown) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [nonce]);

  const keep = (r: NeedRow) =>
    (f.status === "all" ? f.showDone || r.status !== "done" : r.status === f.status) &&
    (f.better ? true : r.kind === "worse") &&
    (f.metric === "all" || r.metric === f.metric) &&
    (f.channel === "all" || r.channel === f.channel) &&
    (f.level === "all" || (f.level === "group" ? r.level === "ad_group" || r.level === "asset_group" : r.level === f.level));
  const list = useMemo(() => {
    if (!d) return [];
    const q = f.q.trim().toLowerCase();
    return d.accounts
      .filter((a) => !f.owner || a.owners.includes(f.owner))
      .filter((a) => !q || a.label.toLowerCase().includes(q))
      .map((a) => { const rows = a.rows.map(withEdit).filter(keep); return { a, rows, w: rows.filter((r) => r.kind === "worse").reduce((s, r) => s + r.weight, 0) }; })
      .filter((x) => x.rows.length || x.a.error)
      .sort((x, y) => y.w - x.w || y.rows.length - x.rows.length);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, f, edits]);
  const channels = useMemo(() => [...new Set((d?.accounts || []).flatMap((a) => a.rows.map((r) => r.channel)))], [d]);
  const flip = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const sel = "rounded border border-line bg-surface px-1.5 py-1 text-xs";

  if (err) return <Card className="p-4"><p className="text-sm text-danger">{err}</p></Card>;
  if (!d) return <Card className="p-4"><p className="text-sm text-muted">Đang tải…</p></Card>;
  const th = d.thresholds;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-semibold text-ink">Cần xử lý (3 tháng)</h2>
        <span className="rounded bg-accent-soft px-1.5 text-[11px] font-semibold text-accent">Nội bộ</span>
        <span className="text-xs text-muted" title="Tính hằng đêm lúc 03:00 (giờ VN), chỉ đọc Google Ads. Trang này chỉ đọc dữ liệu đã lưu.">
          {d.months.length ? `${mL(d.months[0])} → ${mL(d.months[2])}` : ""} · cập nhật gần nhất {when(d.last_run)} (giờ VN){d.not_computed ? ` · ${d.not_computed} tài khoản chưa được tính` : ""}
        </span>
      </div>
      <p className="text-xs text-muted">
        So sánh cùng loại chiến dịch, chỉ đối tượng chạy đủ 3 tháng trọn, chuyển đổi chính. Báo khi một trong hai bước tháng (T-2→T-1, T-1→T) xấu đi hơn {Math.round(th.step * 100)}%; bỏ qua tháng dưới {th.conv} chuyển đổi hoặc dưới {th.clicks} click. Sắp xếp: mức xấu đi × chi phí tháng gần nhất.
      </p>

      <div className="grid grid-cols-2 items-center gap-2 md:flex md:flex-wrap [&>select]:max-md:h-11 [&>select]:max-md:w-full [&>select]:max-md:min-w-0 [&>label]:max-md:col-span-2 [&>label]:max-md:min-h-11">
        <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Tìm tài khoản" className={cn(sel, "w-44 max-md:col-span-2 max-md:h-11 max-md:w-full")} />
        <select value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value as Filters["metric"] })} className={sel} aria-label="Chỉ số">
          <option value="all">Mọi chỉ số</option>{(["cpc", "cpa", "cvr"] as NeedMetric[]).map((m) => <option key={m} value={m}>{MET_LABEL[m]}</option>)}
        </select>
        <select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value as Filters["level"] })} className={sel} aria-label="Cấp">
          <option value="all">Mọi cấp</option><option value="account">Tài khoản</option><option value="campaign">Chiến dịch</option><option value="group">Nhóm QC / nhóm tài sản</option>
        </select>
        <select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value as Filters["channel"] })} className={sel} aria-label="Loại chiến dịch">
          <option value="all">Mọi loại chiến dịch</option>{channels.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
        </select>
        {d.can_filter_owner ? (
          <select value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} className={sel} aria-label="Người phụ trách">
            <option value="">Mọi người phụ trách</option>{d.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        ) : null}
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Filters["status"] })} className={sel} aria-label="Trạng thái">
          <option value="all">Mọi trạng thái</option>{(["new", "doing", "done"] as NeedStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        {f.status === "all" ? <label className="inline-flex items-center gap-1 text-xs text-muted" title="Dòng Đã xử lý chỉ hiện lại khi tháng mới bị gắn cờ, hoặc chỉ số xấu thêm vượt ngưỡng so với lúc đánh dấu."><input type="checkbox" checked={f.showDone} onChange={(e) => setF({ ...f, showDone: e.target.checked })} /> Hiện cả Đã xử lý</label> : null}
        <label className="inline-flex items-center gap-1 text-xs text-muted"><input type="checkbox" checked={f.better} onChange={(e) => setF({ ...f, better: e.target.checked })} /> Hiện cả cải thiện &gt; {Math.round(th.step * 100)}%</label>
        <span className="ml-auto text-xs text-muted">{list.length} tài khoản</span>
      </div>

      {d.can_compute ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button type="button" disabled={run?.busy || !d.stale_ids.length} onClick={() => void computeNow(d.stale_ids)}
            title="Chỉ Admin. Tính ngay (chỉ đọc Google Ads) các tài khoản trong phạm vi đang xem chưa được tính hoặc đã cũ hơn 20 giờ, gồm cả cấp nhóm."
            className="rounded-md bg-accent px-3 py-1.5 font-medium text-white disabled:opacity-50">
            Tính ngay{d.stale_ids.length ? ` (${d.stale_ids.length} tài khoản)` : ""}
          </button>
          {run ? <span className="text-muted">{run.busy ? "Đang tính" : "Xong"} {run.done}/{run.total}{run.errors.length ? ` · ${run.errors.length} lỗi` : ""}</span> : null}
          {!d.stale_ids.length && !run ? <span className="text-muted">Mọi tài khoản trong phạm vi đã được tính trong 20 giờ qua.</span> : null}
        </div>
      ) : null}
      {run?.errors.length ? (
        <ul className="rounded-lg border border-danger/30 bg-danger-bg/40 px-3 py-2 text-xs text-danger">
          {run.errors.map((e) => <li key={e.id}><b>{d.accounts.find((a) => a.client_id === e.id)?.label || e.id}:</b> {e.msg}</li>)}
        </ul>
      ) : null}
      {d.can_edit_settings ? <Settings th={th} onSaved={() => setNonce((n) => n + 1)} /> : null}

      {!list.length ? (
        <Card className="p-6 text-center text-sm text-muted">
          Không có gì cần xử lý theo bộ lọc hiện tại.
          {d.computed_ok ? <span className="block text-xs">{d.computed_ok} tài khoản đã tính, không có chỉ số nào vượt ngưỡng (hoặc ít dữ liệu / không có chiến dịch chạy đủ 3 tháng).</span> : null}
          {d.not_computed ? <span className="block text-xs">{d.not_computed} tài khoản chưa được tính{d.can_compute ? ": bấm Tính ngay." : " (chạy hằng đêm 03:00)."}</span> : null}
        </Card>
      ) : null}
      {list.map(({ a, rows }) => <AccountBlock key={a.client_id} a={a} all={a.rows.map(withEdit)} canUpdate={d.can_update_status} onStatus={(r, s, n) => void save(a.client_id, r, s, n)} rows={rows} months={d.months} th={th.step} open={open.has(a.client_id)} toggle={() => flip(a.client_id)} onOpen={onOpen} />)}
    </section>
  );
}

function AccountBlock({ a, all, canUpdate, onStatus, rows, months, th, open, toggle, onOpen }: { a: NeedAccount; all: NeedRow[]; canUpdate: boolean; onStatus: (r: NeedRow, s: NeedStatus, note: string | null) => void; rows: NeedRow[]; months: string[]; th: number; open: boolean; toggle: () => void; onOpen?: (clientId: string, channel: string, campaignId: string | null) => void }) {
  const worse = rows.filter((r) => r.kind === "worse").length;
  const acct = rows.filter((r) => r.level === "account");
  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={toggle} className="flex w-full flex-wrap items-center gap-2 px-4 py-2.5 text-left hover:bg-row-hover">
        <span className="w-4 text-muted">{open ? "▾" : "▸"}</span>
        <span className="font-medium text-ink">{a.label}</span>
        {worse ? <span className="rounded bg-danger-bg px-1.5 text-[11px] font-medium text-danger">{worse} xấu đi</span> : null}
        {rows.length - worse ? <span className="rounded bg-accent-soft px-1.5 text-[11px] text-accent">{rows.length - worse} cải thiện</span> : null}
        {(["new", "doing", "done"] as NeedStatus[]).map((s) => { const n = all.filter((r) => r.status === s && r.kind === "worse").length; return n ? <span key={s} className={cn("rounded px-1.5 text-[11px]", s === "new" ? "bg-line text-ink" : s === "doing" ? "bg-warn-bg text-warn" : "bg-accent-soft text-accent")}>{STATUS_LABEL[s]} {n}</span> : null; })}
        {acct.length ? <span className="text-[11px] text-muted">Toàn tài khoản: {acct.map((r) => `${CHANNEL_LABEL[r.channel]} ${MET_LABEL[r.metric]}`).join(", ")}</span> : null}
        {a.error ? <span className="rounded bg-danger-bg px-1.5 text-[11px] text-danger" title={a.error}>lỗi khi tính</span> : null}
        {a.entity_error ? <span className="rounded bg-warn-bg px-1.5 text-[11px] text-warn" title={a.entity_error}>thiếu cấp nhóm</span> : null}
        <span className="ml-auto text-[11px] text-subtle">Tính lúc {when(a.computed_at)}</span>
      </button>
      {open ? (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-xs">
            <thead className="bg-row-hover text-muted">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Cấp · Tên</th>
                <th className="px-2 text-left font-medium">Loại</th>
                <th className="px-2 text-left font-medium">Chỉ số</th>
                {months.map((m) => <th key={m} className="px-2 text-right font-medium">{mL(m)}</th>)}
                <th className="px-2 text-right font-medium" title="T-2→T-1">Bước 1</th>
                <th className="px-2 text-right font-medium" title="T-1→T">Bước 2</th>
                <th className="px-2 text-right font-medium" title={`Chi phí ${months[2] ? mL(months[2]) : ""}`}>Chi phí</th>
                <th className="px-2 text-left font-medium">Chẩn đoán</th>
                <th className="px-2 text-left font-medium">Trạng thái · ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={`${r.level}${r.entity_id}${r.metric}`}>
                  <tr className={cn("border-t border-line", onOpen && "cursor-pointer hover:bg-row-hover")} onClick={() => onOpen?.(a.client_id, r.channel, r.level === "campaign" ? r.entity_id : r.campaign_id)} title={onOpen ? "Mở tài khoản tại bảng xu hướng" : undefined}>
                    <td className="max-w-[320px] px-3 py-1.5">
                      <span className="text-[10px] text-subtle">{LEVEL_LABEL[r.level]}</span>
                      <span className="block truncate text-ink" title={r.name}>{r.name}</span>
                      {r.campaign_name ? <span className="block truncate text-[10px] text-subtle" title={r.campaign_name}>trong {r.campaign_name}</span> : null}
                    </td>
                    <td className="px-2">{CHANNEL_LABEL[r.channel] ?? r.channel}</td>
                    <td className="px-2 whitespace-nowrap">{MET_LABEL[r.metric]}</td>
                    {r.values.map((v, i) => <td key={i} className={cn("whitespace-nowrap px-2 text-right tabular-nums", r.low[i] && "text-subtle")} title={r.low[i] ? "ít dữ liệu" : undefined}>{val(r.metric, v)}{r.low[i] ? <span className="block text-[9px]">ít dữ liệu</span> : null}</td>)}
                    <td className="px-2 text-right"><Step s={r.steps[0]} upBad={r.metric !== "cvr"} th={th} /></td>
                    <td className="px-2 text-right"><Step s={r.steps[1]} upBad={r.metric !== "cvr"} th={th} /></td>
                    <td className="whitespace-nowrap px-2 text-right tabular-nums">{r.spend == null ? "-" : dong(r.spend)}</td>
                    <td className="px-2 text-[11px] text-ink">{r.diag ?? <span className="text-subtle">-</span>}</td>
                    <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}><StatusCell r={r} canUpdate={canUpdate} onStatus={onStatus} /></td>
                  </tr>
                </Fragment>
              ))}
              {!rows.length ? <tr><td colSpan={11} className="px-3 py-2 text-muted">Không có dòng nào theo bộ lọc{a.error ? `: ${a.error}` : ""}.</td></tr> : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}

function Settings({ th, onSaved }: { th: NeedThresholds; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ step: String(Math.round(th.step * 100)), conv: String(th.conv), clicks: String(th.clicks) });
  const [msg, setMsg] = useState("");
  const save = async () => {
    setMsg("");
    try {
      await saveNeedThresholdsFn({ data: { step: Number(v.step) / 100, conv: Number(v.conv), clicks: Number(v.clicks) } });
      setMsg("Đã lưu."); onSaved();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  const inp = "w-16 rounded border border-line bg-surface px-1 py-0.5 text-right text-xs";
  return (
    <div className="rounded-lg border border-line bg-paper px-3 py-2 text-xs">
      <button type="button" onClick={() => setOpen(!open)} className="font-medium text-ink" title="Chỉ Admin">{open ? "▾" : "▸"} Ngưỡng (Admin)</button>
      {open ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label>Mức thay đổi &gt; <input className={inp} value={v.step} onChange={(e) => setV({ ...v, step: e.target.value })} inputMode="decimal" />%</label>
          <label>Ít dữ liệu: &lt; <input className={inp} value={v.conv} onChange={(e) => setV({ ...v, conv: e.target.value })} inputMode="numeric" /> chuyển đổi</label>
          <label>hoặc &lt; <input className={inp} value={v.clicks} onChange={(e) => setV({ ...v, clicks: e.target.value })} inputMode="numeric" /> click</label>
          <button type="button" onClick={() => void save()} className="rounded-md bg-accent px-2.5 py-1 font-medium text-white">Lưu</button>
          {msg ? <span className="text-muted">{msg}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function StatusCell({ r, canUpdate, onStatus }: { r: NeedRow; canUpdate: boolean; onStatus: (r: NeedRow, s: NeedStatus, note: string | null) => void }) {
  const [note, setNote] = useState(r.note ?? "");
  useEffect(() => setNote(r.note ?? ""), [r.note]);
  const who = r.status_at ? `${r.status_by ? `${r.status_by} · ` : ""}${when(r.status_at)} (giờ VN)` : "";
  const commit = () => { const n = note.trim() || null; if (n !== (r.note ?? null)) onStatus(r, r.status, n); };
  return (
    <div className="flex min-w-[220px] flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <select disabled={!canUpdate} value={r.status} onChange={(e) => onStatus(r, e.target.value as NeedStatus, note.trim() || null)} title={canUpdate ? undefined : "Đang Xem như: chỉ xem"}
          className={cn("rounded border px-1 py-0.5 text-[11px]", r.status === "done" ? "border-accent text-accent" : r.status === "doing" ? "border-warn text-warn" : "border-line text-ink")}>
          {(["new", "doing", "done"] as NeedStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        {r.reopened ? <span className="rounded bg-danger-bg px-1 text-[10px] text-danger" title="Đã đánh dấu Đã xử lý nhưng chỉ số xấu thêm vượt ngưỡng so với lúc đó">xấu thêm</span> : null}
      </div>
      <input disabled={!canUpdate} value={note} maxLength={500} placeholder="Ghi chú ngắn" onChange={(e) => setNote(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-full rounded border border-line bg-surface px-1 py-0.5 text-[11px]" />
      {who ? <span className="text-[10px] text-subtle" title="Người / lúc cập nhật gần nhất">{who}</span> : null}
    </div>
  );
}
