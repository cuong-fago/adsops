import { useEffect, useMemo, useState } from "react";
import { Download, Pencil, Upload, X } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { importOutcomesFn, readBusinessFn, saveOutcomeFn, type BizMetrics, type BizRead, type ImportResult, type ImportRowIn } from "@/lib/adsops/outcomes.functions";
import { TEMPLATE_COLUMNS } from "@/lib/adsops/outcomes.types";
import { moneyPlain, num } from "@/lib/adsops/format";
import { cn } from "@/lib/cn";
import { Card } from "@/components/adsops/ui";

const NONE = "Chưa nhập số liệu";
const dong = (v: number | null | undefined) => (v == null ? "—" : `${moneyPlain(Math.round(v))}đ`);
const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const times = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)}×`);
const monthVi = (m: string) => `${m.slice(5)}/${m.slice(0, 4)}`;

function Stat({ label, value, hint, cls }: { label: string; value: string; hint?: string; cls?: string }) {
  return <div title={hint}><p className="text-xs text-muted underline decoration-dotted decoration-line underline-offset-2">{label}</p><p className={cn("font-semibold tabular-nums", cls)}>{value}</p></div>;
}
const good = (ok: boolean | null) => (ok == null ? undefined : ok ? "text-ok" : "text-danger");

/** Metric grid for one month (account or blended group). */
function Metrics({ m, t, blended }: { m: BizMetrics; t: BizRead["targets"]; blended?: boolean }) {
  const p = blended ? "Blended " : "";
  return (
    <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      <Stat label="Chi tiêu" value={dong(m.spend)} hint="Chi tiêu tháng từ dữ liệu quảng cáo đã lưu." />
      <Stat label="Lead nền tảng" value={m.platform_leads != null ? num(m.platform_leads, 0) : "—"} hint="Google: chuyển đổi; Facebook: lead (không có thì tin nhắn)." />
      <Stat label={`${p}CPL`} value={dong(m.platform_cpl)} hint={`Chi tiêu ÷ lead nền tảng.${t?.target_cpl != null ? ` Mục tiêu ${dong(t.target_cpl)}.` : ""}`} cls={good(m.platform_cpl != null && t?.target_cpl != null ? m.platform_cpl <= t.target_cpl : null)} />
      <Stat label="Lead hợp lệ" value={m.valid_leads != null ? num(m.valid_leads, 0) : "—"} hint="Số lead đội sale xác nhận hợp lệ (nhập tay / tải file)." />
      <Stat label="Tỷ lệ lead hợp lệ" value={pct(m.valid_rate)} hint="Lead hợp lệ ÷ lead nền tảng." />
      <Stat label={`${p}Chi phí / lead hợp lệ`} value={dong(m.cost_per_valid)} hint="Chi tiêu ÷ lead hợp lệ." />
      <Stat label="Khách chốt" value={m.closed != null ? num(m.closed, 0) : "—"} />
      <Stat label="Tỷ lệ chốt" value={pct(m.close_rate)} hint="Khách chốt ÷ lead hợp lệ." />
      <Stat label="CAC" value={dong(m.cac)} hint={`Chi tiêu ÷ khách chốt.${t?.target_cac != null ? ` Mục tiêu ${dong(t.target_cac)}.` : ""}`} cls={good(m.cac != null && t?.target_cac != null ? m.cac <= t.target_cac : null)} />
      <Stat label="Doanh thu" value={dong(m.revenue)} />
      <Stat label="ROAS thực" value={times(m.roas)} hint={`Doanh thu ÷ chi tiêu.${t?.target_roas != null ? ` Mục tiêu ${times(t.target_roas)}.` : ""}`} cls={good(m.roas != null && t?.target_roas != null ? m.roas >= t.target_roas : null)} />
      <Stat label="ROI" value={m.roi != null ? `${m.roi > 0 ? "+" : ""}${Math.round(m.roi * 100)}%` : "—"} hint="(Doanh thu − chi tiêu) ÷ chi tiêu." cls={m.roi != null ? (m.roi >= 0 ? "text-ok" : "text-danger") : undefined} />
    </div>
  );
}

function Trend({ series }: { series: BizMetrics[] }) {
  const data = series.map((m) => ({ m: monthVi(m.month), spend: m.spend, revenue: m.revenue, roas: m.roas }));
  if (!series.some((m) => m.has_outcome)) return null;
  return (
    <div className="mt-3 h-56" title="Chi tiêu, doanh thu (trục trái) và ROAS thực (trục phải) theo tháng; tháng chưa nhập số liệu bỏ trống.">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line, #e5e7eb)" />
          <XAxis dataKey="m" tick={{ fontSize: 11 }} />
          <YAxis yAxisId="v" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${Math.round(v / 1e6)}tr`} width={44} />
          <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} width={36} />
          <Tooltip formatter={(v: unknown, n: unknown) => (v == null ? "—" : n === "ROAS thực" ? times(Number(v)) : dong(Number(v)))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line yAxisId="v" dataKey="spend" name="Chi tiêu" stroke="#94a3b8" connectNulls={false} dot />
          <Line yAxisId="v" dataKey="revenue" name="Doanh thu" stroke="#16a34a" connectNulls={false} dot />
          <Line yAxisId="r" dataKey="roas" name="ROAS thực" stroke="#2563eb" connectNulls={false} dot />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Editor({ data, month, onDone }: { data: BizRead; month: string; onDone: () => void }) {
  const [m, setM] = useState(month);
  const [campaign, setCampaign] = useState("");
  const cur = data.entries.find((e) => e.month === m && e.campaign === campaign.trim());
  const [v, setV] = useState(""); const [c, setC] = useState(""); const [r, setR] = useState(""); const [note, setNote] = useState("");
  useEffect(() => {
    setV(cur?.valid_leads != null ? String(cur.valid_leads) : ""); setC(cur?.closed_customers != null ? String(cur.closed_customers) : "");
    setR(cur?.revenue != null ? String(cur.revenue) : ""); setNote(cur?.note || "");
  }, [m, campaign, cur?.updated_at]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function run(action: "save" | "delete") {
    setBusy(true); setErr("");
    try { await saveOutcomeFn({ data: { clientId: data.client_id, month: m, campaign: campaign.trim(), validLeads: v, closed: c, revenue: r, note, action } }); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const inp = "h-9 w-full rounded-md border border-line bg-paper px-2 text-sm tabular-nums";
  return (
    <div className="mt-3 grid gap-2 rounded-md border border-line bg-inset p-3 sm:grid-cols-3">
      <label className="text-xs text-muted">Tháng<select value={m} onChange={(e) => setM(e.target.value)} className={inp}>{[...data.months].reverse().map((x) => <option key={x} value={x}>{monthVi(x)}</option>)}</select></label>
      <label className="text-xs text-muted" title="Để trống = tổng cả tài khoản. Nếu chỉ nhập theo chiến dịch, tổng tài khoản = cộng các chiến dịch.">Chiến dịch (tuỳ chọn)<input value={campaign} onChange={(e) => setCampaign(e.target.value)} className={inp} placeholder="Để trống = cả tài khoản" /></label>
      <label className="text-xs text-muted">Lead hợp lệ<input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} className={inp} /></label>
      <label className="text-xs text-muted">Khách chốt<input inputMode="numeric" value={c} onChange={(e) => setC(e.target.value)} className={inp} /></label>
      <label className="text-xs text-muted">Doanh thu (VND)<input inputMode="numeric" value={r} onChange={(e) => setR(e.target.value)} className={inp} placeholder="vd 150000000" /></label>
      <label className="text-xs text-muted">Ghi chú<input value={note} onChange={(e) => setNote(e.target.value)} className={inp} /></label>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
        <button type="button" disabled={busy} onClick={() => void run("save")} className="h-8 rounded-md bg-accent px-3 text-sm font-medium text-white disabled:opacity-60">Lưu</button>
        <button type="button" disabled={busy} onClick={onDone} className="h-8 rounded-md border border-line bg-paper px-3 text-sm">Huỷ</button>
        {cur ? <button type="button" disabled={busy} onClick={() => void run("delete")} className="ml-auto h-8 rounded-md px-3 text-sm text-danger hover:bg-danger-bg">Xoá dòng này</button> : null}
        {err ? <span className="basis-full text-xs text-danger">{err}</span> : null}
        <span className="basis-full text-[11px] text-subtle">Ô để trống được lưu là “chưa có”, không phải 0. Chỉ lưu trong AdsOps.</span>
      </div>
    </div>
  );
}

/** "Hiệu quả kinh doanh" on the account overview (staff only; nothing for clients). */
export function BusinessCard({ clientId }: { clientId: string }) {
  const [data, setData] = useState<BizRead | null>(null);
  const [hidden, setHidden] = useState(false);
  const [edit, setEdit] = useState(false);
  const [imp, setImp] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    readBusinessFn({ data: { clientId } }).then((r) => { if (live) { setData(r); setHidden(false); } }).catch(() => { if (live) setHidden(true); });
    return () => { live = false; };
  }, [clientId, epoch]);
  if (hidden || !data) return null;
  // Default month: latest with an outcome, else the previous month.
  const withData = data.series.filter((s) => s.has_outcome);
  const month = sel && data.months.includes(sel) ? sel : withData.length ? withData[withData.length - 1].month : data.months[data.months.length - 2] || data.months[0];
  const m = data.series.find((s) => s.month === month)!;
  const g = data.group;
  const gm = g?.series.find((s) => s.month === month);
  const camps = data.entries.filter((e) => e.month === month && e.campaign);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-lg font-semibold tracking-tight" title="Kết quả kinh doanh thực tế (lead hợp lệ, khách chốt, doanh thu) do nhân sự nhập, so với chi tiêu quảng cáo.">Hiệu quả kinh doanh</h3>
        <select value={month} onChange={(e) => setSel(e.target.value)} className="h-8 rounded-md border border-line bg-paper px-2 text-sm">{[...data.months].reverse().map((x) => <option key={x} value={x}>Tháng {monthVi(x)}</option>)}</select>
        <span className="ml-auto flex items-center gap-1">
          {data.can_edit && !edit ? <button type="button" onClick={() => setEdit(true)} className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-paper px-2.5 text-sm hover:bg-inset"><Pencil className="size-3.5" /> Nhập số liệu</button> : null}
          {data.can_edit ? <button type="button" onClick={() => setImp(true)} className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-paper px-2.5 text-sm hover:bg-inset"><Upload className="size-3.5" /> Tải file</button> : null}
        </span>
      </div>
      {!m.has_outcome ? <p className="mt-2 text-sm text-muted">{NONE} cho tháng {monthVi(month)}.{m.spend != null ? ` Chi tiêu: ${dong(m.spend)}.` : ""}</p> : <Metrics m={m} t={data.targets} />}
      {camps.length ? (
        <div className="mt-3 overflow-x-auto border-t border-line pt-2">
          <table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Chiến dịch</th><th className="text-right">Lead hợp lệ</th><th className="text-right">Khách chốt</th><th className="text-right">Doanh thu</th><th className="pl-3">Ghi chú</th></tr></thead>
            <tbody>{camps.map((e) => <tr key={e.campaign} className="border-t border-line/60"><td className="py-1">{e.campaign}</td><td className="text-right tabular-nums">{e.valid_leads ?? "—"}</td><td className="text-right tabular-nums">{e.closed_customers ?? "—"}</td><td className="text-right tabular-nums">{dong(e.revenue)}</td><td className="pl-3 text-muted">{e.note || ""}</td></tr>)}</tbody></table>
        </div>
      ) : null}
      {data.entries.find((e) => e.month === month && !e.campaign)?.note ? <p className="mt-2 text-xs text-muted">Ghi chú: {data.entries.find((e) => e.month === month && !e.campaign)!.note}</p> : null}
      <Trend series={data.series} />
      {g && gm ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-sm font-semibold" title="Nhóm khách hàng theo mục Khách hàng trong Quản trị (gộp tài khoản Google + Facebook cùng khách).">Cả khách hàng: {g.name} <span className="font-normal text-muted">· {g.accounts.map((a) => a.label).join(" + ")}</span></p>
          {g.missing[month]?.length ? <p className="mt-1 text-xs text-warn">Thiếu số liệu kinh doanh: {g.missing[month].map((id) => g.accounts.find((a) => a.client_id === id)?.label || id).join(", ")} — chỉ số theo lead hợp lệ / doanh thu để trống.</p> : null}
          <Metrics m={gm} t={null} blended />
        </div>
      ) : null}
      {edit ? <Editor data={data} month={month} onDone={() => { setEdit(false); setEpoch((n) => n + 1); }} /> : null}
      {imp ? <ImportDialog onClose={(changed) => { setImp(false); if (changed) setEpoch((n) => n + 1); }} /> : null}
    </Card>
  );
}

/* ---------- Import (CSV / XLSX) ---------- */

const GUIDE = [
  "Mỗi dòng = 1 tài khoản × 1 tháng (× 1 chiến dịch nếu muốn chi tiết).",
  "account_id: mã khách hàng Google (vd 123-456-7890) hoặc ID tài khoản Facebook (vd act_1234567890).",
  "month: tháng dạng YYYY-MM (vd 2026-09).",
  "campaign: để trống = tổng cả tài khoản. Nếu chỉ có các dòng theo chiến dịch, tổng tài khoản = cộng các chiến dịch.",
  "valid_leads, closed_customers, revenue: số không âm; revenue tính bằng VND, không cần dấu chấm phân cách. Ô trống = chưa có số liệu (không phải 0).",
  "note: ghi chú tuỳ chọn.",
  "Dòng đã có (cùng tài khoản + tháng + chiến dịch) sẽ được cập nhật. Chỉ nhập được tài khoản bạn có quyền sửa kế hoạch.",
];

function downloadTemplate() {
  const csv = "\uFEFF" + [TEMPLATE_COLUMNS.join(","), "123-456-7890,2026-09,,120,18,350000000,Số liệu CRM", "act_1234567890,2026-09,Tin nhắn - HCM,80,10,200000000,"].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = "mau-hieu-qua-kinh-doanh.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function parseCsv(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, "");
  const delim = (t.split(/\r?\n/)[0].match(/;/g)?.length || 0) > (t.split(/\r?\n/)[0].match(/,/g)?.length || 0) ? ";" : ",";
  const rows: string[][] = []; let row: string[] = []; let f = ""; let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(f); f = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && t[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

/** Minimal XLSX reader: first worksheet, shared + inline strings, numbers. No library needed. */
async function parseXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const u8 = new Uint8Array(buf); const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("File Excel không hợp lệ");
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const files = new Map<string, { off: number; method: number; size: number }>();
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    files.set(new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl)), { off, method, size });
    p += 46 + nl + el + cl;
  }
  const read = async (name: string): Promise<string | null> => {
    const f = files.get(name); if (!f) return null;
    const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
    const data = u8.slice(start, start + f.size);
    if (f.method === 0) return new TextDecoder().decode(data);
    const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return await new Response(ds).text();
  };
  const sheetName = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  const sheet = sheetName ? await read(sheetName) : null;
  if (!sheet) throw new Error("Không đọc được sheet trong file Excel");
  const dp = new DOMParser();
  const ssXml = await read("xl/sharedStrings.xml");
  const shared = ssXml ? [...dp.parseFromString(ssXml, "application/xml").getElementsByTagName("si")].map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent || "").join("")) : [];
  const doc = dp.parseFromString(sheet, "application/xml");
  const col = (ref: string) => { const l = ref.replace(/\d+/g, ""); let c = 0; for (const ch of l) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };
  return [...doc.getElementsByTagName("row")].map((r) => {
    const out: string[] = [];
    for (const c of [...r.getElementsByTagName("c")]) {
      const t = c.getAttribute("t"); const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      const val = t === "s" ? shared[Number(v)] ?? "" : t === "inlineStr" ? [...c.getElementsByTagName("t")].map((x) => x.textContent || "").join("") : v;
      out[col(c.getAttribute("r") || "A")] = val;
    }
    return Array.from(out, (x) => x ?? "");
  });
}

/** Excel stores a month cell as a date serial; turn it back into YYYY-MM. */
function monthCell(v: string): string {
  if (/^\d{5}(\.\d+)?$/.test(v.trim())) { const d = new Date(Date.UTC(1899, 11, 30) + Number(v) * 864e5); return d.toISOString().slice(0, 7); }
  return v;
}

function toRows(table: string[][]): ImportRowIn[] {
  const head = (table[0] || []).map((h) => h.trim().toLowerCase());
  const idx = Object.fromEntries(TEMPLATE_COLUMNS.map((c) => [c, head.indexOf(c)]));
  if (idx.account_id < 0 || idx.month < 0) throw new Error("Thiếu cột account_id hoặc month — hãy dùng file mẫu.");
  const get = (r: string[], c: string) => (idx[c] >= 0 ? (r[idx[c]] ?? "").trim() : "");
  return table.slice(1).filter((r) => r.some((x) => x && x.trim())).map((r) => ({
    account_id: get(r, "account_id"), month: monthCell(get(r, "month")), campaign: get(r, "campaign"),
    valid_leads: get(r, "valid_leads"), closed_customers: get(r, "closed_customers"), revenue: get(r, "revenue"), note: get(r, "note"),
  }));
}

export function ImportDialog({ onClose }: { onClose: (changed: boolean) => void }) {
  const [rows, setRows] = useState<ImportRowIn[] | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function onFile(f: File) {
    setErr(""); setPreview(null); setDone(null); setBusy(true);
    try {
      const table = /\.xlsx$/i.test(f.name) ? await parseXlsx(await f.arrayBuffer()) : parseCsv(await f.text());
      const r = toRows(table);
      if (!r.length) throw new Error("File không có dòng dữ liệu.");
      setRows(r);
      setPreview(await importOutcomesFn({ data: { rows: r, dryRun: true } }));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!rows) return; setBusy(true); setErr("");
    try { setDone(await importOutcomesFn({ data: { rows, dryRun: false } })); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const okCount = useMemo(() => (preview ? preview.inserted + preview.updated : 0), [preview]);
  const shown = done || preview;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-3xl rounded-lg border border-line bg-paper p-4 shadow-xl">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-lg font-semibold">Tải số liệu kinh doanh (CSV / Excel)</h3>
          <button type="button" onClick={() => onClose(Boolean(done))} className="ml-auto rounded p-1 hover:bg-inset" aria-label="Đóng"><X className="size-4" /></button>
        </div>
        <details className="mt-2 rounded-md bg-inset p-3 text-sm" open={!rows}>
          <summary className="cursor-pointer font-medium">Hướng dẫn dùng file mẫu</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{GUIDE.map((g) => <li key={g}>{g}</li>)}</ul>
          <p className="mt-2 text-xs text-subtle">Cột: {TEMPLATE_COLUMNS.join(", ")}. Có thể mở file mẫu bằng Excel rồi lưu lại dạng .xlsx hoặc .csv.</p>
        </details>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={downloadTemplate} className="inline-flex h-8 items-center gap-1 rounded-md border border-line px-2.5 text-sm hover:bg-inset"><Download className="size-3.5" /> Tải file mẫu</button>
          <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md bg-accent px-3 text-sm font-medium text-white"><Upload className="size-3.5" /> Chọn file
            <input type="file" accept=".csv,.xlsx,text/csv" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
          </label>
          {busy ? <span className="text-sm text-muted">Đang xử lý…</span> : null}
        </div>
        {err ? <p className="mt-2 text-sm text-danger">{err}</p> : null}
        {shown ? (
          <>
            <p className="mt-3 text-sm">
              {done ? <b>Đã lưu: </b> : <b>Xem trước: </b>}
              {done ? done.inserted : shown.inserted} dòng mới · {done ? done.updated : shown.updated} dòng cập nhật · <span className={shown.rejected ? "text-danger" : ""}>{shown.rejected} dòng lỗi (bỏ qua)</span>
            </p>
            <div className="mt-2 max-h-80 overflow-auto rounded-md border border-line">
              <table className="w-full text-sm"><thead className="sticky top-0 bg-paper"><tr className="text-left text-xs text-muted"><th className="px-2 py-1">Dòng</th><th>Tài khoản</th><th>Tháng</th><th>Chiến dịch</th><th>Kết quả</th></tr></thead>
                <tbody>{shown.rows.map((r) => (
                  <tr key={r.line} className={cn("border-t border-line/60", r.errors.length > 0 && "bg-danger-bg/40")}>
                    <td className="px-2 py-1 tabular-nums">{r.line}</td><td>{r.label || "—"}</td><td>{r.month}</td><td>{r.campaign || <span className="text-subtle">(cả TK)</span>}</td>
                    <td>{r.errors.length ? <span className="text-danger">{r.errors.join("; ")}</span> : r.action === "insert" ? "Thêm mới" : "Cập nhật"}</td>
                  </tr>))}</tbody></table>
            </div>
            {!done ? (
              <div className="mt-3 flex items-center gap-2">
                <button type="button" disabled={busy || !okCount} onClick={() => void confirm()} className="h-8 rounded-md bg-accent px-3 text-sm font-medium text-white disabled:opacity-60">Lưu {okCount} dòng hợp lệ</button>
                <span className="text-xs text-subtle">Dòng lỗi sẽ bị bỏ qua. Chỉ lưu trong AdsOps.</span>
              </div>
            ) : <button type="button" onClick={() => onClose(true)} className="mt-3 h-8 rounded-md border border-line px-3 text-sm">Xong</button>}
          </>
        ) : null}
      </div>
    </div>
  );
}
