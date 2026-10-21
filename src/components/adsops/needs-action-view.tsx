import { Fragment, useEffect, useMemo, useState } from "react";
import { readNeedsActionFn, saveNeedThresholdsFn } from "@/lib/adsops/connect.functions";
import { CHANNEL_LABEL, type ChannelKey } from "@/lib/adsops/google-trend.types";
import type { NeedAccount, NeedLevel, NeedMetric, NeedRow, NeedsRead, NeedThresholds } from "@/lib/adsops/needs-action.types";
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

type Filters = { metric: NeedMetric | "all"; level: "all" | "account" | "campaign" | "group"; channel: ChannelKey | "all"; owner: string; better: boolean; q: string };

export function NeedsActionView({ onOpen }: { onOpen?: (clientId: string, channel: string, campaignId: string | null) => void }) {
  const [d, setD] = useState<NeedsRead | null>(null);
  const [err, setErr] = useState("");
  const [f, setF] = useState<Filters>({ metric: "all", level: "all", channel: "all", owner: "", better: false, q: "" });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    setErr("");
    readNeedsActionFn().then((r) => live && setD(r)).catch((e: unknown) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [nonce]);

  const keep = (r: NeedRow) =>
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
      .map((a) => { const rows = a.rows.filter(keep); return { a, rows, w: rows.filter((r) => r.kind === "worse").reduce((s, r) => s + r.weight, 0) }; })
      .filter((x) => x.rows.length || x.a.error)
      .sort((x, y) => y.w - x.w || y.rows.length - x.rows.length);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, f]);
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

      <div className="flex flex-wrap items-center gap-2">
        <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Tìm tài khoản" className={cn(sel, "w-44")} />
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
        <label className="inline-flex items-center gap-1 text-xs text-muted"><input type="checkbox" checked={f.better} onChange={(e) => setF({ ...f, better: e.target.checked })} /> Hiện cả cải thiện &gt; {Math.round(th.step * 100)}%</label>
        <span className="ml-auto text-xs text-muted">{list.length} tài khoản</span>
      </div>

      {d.can_edit_settings ? <Settings th={th} onSaved={() => setNonce((n) => n + 1)} /> : null}

      {!list.length ? <Card className="p-6 text-center text-sm text-muted">Không có gì cần xử lý theo bộ lọc hiện tại.</Card> : null}
      {list.map(({ a, rows }) => <AccountBlock key={a.client_id} a={a} rows={rows} months={d.months} th={th.step} open={open.has(a.client_id)} toggle={() => flip(a.client_id)} onOpen={onOpen} />)}
    </section>
  );
}

function AccountBlock({ a, rows, months, th, open, toggle, onOpen }: { a: NeedAccount; rows: NeedRow[]; months: string[]; th: number; open: boolean; toggle: () => void; onOpen?: (clientId: string, channel: string, campaignId: string | null) => void }) {
  const worse = rows.filter((r) => r.kind === "worse").length;
  const acct = rows.filter((r) => r.level === "account");
  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={toggle} className="flex w-full flex-wrap items-center gap-2 px-4 py-2.5 text-left hover:bg-row-hover">
        <span className="w-4 text-muted">{open ? "▾" : "▸"}</span>
        <span className="font-medium text-ink">{a.label}</span>
        {worse ? <span className="rounded bg-danger-bg px-1.5 text-[11px] font-medium text-danger">{worse} xấu đi</span> : null}
        {rows.length - worse ? <span className="rounded bg-accent-soft px-1.5 text-[11px] text-accent">{rows.length - worse} cải thiện</span> : null}
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
                  </tr>
                </Fragment>
              ))}
              {!rows.length ? <tr><td colSpan={10} className="px-3 py-2 text-muted">Không có dòng nào theo bộ lọc{a.error ? `: ${a.error}` : ""}.</td></tr> : null}
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
