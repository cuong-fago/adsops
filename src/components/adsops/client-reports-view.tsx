import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, FileText, Link2, RefreshCw, Trash2 } from "lucide-react";
import {
  createClientReportFn, listClientReportsFn, readClientReportFn, setReportScheduleFn, updateClientReportFn,
  type ReportListRow, type ReportNotes, type ReportOptions, type ScopeOption,
} from "@/lib/adsops/client-report.functions";
import { STATUS_VI } from "@/lib/adsops/client-report.types";
import { cn } from "@/lib/cn";
import { ScopeCombobox, pushRecent } from "@/components/adsops/scope-combobox";
import { Badge, Card, EmptyState } from "@/components/adsops/ui";

const dmy = (s: string) => s.split("-").reverse().join("/");
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));
const btn = "inline-flex h-8 items-center gap-1 rounded-md border border-line bg-paper px-2.5 text-sm hover:bg-inset disabled:opacity-60";
const primary = "inline-flex h-8 items-center gap-1 rounded-md bg-accent px-3 text-sm font-medium text-white disabled:opacity-60";
const inp = "h-9 rounded-md border border-line bg-paper px-2 text-sm";

function vnToday(): string { return new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); }
function addDays(s: string, n: number): string { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function lastWeekStart(): string { const t = vnToday(); const dow = (new Date(`${t}T00:00:00Z`).getUTCDay() + 6) % 7; return addDays(t, -dow - 7); }
function lastMonth(): string { const t = vnToday(); let [y, m] = t.split("-").map(Number); m -= 1; if (!m) { m = 12; y -= 1; } return `${y}-${String(m).padStart(2, "0")}`; }
function monthEnd(m: string): string { const [y, mo] = m.split("-").map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`; }

function Builder({ scopes, canWrite, onCreated }: { scopes: ScopeOption[]; canWrite: boolean; onCreated: (id: number) => void }) {
  const [scope, setScope] = useState(scopes[0] ? `${scopes[0].kind}:${scopes[0].id}` : "");
  const [kind, setKind] = useState<"week" | "month" | "custom">("month");
  const [week, setWeek] = useState(lastWeekStart());
  const [month, setMonth] = useState(lastMonth());
  const [from, setFrom] = useState(addDays(vnToday(), -30));
  const [to, setTo] = useState(addDays(vnToday(), -1));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const cur = scopes.find((s) => `${s.kind}:${s.id}` === scope);
  const range = kind === "week" ? { start: week, end: addDays(week, 6) } : kind === "month" ? { start: `${month}-01`, end: monthEnd(month) } : { start: from, end: to };
  async function create() {
    if (!cur) return;
    setBusy(true); setMsg("");
    try { const r = await createClientReportFn({ data: { scopeKind: cur.kind, scopeId: cur.id, period: kind, ...range } }); pushRecent(`${cur.kind}:${cur.id}`); onCreated(r.id); }
    catch (e) { setMsg(err(e)); } finally { setBusy(false); }
  }
  async function schedule(freq: string) {
    if (!cur) return;
    setMsg("");
    try { await setReportScheduleFn({ data: { scopeKind: cur.kind, scopeId: cur.id, freq: freq || null } }); cur.schedule = (freq || null) as ScopeOption["schedule"]; setMsg(freq ? "Đã bật tạo bản nháp tự động." : "Đã tắt tạo tự động."); }
    catch (e) { setMsg(err(e)); }
  }
  return (
    <Card className="p-4">
      <h3 className="font-display text-lg font-semibold">Tạo báo cáo khách hàng</h3>
      <p className="text-xs text-muted">Gộp Facebook + Google + ChatGPT Ads. Số liệu lấy từ dữ liệu AdsOps đã lưu (chỉ đọc), tóm tắt sinh theo mẫu cố định — không tự bịa số.</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted" title="Khách hàng = nhóm tài khoản trong Quản trị → Khách hàng (chỉ hiện khi bạn được giao toàn bộ tài khoản của khách).">Khách hàng / tài khoản<br />
          <ScopeCombobox scopes={scopes} value={scope} onChange={setScope} />
        </label>
        <label className="text-xs text-muted">Kỳ báo cáo<br />
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={inp}><option value="week">Tuần</option><option value="month">Tháng</option><option value="custom">Tuỳ chọn</option></select>
        </label>
        {kind === "week" ? <label className="text-xs text-muted" title="Tuần thứ Hai – Chủ nhật">Từ thứ Hai<br /><input type="date" value={week} onChange={(e) => setWeek(e.target.value)} className={inp} /></label> : null}
        {kind === "month" ? <label className="text-xs text-muted">Tháng<br /><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inp} /></label> : null}
        {kind === "custom" ? <><label className="text-xs text-muted">Từ<br /><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inp} /></label><label className="text-xs text-muted">Đến<br /><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inp} /></label></> : null}
        <button type="button" disabled={busy || !cur || !canWrite} onClick={() => void create()} className={primary}><FileText className="size-3.5" /> {busy ? "Đang tạo…" : "Tạo báo cáo"}</button>
        {cur ? (
          <label className="ml-auto text-xs text-muted" title="Cron hằng ngày tạo BẢN NHÁP cho kỳ vừa kết thúc; số liệu được tính khi mở. Không tự gửi cho khách.">Tạo nháp tự động<br />
            <select value={cur.schedule || ""} disabled={!canWrite} onChange={(e) => void schedule(e.target.value)} className={inp}><option value="">Không</option><option value="weekly">Hàng tuần</option><option value="monthly">Hàng tháng</option></select>
          </label>
        ) : null}
      </div>
      {kind !== "month" ? <p className="mt-1 text-[11px] text-subtle">Lead hợp lệ / khách chốt / doanh thu chỉ hiện ở báo cáo trọn tháng (số liệu nhập theo tháng).</p> : null}
      {msg ? <p className="mt-1 text-xs text-warn">{msg}</p> : null}
    </Card>
  );
}

function Editor({ id, canWrite, onChanged, onClose }: { id: number; canWrite: boolean; onChanged: () => void; onClose: () => void }) {
  const [row, setRow] = useState<ReportListRow | null>(null);
  const [notes, setNotes] = useState<ReportNotes>({});
  const [opt, setOpt] = useState<ReportOptions>({});
  const [epoch, setEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [link, setLink] = useState<{ url: string; expires: string } | null>(null);
  const [days, setDays] = useState("30");
  useEffect(() => {
    let live = true;
    setLink(null);
    readClientReportFn({ data: { id } }).then((r) => { if (!live) return; setRow(r.row); setNotes(r.notes); setOpt(r.options); }).catch((e) => setMsg(err(e)));
    return () => { live = false; };
  }, [id, epoch]);
  async function act(action: string, extra: Record<string, unknown> = {}, reload = true) {
    setBusy(true); setMsg("");
    try {
      const r = await updateClientReportFn({ data: { id, action, notes, options: opt, ...extra } });
      if (r.token) setLink({ url: `${window.location.origin}/api/client-report?t=${r.token}`, expires: r.expires_at || "" });
      if (action === "delete") { onChanged(); onClose(); return; }
      if (reload) setEpoch((n) => n + 1);
      onChanged();
    } catch (e) { setMsg(err(e)); } finally { setBusy(false); }
  }
  if (!row) return <Card className="p-4"><p className="text-sm text-muted">{msg || "Đang mở báo cáo…"}</p></Card>;
  const src = `/api/client-report?id=${id}&v=${epoch}`;
  const ta = "mt-1 h-28 w-full rounded-md border border-line bg-paper p-2 text-sm";
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-lg font-semibold">{row.title}</h3>
        <Badge tone={row.status === "sent" ? "ok" : "warn"}>{STATUS_VI[row.status]}</Badge>
        {row.auto ? <Badge tone="neutral" dot={false}>Tự động</Badge> : null}
        <button type="button" onClick={onClose} className="ml-auto text-sm text-muted hover:text-ink">Đóng</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <a href={src} target="_blank" rel="noopener" className={btn}><ExternalLink className="size-3.5" /> Mở bản in / Lưu PDF</a>
        <button type="button" disabled={busy || !canWrite} onClick={() => void act("regenerate")} className={btn} title="Tính lại số liệu từ dữ liệu mới nhất (ghi chú đã sửa được giữ nguyên)"><RefreshCw className="size-3.5" /> Tạo lại số liệu</button>
        {row.status === "draft"
          ? <button type="button" disabled={busy || !canWrite} onClick={() => void act("sent")} className={primary} title="Đánh dấu thủ công sau khi đã gửi link / PDF cho khách. Khách đăng nhập sẽ thấy báo cáo này trong cổng khách hàng.">Đánh dấu đã gửi</button>
          : <button type="button" disabled={busy || !canWrite} onClick={() => void act("draft")} className={btn}>Chuyển về nháp</button>}
        <button type="button" disabled={busy || !canWrite} onClick={() => { if (window.confirm("Xoá báo cáo này? Các link chia sẻ cũng mất hiệu lực.")) void act("delete"); }} className={cn(btn, "text-danger")}><Trash2 className="size-3.5" /> Xoá</button>
      </div>
      {msg ? <p className="mt-2 text-xs text-danger">{msg}</p> : null}
      <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold">Nhận xét của trưởng nhóm</p>
            <p className="text-[11px] text-subtle">Gợi ý tự điền từ cảnh báo (mỏi quảng cáo, mất IS do ngân sách, QS thấp, tiến độ ngân sách) — sửa tuỳ ý rồi Lưu.</p>
            <label className="mt-2 block text-xs text-muted">Điểm tốt<textarea value={notes.good || ""} onChange={(e) => setNotes({ ...notes, good: e.target.value })} className={ta} /></label>
            <label className="block text-xs text-muted">Vấn đề<textarea value={notes.issues || ""} onChange={(e) => setNotes({ ...notes, issues: e.target.value })} className={ta} /></label>
            <label className="block text-xs text-muted">Kế hoạch kỳ tới<textarea value={notes.plan || ""} onChange={(e) => setNotes({ ...notes, plan: e.target.value })} className={ta} /></label>
            <button type="button" disabled={busy || !canWrite} onClick={() => void act("notes")} className={cn(primary, "mt-1")}>Lưu nhận xét</button>
          </div>
          <div className="space-y-1 border-t border-line pt-3 text-sm">
            <label className="flex items-center gap-2" title="Từ khoá / phủ định đã thêm (Nhật ký tối ưu) và tiết kiệm ước tính"><input type="checkbox" checked={opt.show_work !== false} disabled={!canWrite} onChange={(e) => { const o = { ...opt, show_work: e.target.checked }; setOpt(o); void updateClientReportFn({ data: { id, action: "options", options: o } }).then(() => setEpoch((n) => n + 1)); }} /> Hiện mục “Việc đã làm”</label>
            <label className="flex items-center gap-2" title="CPM, CTR, CPC, IS, QS"><input type="checkbox" checked={opt.show_appendix === true} disabled={!canWrite} onChange={(e) => { const o = { ...opt, show_appendix: e.target.checked }; setOpt(o); void updateClientReportFn({ data: { id, action: "options", options: o } }).then(() => setEpoch((n) => n + 1)); }} /> Hiện phụ lục chỉ số</label>
          </div>
          <div className="border-t border-line pt-3">
            <p className="text-sm font-semibold">Link chia sẻ (chỉ xem)</p>
            <p className="text-[11px] text-subtle">Chỉ mở đúng báo cáo này, hết hạn tự động, thu hồi được. AdsOps không tự gửi email — hãy sao chép link gửi khách.</p>
            <div className="mt-2 flex items-center gap-2">
              <label className="text-xs text-muted">Hết hạn sau <input value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} className={cn(inp, "w-16")} /> ngày</label>
              <button type="button" disabled={busy || !canWrite} onClick={() => void act("link", { days: Number(days) || 30 })} className={btn}><Link2 className="size-3.5" /> Tạo link</button>
            </div>
            {link ? (
              <div className="mt-2 rounded-md border border-accent-border bg-accent-soft p-2 text-xs">
                <p className="break-all font-mono">{link.url}</p>
                <div className="mt-1 flex items-center gap-2">
                  <button type="button" onClick={() => void navigator.clipboard.writeText(link.url).then(() => setMsg(""))} className={btn}><Copy className="size-3.5" /> Sao chép</button>
                  <span className="text-muted">Hết hạn {new Date(link.expires).toLocaleDateString("vi-VN")}. Link chỉ hiện một lần.</span>
                </div>
              </div>
            ) : null}
            {row.links.length ? (
              <ul className="mt-2 space-y-1 text-xs">
                {row.links.map((l) => (
                  <li key={l.id} className="flex items-center gap-2">
                    <span className={cn(l.revoked || new Date(l.expires_at) < new Date() ? "text-subtle line-through" : "")}>Link #{l.id} · hết hạn {new Date(l.expires_at).toLocaleDateString("vi-VN")} · {l.views} lượt xem</span>
                    {!l.revoked && new Date(l.expires_at) > new Date() ? <button type="button" disabled={busy || !canWrite} onClick={() => void act("revoke", { linkId: l.id })} className="text-danger hover:underline">Thu hồi</button> : <span className="text-subtle">{l.revoked ? "đã thu hồi" : "hết hạn"}</span>}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        <iframe key={src} src={src} title="Xem trước báo cáo" className="h-[900px] w-full rounded-md border border-line bg-white" />
      </div>
    </Card>
  );
}

/** "Báo cáo khách hàng" tab (staff: Admin, Trưởng phòng Ads, người tối ưu được giao). */
export function ClientReportsView() {
  const [data, setData] = useState<Awaited<ReturnType<typeof listClientReportsFn>> | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "draft" | "sent">("all");
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let live = true;
    listClientReportsFn().then((r) => { if (live) { setData(r); setError(""); } }).catch((e) => { if (live) setError(err(e)); });
    return () => { live = false; };
  }, [epoch]);
  const scopeLabel = useMemo(() => new Map((data?.scopes || []).map((s) => [`${s.kind}:${s.id}`, s.label])), [data]);
  if (error) return <EmptyState title={error} />;
  if (!data) return <p className="px-1 py-16 text-center text-sm text-muted">Đang tải…</p>;
  const list = data.reports.filter((r) => filter === "all" || r.status === filter);
  return (
    <div className="space-y-4">
      {data.drafts ? <div className="rounded-md border border-warn/40 bg-warn-bg px-3 py-2 text-sm text-warn">Có {data.drafts} báo cáo nháp cần duyệt. Mở, kiểm tra nhận xét rồi gửi link cho khách và bấm “Đánh dấu đã gửi”.</div> : null}
      <Builder scopes={data.scopes} canWrite={data.can_write} onCreated={(id) => { setOpen(id); setEpoch((n) => n + 1); }} />
      {open != null ? <Editor id={open} canWrite={data.can_write} onChanged={() => setEpoch((n) => n + 1)} onClose={() => setOpen(null)} /> : null}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-lg font-semibold">Báo cáo đã lưu</h3>
          <span className="ml-auto flex gap-1">
            {(["all", "draft", "sent"] as const).map((f) => <button key={f} type="button" onClick={() => setFilter(f)} className={cn("h-7 rounded-md px-2.5 text-xs", filter === f ? "bg-accent text-white" : "border border-line bg-paper")}>{f === "all" ? "Tất cả" : STATUS_VI[f]}</button>)}
          </span>
        </div>
        {!list.length ? <p className="mt-3 text-sm text-muted">Chưa có báo cáo.</p> : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="py-1.5">Báo cáo</th><th>Kỳ</th><th>Trạng thái</th><th>Link</th><th>Cập nhật</th><th /></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className={cn("border-t border-line/60", open === r.id && "bg-inset")}>
                    <td className="py-1.5">{r.title}<span className="block text-[11px] text-subtle">{scopeLabel.get(`${r.scope_kind}:${r.scope_id}`) ? (r.scope_kind === "group" ? "Khách hàng" : "Tài khoản") : ""}{r.auto ? " · tự động" : ""}{!r.generated ? " · chưa tính số liệu" : ""}</span></td>
                    <td className="whitespace-nowrap">{dmy(r.start_date)} – {dmy(r.end_date)}</td>
                    <td><Badge tone={r.status === "sent" ? "ok" : "warn"}>{STATUS_VI[r.status]}</Badge>{r.sent_at ? <span className="block text-[11px] text-subtle">{new Date(r.sent_at).toLocaleDateString("vi-VN")}</span> : null}</td>
                    <td className="text-xs text-muted">{r.links.filter((l) => !l.revoked && new Date(l.expires_at) > new Date()).length || "—"}</td>
                    <td className="whitespace-nowrap text-xs text-muted">{r.updated_at ? new Date(r.updated_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "—"}</td>
                    <td><button type="button" onClick={() => { pushRecent(`${r.scope_kind}:${r.scope_id}`); setOpen(r.id); }} className={btn}>Mở</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
