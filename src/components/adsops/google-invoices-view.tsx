import { Fragment, useEffect, useMemo, useState } from "react";
import { AccountCombobox } from "./account-combobox";
import {
  checkInvoiceDocsFn,
  deleteInvoiceDocFn,
  probeInvoicesFn,
  readInvoiceMonthFn,
  saveCompanyFn,
  saveInvoiceDocsFn,
  syncCompaniesFn,
  type CompanySum,
  type GoogleCompany,
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
      {data?.can_upload ? <UploadCard accounts={data.account_list} onSaved={() => setEpoch((n) => n + 1)} /> : null}

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

      <Warnings data={data} />
      <CompanySection data={data} canEdit={canDelete} onChanged={onChanged} />

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
              <thead><tr className="border-b border-line"><th className={th}>Tài khoản</th><th className={th}>Khách hàng</th><th className={th}>Số chứng từ</th><th className={th}>Công ty</th><th className={th}>MST bên mua</th><th className={th}>Ngày lập</th><th className={th}>Loại</th><th className={th}>Số tiền</th><th className={th}>Nguồn</th>{canDelete ? <th className={th} /> : null}</tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.doc_no} className={`border-b border-line/60 ${r.counted ? "" : "text-subtle"}`}>
                    <td className={td}>{r.account_name || (r.cid ? dashCid(r.cid) : "-")}</td>
                    <td className={td}>{r.customer || "-"}</td>
                    <td className={td}>{r.doc_no}</td>
                    <td className={td}>{r.company || "-"}</td>
                    <td className={td}>{r.buyer_mst ? <span className={r.mst_mismatch ? "text-danger" : ""} title={r.mst_mismatch ? `MST công ty theo tài khoản: ${r.company_mst}` : undefined}>{r.buyer_mst}</span> : "-"}</td>
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

function Warnings({ data }: { data: Read }) {
  const noDocs = data.warnings.filter((w) => w.kind === "no_docs");
  const mst = data.warnings.filter((w) => w.kind === "mst_mismatch");
  const noCo = data.warnings.filter((w) => w.kind === "no_company");
  if (!data.warnings.length) return null;
  return (
    <section className={card}>
      <h3 className="mb-2 font-semibold text-ink">Cảnh báo tháng {data.month}</h3>
      {mst.length ? (
        <details open className="mb-2">
          <summary className="cursor-pointer text-sm text-danger">{mst.length} chứng từ có MST bên mua khác MST công ty của tài khoản tại ngày lập</summary>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {mst.map((w) => w.kind === "mst_mismatch" ? <li key={w.doc_no}>{w.doc_no} · {w.name || (w.cid ? dashCid(w.cid) : "-")}: MST trên chứng từ {w.buyer_mst}, công ty {w.company || "-"} có MST {w.company_mst || "-"}</li> : null)}
          </ul>
        </details>
      ) : null}
      {noDocs.length ? (
        <details className="mb-2">
          <summary className="cursor-pointer text-sm text-warn">{noDocs.length} tài khoản có chi tiêu trong tháng nhưng chưa có chứng từ nào lập trong tháng</summary>
          <table className="mt-1 min-w-full text-xs tabular-nums">
            <thead><tr className="border-b border-line"><th className={th}>Tài khoản</th><th className={th}>CID</th><th className={th}>Công ty (cuối tháng)</th><th className={th}>Chi tiêu</th></tr></thead>
            <tbody>{noDocs.map((w) => w.kind === "no_docs" ? <tr key={w.client_id} className="border-b border-line/60"><td className={td}>{w.name}</td><td className={td}>{dashCid(w.cid)}</td><td className={td}>{w.company || "-"}</td><td className={td}>{money(w.spend)}</td></tr> : null)}</tbody>
          </table>
        </details>
      ) : null}
      {noCo.length ? (
        <details>
          <summary className="cursor-pointer text-sm text-muted">{noCo.length} tài khoản có chứng từ nhưng chưa xác định được công ty tại ngày lập (chưa đọc billing setup, hoặc Google không trả ngày hiệu lực)</summary>
          <ul className="mt-1 list-disc pl-5 text-xs">{noCo.map((w) => w.kind === "no_company" ? <li key={w.client_id || w.cid || w.name}>{w.name}{w.cid ? ` · ${dashCid(w.cid)}` : ""}: {w.docs} chứng từ</li> : null)}</ul>
        </details>
      ) : null}
    </section>
  );
}

function CompanySection({ data, canEdit, onChanged }: { data: Read; canEdit: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const sync = async () => {
    setSyncing(true); setSyncMsg("");
    try {
      const r = await syncCompaniesFn();
      setSyncMsg(`Đã đọc billing setup ${r.ok}/${r.accounts} tài khoản${r.failed ? `, ${r.failed} lỗi` : ""}${r.left ? `, còn ${r.left} tài khoản để lượt đêm đọc tiếp` : ""}${r.mst_filled ? `; tự điền MST cho ${r.mst_filled} công ty` : ""}.`);
      onChanged();
    } catch (e) { setSyncMsg(errMsg(e)); } finally { setSyncing(false); }
  };
  const m = data.mapping;
  return (
    <section className={card}>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="font-semibold text-ink">Theo công ty</h3>
          <p className="text-xs text-muted">
            Công ty = hồ sơ thanh toán Google (payments profile) gắn với tài khoản tại ngày lập chứng từ; chi tiêu chia theo từng ngày cùng cách đó. Ánh xạ đọc billing setup lúc 04:30 hằng đêm
            {m.checked_at ? ` · lần gần nhất ${new Date(m.checked_at).toLocaleString("vi-VN")} (${m.accounts} tài khoản${m.failed ? `, ${m.failed} lỗi` : ""})` : " · chưa đọc lần nào"}.
          </p>
        </div>
        {data.can_probe ? <button type="button" className={btn2} disabled={syncing} onClick={sync}>{syncing ? "Đang cập nhật…" : "Cập nhật ngay"}</button> : null}
      </div>
      {syncMsg ? <p className="mb-2 text-sm text-ink">{syncMsg}</p> : null}
      {data.companies.length ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm tabular-nums">
            <thead><tr className="border-b border-line"><th className={th}>Công ty</th><th className={th}>MST</th><th className={th}>Hoá đơn thuế VN</th><th className={th}>Chi tiêu</th><th className={th}>Chênh lệch</th><th className={th}>Số chứng từ</th></tr></thead>
            <tbody>
              {data.companies.map((c) => {
                const ck = c.profile_id || "none";
                return (
                  <CompanyRows key={ck} c={c} data={data} open={open} toggle={toggle} ck={ck} />
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="text-sm text-muted">Tháng này chưa có chứng từ hoặc chi tiêu nào để gom theo công ty.</p>}
      <CompanyEditor list={data.company_list} canEdit={canEdit} onChanged={onChanged} />
    </section>
  );
}

function CompanyRows({ c, data, open, toggle, ck }: { c: CompanySum; data: Read; open: Record<string, boolean>; toggle: (k: string) => void; ck: string }) {
  return (
    <>
      <tr className="cursor-pointer border-b border-line/60 font-medium hover:bg-inset" onClick={() => toggle(ck)}>
        <td className={td}>
          <span className="mr-1 text-muted">{open[ck] ? "▾" : "▸"}</span>{c.name}
          {c.profile_name && c.display_name && c.profile_name !== c.display_name ? <span className="ml-1 text-xs font-normal text-muted">({c.profile_name})</span> : null}
        </td>
        <td className={td}>{c.mst || "-"}{c.mst && c.mst_source === "invoice" ? <span className="ml-1 text-xs font-normal text-muted" title="Tự điền từ hoá đơn thuế">(từ HĐ)</span> : null}</td>
        <td className={td}>{money(c.total)}{c.fallback ? <span className="ml-1 text-xs font-normal text-muted" title="Có tài khoản chưa có Hoá đơn thuế VN nên tạm cộng theo Hóa đơn">(có phần theo Hoá đơn)</span> : null}</td>
        <td className={td}>{money(c.spend)}</td>
        <td className={td}><Diff inv={c.total} spend={c.spend} /></td>
        <td className={td}>{c.docs || "-"}</td>
      </tr>
      {open[ck] ? c.accounts.map((a) => {
        const ak = `${ck}|${a.client_id || a.cid || a.name}`;
        const docs = data.rows.filter((r) => (r.company_id || "none") === ck && (r.client_id || null) === (a.client_id || null) && (a.client_id || r.cid === a.cid));
        return (
          <Fragment key={ak}>
            <tr className="cursor-pointer border-b border-line/40 hover:bg-inset" onClick={() => docs.length && toggle(ak)}>
              <td className={`${td} pl-7`}>{docs.length ? <span className="mr-1 text-muted">{open[ak] ? "▾" : "▸"}</span> : null}{a.name}{a.cid ? <span className="ml-1 text-xs text-muted">{dashCid(a.cid)}</span> : null}</td>
              <td className={td} />
              <td className={td}>{money(a.total)}{a.basis === "invoice" ? <span className="ml-1 text-xs text-muted">(theo Hoá đơn)</span> : null}</td>
              <td className={td}>{money(a.spend)}</td>
              <td className={td}><Diff inv={a.total} spend={a.spend} /></td>
              <td className={td}>{a.docs || "-"}</td>
            </tr>
            {open[ak] ? docs.map((r) => (
              <tr key={r.doc_no} className={`border-b border-line/30 text-xs ${r.counted ? "" : "text-subtle"}`}>
                <td className={`${td} pl-14`}>{r.doc_no} · {DOC_TYPE_VI[r.doc_type] || r.doc_type}</td>
                <td className={td}>{r.buyer_mst ? <span className={r.mst_mismatch ? "text-danger" : ""}>{r.buyer_mst}</span> : "-"}</td>
                <td className={td}>{money(r.amount, r.currency)}</td>
                <td className={td}>{r.issue_date || "-"}</td>
                <td className={td} colSpan={2}>{r.buyer_name || "-"}</td>
              </tr>
            )) : null}
          </Fragment>
        );
      }) : null}
    </>
  );
}

function CompanyEditor({ list, canEdit, onChanged }: { list: GoogleCompany[]; canEdit: boolean; onChanged: () => void }) {
  const [edit, setEdit] = useState<Record<string, { name: string; mst: string }>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const save = async (id: string) => {
    const e = edit[id];
    if (!e) return;
    setBusy(id); setErr("");
    try {
      await saveCompanyFn({ data: { profileId: id, displayName: e.name, mst: e.mst } });
      setEdit((x) => { const n = { ...x }; delete n[id]; return n; });
      onChanged();
    } catch (er) { setErr(errMsg(er)); } finally { setBusy(""); }
  };
  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-sm text-ink">Danh sách công ty ({list.length}){canEdit ? " — đặt tên hiển thị và MST" : ""}</summary>
      {err ? <p className="mt-2 text-xs text-danger">{err}</p> : null}
      {list.length ? (
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr className="border-b border-line"><th className={th}>Hồ sơ thanh toán (Google)</th><th className={th}>Mã hồ sơ</th><th className={th}>Tên hiển thị</th><th className={th}>MST</th>{canEdit ? <th className={th} /> : null}</tr></thead>
            <tbody>
              {list.map((c) => {
                const e = edit[c.profile_id];
                return (
                  <tr key={c.profile_id} className="border-b border-line/60">
                    <td className={td}>{c.profile_name || "-"}</td>
                    <td className={`${td} text-xs text-muted`}>{c.profile_id}</td>
                    <td className={td}>{e ? <input value={e.name} onChange={(v) => setEdit((x) => ({ ...x, [c.profile_id]: { ...e, name: v.target.value } }))} className="h-7 w-56 rounded border border-line bg-paper px-1" /> : c.display_name || "-"}</td>
                    <td className={td}>
                      {e ? <input value={e.mst} placeholder="10 chữ số" onChange={(v) => setEdit((x) => ({ ...x, [c.profile_id]: { ...e, mst: v.target.value } }))} className="h-7 w-36 rounded border border-line bg-paper px-1" /> : (
                        <>{c.mst || "-"}{c.mst && c.mst_source === "invoice" ? <span className="ml-1 text-xs text-muted" title={c.mst_doc ? `Từ chứng từ ${c.mst_doc}` : undefined}>(từ HĐ)</span> : null}</>
                      )}
                    </td>
                    {canEdit ? (
                      <td className={td}>
                        {e ? (
                          <>
                            <button type="button" className="mr-2 text-xs text-brand" disabled={busy === c.profile_id} onClick={() => save(c.profile_id)}>Lưu</button>
                            <button type="button" className="text-xs text-muted" onClick={() => setEdit((x) => { const n = { ...x }; delete n[c.profile_id]; return n; })}>Huỷ</button>
                          </>
                        ) : <button type="button" className="text-xs text-muted hover:text-ink" onClick={() => setEdit((x) => ({ ...x, [c.profile_id]: { name: c.display_name || "", mst: c.mst || "" } }))}>Sửa</button>}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="mt-2 text-xs text-muted">Chưa có công ty nào — bấm "Cập nhật ngay" (Admin) hoặc chờ lượt đọc đêm.</p>}
    </details>
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

function UploadCard({ accounts, onSaved }: { accounts: InvoiceAccount[]; onSaved: () => void }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [drag, setDrag] = useState(false);
  const [onlyFix, setOnlyFix] = useState(false);
  const byCid = useMemo(() => new Map(accounts.map((a) => [a.cid, a.client_id])), [accounts]);

  const onFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true); setMsg(""); setErrors([]);
    try {
      const { docs, errors } = await readFiles(files);
      // Merge with what is already in the preview (several drops before saving).
      const prev = drafts;
      const all = [...prev.map((d) => d as ParsedDoc & { client_id?: string }), ...docs];
      const nos = all.map((d) => d.doc_no).filter((x): x is string => Boolean(x));
      const existing = new Set((await checkInvoiceDocsFn({ data: { docNos: nos } })).existing);
      const seen = new Set<string>();
      const out: Draft[] = all.map((d, i) => {
        const k = d.doc_no ? normDocNo(d.doc_no) : "";
        const dup: Draft["dup"] = k && seen.has(k) ? "file" : k && existing.has(k) ? "db" : null;
        if (k) seen.add(k);
        const keep = i < prev.length ? prev[i] : null;
        return { ...d, key: keep?.key || `${Date.now()}-${i}-${d.file_name}`, client_id: keep?.client_id || (d.cid && byCid.get(d.cid)) || "", dup };
      });
      setDrafts(out);
      setErrors(errors);
      if (!docs.length && !errors.length) setErrors(["Không tìm thấy chứng từ nào trong file."]);
    } catch (e) {
      setErrors([errMsg(e)]);
    } finally { setBusy(false); }
  };
  const upd = (key: string, patch: Partial<Draft>) => setDrafts((l) => l.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const problems = (d: Draft): string[] => {
    const p: string[] = [];
    if (!d.doc_no) p.push("số chứng từ");
    if (!d.issue_date) p.push("ngày");
    if (d.amount == null) p.push("số tiền");
    if (!d.client_id) p.push(d.cid ? `tài khoản (CID ${dashCid(d.cid)} chưa có trong hệ thống)` : "tài khoản");
    return p;
  };
  const ready = drafts.filter((d) => !d.dup && !problems(d).length);
  const needFix = drafts.filter((d) => !d.dup && problems(d).length);
  const dups = drafts.filter((d) => d.dup);
  const shown = onlyFix ? needFix : drafts;
  const save = async () => {
    const { kept } = dedupeDocs(ready);
    setBusy(true); setMsg("");
    try {
      const r = await saveInvoiceDocsFn({
        data: {
          docs: kept.map((d) => ({ doc_no: d.doc_no, doc_type: d.doc_type, issue_date: d.issue_date, amount: d.amount, client_id: d.client_id, currency: d.currency, file_name: d.file_name, buyer_name: d.buyer_name, buyer_mst: d.buyer_mst })),
        },
      }) as { saved: number; duplicates: string[]; mst_filled?: number };
      setMsg(`Đã lưu ${r.saved} chứng từ${r.duplicates.length ? `, bỏ qua ${r.duplicates.length} số đã có` : ""}${r.mst_filled ? `; tự điền MST cho ${r.mst_filled} công ty` : ""}.${needFix.length ? ` Còn ${needFix.length} dòng cần sửa vẫn ở bảng dưới.` : ""}`);
      const savedKeys = new Set(kept.map((d) => d.key));
      setDrafts((l) => l.filter((d) => !savedKeys.has(d.key) && !d.dup));
      onSaved();
    } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <section className={card}>
      <h3 className="font-semibold text-ink">Tải chứng từ lên</h3>
      <p className="text-xs text-muted">
        Google Ads → Thanh toán → Chứng từ → chọn chứng từ → "Tải mục đã chọn xuống". Kéo thả nhiều file .zip / .pdf / .csv cùng lúc, của nhiều tài khoản cũng được: CID, số chứng từ, loại, ngày, số tiền, bên mua và MST được đọc từ từng file ngay trên trình duyệt. Dòng nào thiếu thông tin được đánh dấu để sửa tay. Trùng số chứng từ thì bỏ qua.
      </p>
      <label
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (!busy) void onFiles([...e.dataTransfer.files]); }}
        className={`mt-3 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-sm ${drag ? "border-brand bg-brand/5" : "border-line"} ${busy ? "opacity-60" : ""}`}
      >
        <span className="font-medium text-ink">{busy ? "Đang đọc file…" : "Kéo thả file vào đây hoặc bấm để chọn"}</span>
        <span className="text-xs text-muted">Nhiều file .zip, .pdf, .csv một lúc</span>
        <input type="file" multiple accept=".zip,.pdf,.csv" className="hidden" disabled={busy} onChange={(e) => { void onFiles([...(e.target.files || [])]); e.target.value = ""; }} />
      </label>
      {errors.length ? <ul className="mt-2 list-disc pl-5 text-xs text-danger">{errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
      {msg ? <p className="mt-2 text-sm text-ink">{msg}</p> : null}
      {drafts.length ? (
        <div className="mt-3">
          <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
            <span className="text-ok">{ready.length} dòng sẵn sàng</span>
            <span className={needFix.length ? "text-warn" : "text-muted"}>{needFix.length} dòng cần sửa</span>
            <span className="text-muted">{dups.length} trùng (bỏ qua)</span>
            <label className="flex items-center gap-1 text-muted"><input type="checkbox" checked={onlyFix} onChange={(e) => setOnlyFix(e.target.checked)} /> Chỉ hiện dòng cần sửa</label>
            <button type="button" className="text-muted hover:text-danger" onClick={() => setDrafts([])}>Xoá bảng xem trước</button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm tabular-nums">
              <thead><tr className="border-b border-line"><th className={th}>File</th><th className={th}>Số chứng từ</th><th className={th}>Loại</th><th className={th}>Ngày lập</th><th className={th}>Số tiền</th><th className={th}>Tài khoản</th><th className={th}>Bên mua</th><th className={th}>MST</th><th className={th}>Ghi chú</th></tr></thead>
              <tbody>
                {shown.map((d) => {
                  const p = d.dup ? [] : problems(d);
                  const bad = (f: boolean) => (f ? "border-warn bg-warn/10" : "border-line");
                  return (
                    <tr key={d.key} className={`border-b border-line/60 ${d.dup ? "text-subtle" : ""}`}>
                      <td className={`${td} max-w-[12rem] truncate`} title={d.file_name}>{d.file_name}</td>
                      <td className={td}><input value={d.doc_no || ""} onChange={(e) => upd(d.key, { doc_no: e.target.value || null })} className={`h-7 w-44 rounded border bg-paper px-1 ${bad(!d.dup && !d.doc_no)}`} /></td>
                      <td className={td}>
                        <select value={d.doc_type} onChange={(e) => upd(d.key, { doc_type: e.target.value as InvoiceDocType })} className="h-7 rounded border border-line bg-paper px-1">
                          {(Object.keys(DOC_TYPE_VI) as InvoiceDocType[]).map((t) => <option key={t} value={t}>{DOC_TYPE_VI[t]}</option>)}
                        </select>
                      </td>
                      <td className={td}><input type="date" value={d.issue_date || ""} onChange={(e) => upd(d.key, { issue_date: e.target.value || null })} className={`h-7 rounded border bg-paper px-1 ${bad(!d.dup && !d.issue_date)}`} /></td>
                      <td className={td}><input inputMode="decimal" value={d.amount == null ? "" : String(d.amount)} placeholder="-" onChange={(e) => { const v = e.target.value.trim(); upd(d.key, { amount: v === "" || !Number.isFinite(Number(v)) ? null : Number(v) }); }} className={`h-7 w-32 rounded border bg-paper px-1 ${bad(!d.dup && d.amount == null)}`} /></td>
                      <td className={td}>
                        <div className={!d.dup && !d.client_id ? "rounded ring-1 ring-warn" : ""}>
                          <AccountCombobox accounts={accounts} value={d.client_id} onChange={(v) => upd(d.key, { client_id: v })} size="sm" className="w-56" />
                        </div>
                      </td>
                      <td className={td}><input value={d.buyer_name || ""} placeholder="-" onChange={(e) => upd(d.key, { buyer_name: e.target.value || null })} className="h-7 w-48 rounded border border-line bg-paper px-1" /></td>
                      <td className={td}><input value={d.buyer_mst || ""} placeholder="-" onChange={(e) => upd(d.key, { buyer_mst: e.target.value.trim() || null })} className="h-7 w-32 rounded border border-line bg-paper px-1" /></td>
                      <td className={`${td} text-xs`}>
                        {d.dup === "file" ? "Trùng số trong file — bỏ qua" : d.dup === "db" ? "Đã có — bỏ qua" : p.length ? <span className="text-warn">Cần sửa: {p.join(", ")}</span> : <span className="text-ok">Sẵn sàng</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" className={btn} disabled={busy || !ready.length} onClick={save}>Lưu {ready.length} chứng từ</button>
            {needFix.length ? <span className="text-xs text-muted">Dòng cần sửa không được lưu cho đến khi đủ thông tin.</span> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

async function exportXlsx(d: Read) {
  const { buildXlsx } = await import("@/lib/adsops/xlsx-write");
  const n = (v: number | null) => (v == null ? "-" : Math.round(v));
  const diff = (a: number | null, b: number | null) => (a != null && b != null ? Math.round(a - b) : "-");
  const bytes = buildXlsx([
    {
      name: "Theo công ty",
      rows: [
        ["Công ty", "Hồ sơ thanh toán", "MST", "Tài khoản", "CID", "Hoá đơn thuế VN", "Cơ sở tính", "Chi tiêu", "Chênh lệch", "Số chứng từ"],
        ...d.companies.flatMap((c) => [
          [c.name, c.profile_name || "-", c.mst || "-", "Tổng công ty", "", n(c.total), c.fallback ? "Có phần theo Hoá đơn" : c.total == null ? "-" : "Hoá đơn thuế VN", n(c.spend), diff(c.total, c.spend), c.docs || "-"],
          ...c.accounts.map((a) => [c.name, "", "", a.name, a.cid ? dashCid(a.cid) : "-", n(a.total), a.basis === "vn_tax" ? "Hoá đơn thuế VN" : a.basis === "invoice" ? "Hóa đơn" : "-", n(a.spend), diff(a.total, a.spend), a.docs || "-"]),
        ]),
      ],
    },
    {
      name: "Chứng từ",
      rows: [
        ["Công ty", "MST công ty", "Tài khoản", "Khách hàng", "CID", "Số chứng từ", "Ngày lập", "Loại", "Số tiền", "Tiền tệ", "Tính vào tổng", "Bên mua", "MST bên mua", "MST lệch", "Nguồn"],
        ...d.rows.map((r) => [r.company || "-", r.company_mst || "-", r.account_name || "-", r.customer || "-", r.cid ? dashCid(r.cid) : "-", r.doc_no, r.issue_date || "-", DOC_TYPE_VI[r.doc_type] || r.doc_type, n(r.amount), r.currency || "-", r.counted ? "Có" : "Không", r.buyer_name || "-", r.buyer_mst || "-", r.mst_mismatch ? "Lệch" : "-", r.source === "api" ? "Google Ads API" : "Tải lên"]),
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
