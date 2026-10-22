import { useEffect, useMemo, useState } from "react";
import { AccountCombobox } from "./account-combobox";
import {
  checkInvoiceDocsFn,
  deleteInvoiceDocFn,
  probeInvoicesFn,
  readInvoiceMonthFn,
  saveInvoiceDocsFn,
  type InvoiceAccount,
  type InvoiceMonth,
  type ProbeResult,
} from "@/lib/adsops/google-invoices.functions";
import { DOC_TYPE_VI, dashCid, dedupeDocs, normDocNo, parseInvoiceCsv, parseInvoiceText, type InvoiceDocType, type ParsedDoc } from "@/lib/adsops/google-invoices";

type Read = InvoiceMonth & { account_list: InvoiceAccount[]; can_upload: boolean; can_probe: boolean };

const money = (v: number | null | undefined, cur?: string | null) =>
  v == null ? "-" : `${Math.round(v).toLocaleString("vi-VN")}${!cur || cur === "VND" ? "đ" : ` ${cur}`}`;
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const btn = "h-8 rounded-md bg-brand px-3 text-sm font-medium text-accent-fg disabled:opacity-50";
const btn2 = "h-8 rounded-md border border-line px-3 text-sm text-ink hover:bg-inset disabled:opacity-50";
const card = "rounded-xl bg-paper px-4 py-4 shadow-sheet md:px-5";
const th = "px-2 py-1.5 text-left font-medium text-muted whitespace-nowrap";
const td = "px-2 py-1.5 whitespace-nowrap";

export function GoogleInvoicesView({ selectedClientId = "" }: { selectedClientId?: string }) {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<Read | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setErr("");
    readInvoiceMonthFn({ data: { month } })
      .then((r) => { if (live) setData(r as Read); })
      .catch((e) => { if (live) setErr(errMsg(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [month, epoch]);

  return (
    <div className="flex flex-col gap-4">
      <section className={card}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">Hóa đơn Google</h2>
            <p className="text-xs text-muted">
              Theo ngày lập chứng từ. Tổng chỉ tính "Hoá đơn thuế tại Việt Nam" (không cộng trùng cặp chứng từ); "Hóa đơn" hiện mờ. Thiếu số liệu hiện "-".
            </p>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-xs text-muted">
              Tháng lập chứng từ
              <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="mt-1 block h-8 rounded-md border border-line bg-paper px-2 text-sm text-ink" />
            </label>
            <button type="button" className={btn2} disabled={!data} onClick={() => data && exportXlsx(data)}>Xuất Excel</button>
          </div>
        </div>
      </section>

      {data?.can_probe ? <ProbeCard accounts={data.account_list} selected={selectedClientId} month={month} onSaved={() => setEpoch((n) => n + 1)} /> : null}
      {data?.can_upload ? <UploadCard accounts={data.account_list} selected={selectedClientId} onSaved={() => setEpoch((n) => n + 1)} /> : null}

      {err ? <section className={`${card} text-sm text-danger`}>{err}</section> : null}
      {loading && !data ? <section className={`${card} text-sm text-muted`}>Đang tải…</section> : null}
      {data ? <MonthTables data={data} canDelete={data.can_upload} onChanged={() => setEpoch((n) => n + 1)} /> : null}
    </div>
  );
}

function Diff({ inv, spend }: { inv: number | null; spend: number | null }) {
  if (inv == null || spend == null) return <span className="text-subtle">-</span>;
  const d = inv - spend;
  return <span className={Math.abs(d) < 1 ? "text-ok" : "text-ink"}>{`${d > 0 ? "+" : ""}${Math.round(d).toLocaleString("vi-VN")}đ`}</span>;
}

function MonthTables({ data, canDelete, onChanged }: { data: Read; canDelete: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState("");
  const del = async (no: string) => {
    if (!window.confirm(`Xoá chứng từ ${no} (đã tải lên)?`)) return;
    setBusy(no);
    try { await deleteInvoiceDocFn({ data: { docNo: no } }); onChanged(); } catch (e) { window.alert(errMsg(e)); } finally { setBusy(""); }
  };
  const failed = data.sync.filter((s) => !s.ok);
  return (
    <>
      <section className={card}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi label={`Tổng chứng từ tháng ${data.month}`} value={money(data.total)} />
          <Kpi label="Chi tiêu thực tế (dữ liệu đã kéo)" value={money(data.spend)} />
          <Kpi label="Chênh lệch (chứng từ − chi tiêu)" value={<Diff inv={data.total} spend={data.spend} />} />
        </div>
        {!data.rows.length ? <p className="mt-3 text-sm text-muted">Chưa có chứng từ nào lập trong tháng này. Tải file chứng từ lên hoặc chờ lượt đọc API hằng đêm.</p> : null}
        {failed.length ? (
          <p className="mt-3 text-xs text-muted">
            API chưa đọc được chứng từ cho {failed.length} tài khoản (thường do trả trước — Google không trả chứng từ qua API): dùng cách tải file lên.
          </p>
        ) : null}
      </section>

      {data.accounts.length ? (
        <section className={card}>
          <h3 className="mb-2 font-semibold text-ink">Theo khách hàng</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm tabular-nums">
              <thead><tr className="border-b border-line"><th className={th}>Khách hàng</th><th className={th}>Tổng chứng từ</th><th className={th}>Chi tiêu</th><th className={th}>Chênh lệch</th></tr></thead>
              <tbody>
                {data.customers.map((c) => (
                  <tr key={c.customer} className="border-b border-line/60"><td className={td}>{c.customer}</td><td className={td}>{money(c.total)}</td><td className={td}>{money(c.spend)}</td><td className={td}><Diff inv={c.total} spend={c.spend} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="mb-2 mt-5 font-semibold text-ink">Theo tài khoản</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm tabular-nums">
              <thead><tr className="border-b border-line"><th className={th}>Tài khoản</th><th className={th}>Khách hàng</th><th className={th}>CID</th><th className={th}>Tổng chứng từ</th><th className={th}>Chi tiêu tháng</th><th className={th}>Chênh lệch</th></tr></thead>
              <tbody>
                {data.accounts.map((a) => (
                  <tr key={a.client_id || a.cid || a.name} className="border-b border-line/60">
                    <td className={td}>{a.name}</td>
                    <td className={td}>{a.customer || "-"}</td>
                    <td className={td}>{a.cid ? dashCid(a.cid) : "-"}</td>
                    <td className={td}>
                      {money(a.total)}
                      {a.basis === "invoice" ? <span className="ml-1 text-xs text-muted" title="Tháng này chưa có Hoá đơn thuế tại Việt Nam nên tạm cộng theo Hóa đơn">(theo Hóa đơn)</span> : null}
                    </td>
                    <td className={td}>{money(a.spend)}{a.spend != null ? <span className="ml-1 text-xs text-subtle">{a.spend_days} ngày</span> : null}</td>
                    <td className={td}><Diff inv={a.total} spend={a.spend} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data.rows.length ? (
        <section className={card}>
          <h3 className="mb-2 font-semibold text-ink">Chứng từ</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm tabular-nums">
              <thead><tr className="border-b border-line"><th className={th}>Tài khoản</th><th className={th}>Khách hàng</th><th className={th}>Số chứng từ</th><th className={th}>Ngày lập</th><th className={th}>Loại</th><th className={th}>Số tiền</th><th className={th}>Nguồn</th>{canDelete ? <th className={th} /> : null}</tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.doc_no} className={`border-b border-line/60 ${r.counted ? "" : "text-subtle"}`}>
                    <td className={td}>{r.account_name || (r.cid ? dashCid(r.cid) : "-")}</td>
                    <td className={td}>{r.customer || "-"}</td>
                    <td className={td}>{r.doc_no}</td>
                    <td className={td}>{r.issue_date || "-"}</td>
                    <td className={td}>{DOC_TYPE_VI[r.doc_type] || r.doc_type}</td>
                    <td className={td}>{money(r.amount, r.currency)}</td>
                    <td className={td}>{r.source === "api" ? "Google Ads API" : `Tải lên${r.file_name ? ` · ${r.file_name}` : ""}`}</td>
                    {canDelete ? (
                      <td className={td}>{r.source === "upload" ? <button type="button" disabled={busy === r.doc_no} className="text-xs text-muted hover:text-danger" onClick={() => del(r.doc_no)}>Xoá</button> : null}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}

function Kpi({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

function ProbeCard({ accounts, selected, month, onSaved }: { accounts: InvoiceAccount[]; selected: string; month: string; onSaved: () => void }) {
  const selCid = accounts.find((a) => a.client_id === selected)?.cid || "";
  const [cid, setCid] = useState(selCid ? dashCid(selCid) : "");
  // Follow the top account picker; the field stays editable.
  useEffect(() => { if (selCid) setCid(dashCid(selCid)); }, [selCid]);
  const [m, setM] = useState(month);
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<(ProbeResult & { saved: number | null }) | null>(null);
  const [err, setErr] = useState("");
  const run = async () => {
    setBusy(true); setErr(""); setRes(null);
    try {
      const r = await probeInvoicesFn({ data: { cid, month: m, save } });
      setRes(r as ProbeResult & { saved: number | null });
      if (r.saved) onSaved();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <section className={card}>
      <h3 className="font-semibold text-ink">Thử đọc chứng từ (Admin)</h3>
      <p className="text-xs text-muted">Gọi Google Ads API InvoiceService.ListInvoices (chỉ đọc) cho một tài khoản và tháng lập. Hiện nguyên kết quả Google trả về.</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted">CID
          <AccountCombobox accounts={accounts} value={cid} onChange={setCid} mode="free" placeholder="CID hoặc tên" className="mt-1 w-64" />
        </label>
        <label className="text-xs text-muted">Tháng
          <input type="month" value={m} onChange={(e) => e.target.value && setM(e.target.value)} className="mt-1 block h-8 rounded-md border border-line bg-paper px-2 text-sm text-ink" />
        </label>
        <label className="flex h-8 items-center gap-1 text-xs text-muted"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Lưu vào bảng nếu đọc được</label>
        <button type="button" className={btn} disabled={busy} onClick={run}>{busy ? "Đang đọc…" : "Thử đọc chứng từ"}</button>
      </div>
      {err ? <p className="mt-3 text-sm text-danger">{err}</p> : null}
      {res ? (
        <div className="mt-3 space-y-2 text-sm">
          <p className={res.ok ? "text-ok" : "text-danger"}>{res.message}{res.saved != null ? ` Đã lưu ${res.saved}.` : ""}</p>
          {res.google_codes.length ? <p className="text-xs text-muted">Mã Google: {res.google_codes.join(", ")}</p> : null}
          {res.setups.length ? (
            <p className="text-xs text-muted">Billing setup: {res.setups.map((s) => `${s.id} (${s.status}${s.payments ? ` · ${s.payments}` : ""})`).join("; ")}</p>
          ) : null}
          {res.calls.map((c) => (
            <details key={c.billing_setup} className="rounded-md border border-line px-3 py-2">
              <summary className="cursor-pointer text-xs">{c.billing_setup}: {c.ok ? `${c.count} chứng từ` : c.message}</summary>
              {c.raw ? <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs">{c.raw}</pre> : null}
            </details>
          ))}
        </div>
      ) : null}
    </section>
  );
}

type Draft = ParsedDoc & { key: string; client_id: string; dup: "file" | "db" | null };

async function readFiles(files: File[]): Promise<{ docs: ParsedDoc[]; errors: string[] }> {
  const docs: ParsedDoc[] = [];
  const errors: string[] = [];
  const pdfText = async (name: string, bytes: Uint8Array) => {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return parseInvoiceText(Array.isArray(text) ? text.join("\n") : String(text), name);
  };
  const one = async (name: string, bytes: Uint8Array) => {
    const lower = name.toLowerCase();
    try {
      if (lower.endsWith(".pdf")) docs.push(await pdfText(name, bytes));
      else if (lower.endsWith(".csv") || lower.endsWith(".txt")) docs.push(...parseInvoiceCsv(new TextDecoder("utf-8").decode(bytes), name));
      else if (lower.endsWith(".zip")) {
        const { unzipSync } = await import("fflate");
        const inner = unzipSync(bytes);
        for (const [n, b] of Object.entries(inner)) if (!n.endsWith("/") && !n.startsWith("__MACOSX")) await one(n, b);
      } else errors.push(`${name}: định dạng chưa hỗ trợ (cần .zip, .pdf hoặc .csv)`);
    } catch (e) {
      errors.push(`${name}: không đọc được (${errMsg(e)})`);
    }
  };
  for (const f of files) await one(f.name, new Uint8Array(await f.arrayBuffer()));
  return { docs, errors };
}

function UploadCard({ accounts, selected, onSaved }: { accounts: InvoiceAccount[]; selected: string; onSaved: () => void }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const selKnown = accounts.some((a) => a.client_id === selected) ? selected : "";
  const [pick, setPick] = useState(selKnown);
  useEffect(() => { if (selKnown) setPick(selKnown); }, [selKnown]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const byCid = useMemo(() => new Map(accounts.map((a) => [a.cid, a.client_id])), [accounts]);

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true); setMsg(""); setDrafts([]); setErrors([]);
    try {
      const { docs, errors } = await readFiles([...list]);
      const seen = new Set<string>();
      const nos = docs.map((d) => d.doc_no).filter((x): x is string => Boolean(x));
      const existing = new Set((await checkInvoiceDocsFn({ data: { docNos: nos } })).existing);
      const out: Draft[] = docs.map((d, i) => {
        const k = d.doc_no ? normDocNo(d.doc_no) : "";
        const dup: Draft["dup"] = k && seen.has(k) ? "file" : k && existing.has(k) ? "db" : null;
        if (k) seen.add(k);
        return { ...d, key: `${i}-${d.file_name}`, client_id: (d.cid && byCid.get(d.cid)) || pick, dup };
      });
      setDrafts(out);
      setErrors(errors);
      if (!docs.length && !errors.length) setErrors(["Không tìm thấy chứng từ nào trong file."]);
    } catch (e) {
      setErrors([errMsg(e)]);
    } finally { setBusy(false); }
  };
  const upd = (key: string, patch: Partial<Draft>) => setDrafts((l) => l.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const ready = drafts.filter((d) => !d.dup && d.doc_no && d.issue_date && d.amount != null && d.client_id);
  const save = async () => {
    const { kept } = dedupeDocs(ready);
    setBusy(true); setMsg("");
    try {
      const r = await saveInvoiceDocsFn({
        data: { docs: kept.map((d) => ({ doc_no: d.doc_no, doc_type: d.doc_type, issue_date: d.issue_date, amount: d.amount, client_id: d.client_id, currency: d.currency, file_name: d.file_name })) },
      });
      setMsg(`Đã lưu ${r.saved} chứng từ${r.duplicates.length ? `, bỏ qua ${r.duplicates.length} số đã có` : ""}.`);
      setDrafts([]);
      onSaved();
    } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <section className={card}>
      <h3 className="font-semibold text-ink">Tải chứng từ lên</h3>
      <p className="text-xs text-muted">
        Google Ads → Thanh toán → Chứng từ → chọn chứng từ → "Tải mục đã chọn xuống". Nhận file .zip (PDF) hoặc .csv/.pdf. File được đọc ngay trên trình duyệt; chỉ số chứng từ, ngày, loại, số tiền được lưu. Trùng số chứng từ thì bỏ qua.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted">Tài khoản (khi file không có CID)
          <AccountCombobox accounts={accounts} value={pick} onChange={(v) => { setPick(v); if (v) setDrafts((l) => l.map((d) => (d.client_id ? d : { ...d, client_id: v }))); }} className="mt-1 w-80" />
        </label>
        <label className={`${btn2} inline-flex cursor-pointer items-center`}>
          {busy ? "Đang đọc…" : "Chọn file"}
          <input type="file" multiple accept=".zip,.pdf,.csv" className="hidden" disabled={busy} onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
        </label>
      </div>
      {errors.length ? <ul className="mt-2 list-disc pl-5 text-xs text-danger">{errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
      {msg ? <p className="mt-2 text-sm text-ink">{msg}</p> : null}
      {drafts.length ? (
        <div className="mt-3">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm tabular-nums">
              <thead><tr className="border-b border-line"><th className={th}>File</th><th className={th}>Số chứng từ</th><th className={th}>Loại</th><th className={th}>Ngày lập</th><th className={th}>Số tiền</th><th className={th}>Tài khoản</th><th className={th}>Ghi chú</th></tr></thead>
              <tbody>
                {drafts.map((d) => (
                  <tr key={d.key} className={`border-b border-line/60 ${d.dup ? "text-subtle" : ""}`}>
                    <td className={`${td} max-w-[14rem] truncate`} title={d.file_name}>{d.file_name}</td>
                    <td className={td}><input value={d.doc_no || ""} onChange={(e) => upd(d.key, { doc_no: e.target.value || null })} className="h-7 w-44 rounded border border-line bg-paper px-1" /></td>
                    <td className={td}>
                      <select value={d.doc_type} onChange={(e) => upd(d.key, { doc_type: e.target.value as InvoiceDocType })} className="h-7 rounded border border-line bg-paper px-1">
                        {(Object.keys(DOC_TYPE_VI) as InvoiceDocType[]).map((t) => <option key={t} value={t}>{DOC_TYPE_VI[t]}</option>)}
                      </select>
                    </td>
                    <td className={td}><input type="date" value={d.issue_date || ""} onChange={(e) => upd(d.key, { issue_date: e.target.value || null })} className="h-7 rounded border border-line bg-paper px-1" /></td>
                    <td className={td}><input inputMode="decimal" value={d.amount == null ? "" : String(d.amount)} placeholder="-" onChange={(e) => { const v = e.target.value.trim(); upd(d.key, { amount: v === "" || !Number.isFinite(Number(v)) ? null : Number(v) }); }} className="h-7 w-32 rounded border border-line bg-paper px-1" /></td>
                    <td className={td}>
                      <AccountCombobox accounts={accounts} value={d.client_id} onChange={(v) => upd(d.key, { client_id: v })} size="sm" className="w-56" />
                    </td>
                    <td className={`${td} text-xs`}>{d.dup === "file" ? "Trùng số trong file — bỏ qua" : d.dup === "db" ? "Đã có — bỏ qua" : d.note || (d.cid && !byCid.has(d.cid) ? `CID ${dashCid(d.cid)} chưa có trong hệ thống` : "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" className={btn} disabled={busy || !ready.length} onClick={save}>Lưu {ready.length} chứng từ</button>
            {drafts.length - ready.length ? <span className="text-xs text-muted">{drafts.length - ready.length} dòng chưa lưu (trùng hoặc thiếu số/ngày/số tiền/tài khoản — sửa trực tiếp ở bảng).</span> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

async function exportXlsx(d: Read) {
  const { buildXlsx } = await import("@/lib/adsops/xlsx-write");
  const n = (v: number | null) => (v == null ? "-" : Math.round(v));
  const bytes = buildXlsx([
    {
      name: "Chứng từ",
      rows: [
        ["Tài khoản", "Khách hàng", "CID", "Số chứng từ", "Ngày lập", "Loại", "Số tiền", "Tiền tệ", "Tính vào tổng", "Nguồn"],
        ...d.rows.map((r) => [r.account_name || "-", r.customer || "-", r.cid ? dashCid(r.cid) : "-", r.doc_no, r.issue_date || "-", DOC_TYPE_VI[r.doc_type] || r.doc_type, n(r.amount), r.currency || "-", r.counted ? "Có" : "Không", r.source === "api" ? "Google Ads API" : "Tải lên"]),
      ],
    },
    {
      name: "Theo tài khoản",
      rows: [
        ["Tài khoản", "Khách hàng", "CID", "Tổng chứng từ", "Cơ sở tính", "Chi tiêu tháng", "Số ngày có chi tiêu", "Chênh lệch"],
        ...d.accounts.map((a) => [a.name, a.customer || "-", a.cid ? dashCid(a.cid) : "-", n(a.total), a.basis === "vn_tax" ? "Hoá đơn thuế VN" : a.basis === "invoice" ? "Hóa đơn" : "-", n(a.spend), a.spend == null ? "-" : a.spend_days, a.total != null && a.spend != null ? Math.round(a.total - a.spend) : "-"]),
        ["Tổng tháng", "", "", n(d.total), "", n(d.spend), "", d.total != null && d.spend != null ? Math.round(d.total - d.spend) : "-"],
      ],
    },
    {
      name: "Theo khách hàng",
      rows: [["Khách hàng", "Tổng chứng từ", "Chi tiêu", "Chênh lệch"], ...d.customers.map((c) => [c.customer, n(c.total), n(c.spend), c.total != null && c.spend != null ? Math.round(c.total - c.spend) : "-"])],
    },
  ]);
  const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `hoa-don-google-${d.month}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
