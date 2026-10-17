/** Client report → self-contained, print-optimised HTML (A4). Pure; every dynamic string is escaped. */
import { delta, summarize, type CampRow, type ReportData, type ReportNotes, type ReportOptions } from "./client-report.types.ts";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const dong = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v).toLocaleString("vi-VN")}đ`);
const n0 = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("vi-VN"));
const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const dmy = (s: string) => s.split("-").reverse().join("/");

const LOGO = `<svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0f766e"/><stop offset="1" stop-color="#0891b2"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#g)"/><path d="M8 22V10h3.2l4.3 8.1L19.8 10H23v12h-2.6v-7.4L16.6 22h-2.2l-3.8-7.4V22H8z" fill="#fff"/></svg>`;

function deltaHtml(cur: number | null, prev: number | null, lowerBetter = false): string {
  const d = delta(cur, prev);
  if (d == null) return `<span class="d muted">— so với kỳ trước</span>`;
  if (Math.abs(d) < 0.005) return `<span class="d muted">= kỳ trước</span>`;
  const good = lowerBetter ? d < 0 : d > 0;
  return `<span class="d ${good ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${Math.abs(Math.round(d * 100))}% so với kỳ trước</span>`;
}
function statusHtml(ok: boolean | null, label: string): string {
  if (ok == null) return "";
  return `<span class="st ${ok ? "ok" : "bad"}">${ok ? "Đạt" : "Chưa đạt"} ${esc(label)}</span>`;
}
function kpi(label: string, value: string, d: string, st: string, hint: string): string {
  return `<div class="kpi" title="${esc(hint)}"><div class="kl">${esc(label)}</div><div class="kv">${value}</div>${d}${st}</div>`;
}
function campTable(rows: CampRow[], title: string): string {
  if (!rows.length) return "";
  return `<div class="col"><h4>${esc(title)}</h4><table><thead><tr><th>Chiến dịch</th><th>Kênh</th><th class="r">Chi tiêu</th><th class="r">Lead</th><th class="r">CPL</th></tr></thead><tbody>${rows
    .map((c) => `<tr><td>${esc(c.name)}</td><td>${c.platform === "google" ? "Google" : c.platform === "chatgpt" ? "ChatGPT Ads" : "Facebook"}</td><td class="r">${dong(c.spend)}</td><td class="r">${n0(c.leads)}</td><td class="r">${c.cpl != null ? dong(c.cpl) : "Chưa có lead"}</td></tr>`)
    .join("")}</tbody></table></div>`;
}
const para = (s: string | undefined) => (s && s.trim() ? esc(s.trim()).replace(/\n/g, "<br>") : `<span class="muted">—</span>`);

export function renderReportHtml(d: ReportData, notes: ReportNotes, opt: ReportOptions, meta: { status: "draft" | "sent"; printable?: boolean }): string {
  const c = d.cur, p = d.prev_totals, t = d.targets;
  const ch = [d.channels.facebook ? ["Facebook", d.channels.facebook] : null, d.channels.google ? ["Google", d.channels.google] : null, d.channels.chatgpt ? ["ChatGPT Ads", d.channels.chatgpt] : null].filter(Boolean) as [string, NonNullable<ReportData["channels"]["google"]>][];
  const totalSpend = ch.reduce((a, [, x]) => a + (x.spend || 0), 0);
  const kpis = [
    kpi("Chi tiêu", dong(c.spend), deltaHtml(c.spend, p.spend), t.budget != null && c.spend != null ? statusHtml(Math.abs(c.spend / t.budget - 1) <= 0.1, `kế hoạch ${dong(t.budget)}`) : "", "Tổng chi phí quảng cáo Facebook + Google + ChatGPT Ads trong kỳ."),
    kpi("Lead", n0(c.leads), deltaHtml(c.leads, p.leads), t.leads != null && c.leads != null ? statusHtml(c.leads >= t.leads, `mục tiêu ${n0(t.leads)}`) : "", "Google: chuyển đổi; Facebook: lead (không có thì tin nhắn); ChatGPT Ads: chuyển đổi mục tiêu."),
    kpi("Lead hợp lệ", c.valid != null ? n0(c.valid) : `<span class="muted sm">Chưa nhập số liệu</span>`, c.valid != null ? deltaHtml(c.valid, p.valid) : "", "", "Số lead đội kinh doanh xác nhận hợp lệ."),
    kpi("CPL", dong(c.cpl), deltaHtml(c.cpl, p.cpl, true), t.cpl != null && c.cpl != null ? statusHtml(c.cpl <= t.cpl, `≤ ${dong(t.cpl)}`) : "", "Chi tiêu ÷ lead."),
    kpi("Khách chốt", c.closed != null ? n0(c.closed) : `<span class="muted sm">Chưa nhập số liệu</span>`, c.closed != null ? deltaHtml(c.closed, p.closed) : "", "", "Số khách hàng chốt được từ lead quảng cáo."),
    kpi("Doanh thu", c.revenue != null ? dong(c.revenue) : `<span class="muted sm">Chưa nhập số liệu</span>`, c.revenue != null ? deltaHtml(c.revenue, p.revenue) : "", "", "Doanh thu ghi nhận từ khách chốt."),
    kpi("ROAS", c.roas != null ? `${c.roas.toFixed(2)}×` : `<span class="muted sm">Chưa nhập số liệu</span>`, c.roas != null ? deltaHtml(c.roas, p.roas) : "", t.roas != null && c.roas != null ? statusHtml(c.roas >= t.roas, `≥ ${t.roas}×`) : "", "Doanh thu ÷ chi tiêu quảng cáo."),
  ].join("");
  const w = d.work;
  const workHtml = opt.show_work !== false && w && (w.keywords_added || w.negatives_added)
    ? `<section><h3>Việc đã làm</h3><ul>
        ${w.keywords_added ? `<li>Bổ sung <b>${n0(w.keywords_added)}</b> từ khoá mới để tiếp cận thêm khách hàng tiềm năng.</li>` : ""}
        ${w.negatives_added ? `<li>Thêm <b>${n0(w.negatives_added)}</b> từ khoá phủ định để chặn các tìm kiếm không liên quan.</li>` : ""}
        ${w.est_savings != null && w.est_savings > 0 ? `<li>Tiết kiệm <b>ước tính</b> khoảng <b>${dong(w.est_savings)}</b> nhờ phủ định (${n0(w.est_terms)} cụm tìm kiếm). <span class="muted sm">${esc(w.est_basis)} — ước tính, không phải số thực chi.</span></li>` : ""}
      </ul></section>` : "";
  const app = d.appendix;
  const appHtml = opt.show_appendix ? `<section class="appendix"><h3>Phụ lục chỉ số</h3><table><tbody>
      <tr><td>Lượt hiển thị</td><td class="r">${n0(app.impressions)}</td><td>Lượt nhấp</td><td class="r">${n0(app.clicks)}</td></tr>
      <tr><td title="Chi phí cho 1.000 lượt hiển thị">CPM</td><td class="r">${dong(app.cpm)}</td><td title="Tỷ lệ nhấp = nhấp ÷ hiển thị">CTR</td><td class="r">${pct(app.ctr, 2)}</td></tr>
      <tr><td title="Chi phí mỗi lượt nhấp">CPC</td><td class="r">${dong(app.cpc)}</td><td title="Tỷ lệ hiển thị trên Google tìm kiếm">Tỷ lệ hiển thị (IS)</td><td class="r">${pct(app.is, 0)}</td></tr>
      <tr><td title="Phần hiển thị bị mất do ngân sách">IS mất do ngân sách</td><td class="r">${pct(app.is_lost_budget, 0)}</td><td title="Điểm chất lượng trung bình (theo lượt hiển thị), thang 1–10">Điểm chất lượng (QS)</td><td class="r">${app.qs != null ? app.qs.toFixed(1) : "—"}</td></tr>
    </tbody></table></section>` : "";
  const sum = summarize(d);
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(`Báo cáo quảng cáo — ${d.client_name} — ${d.period.label}`)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f1f5f9;color:#0f172a;font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.page{max-width:820px;margin:24px auto;background:#fff;padding:32px 36px;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
header{display:flex;align-items:center;gap:12px;border-bottom:2px solid #0f766e;padding-bottom:12px}
header h1{font-size:20px;margin:0}header .sub{color:#475569;font-size:13px}header .brand{margin-left:auto;text-align:right;font-size:12px;color:#0f766e;font-weight:600}
h3{font-size:15px;margin:20px 0 8px;color:#0f766e}h4{font-size:13px;margin:0 0 6px}
.summary p{margin:4px 0}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.kpi{border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;break-inside:avoid}.kl{font-size:12px;color:#64748b}.kv{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums}
.d{display:block;font-size:11px}.up{color:#15803d}.down{color:#b91c1c}.muted{color:#94a3b8}.sm{font-size:12px;font-weight:400}
.st{display:inline-block;margin-top:2px;font-size:11px;padding:0 6px;border-radius:4px}.st.ok{background:#dcfce7;color:#166534}.st.bad{background:#fee2e2;color:#991b1b}
table{width:100%;border-collapse:collapse;font-size:12.5px}th,td{padding:4px 6px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}th{color:#64748b;font-weight:600}.r{text-align:right;font-variant-numeric:tabular-nums}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}.notes{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.note{border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:13px;break-inside:avoid}
.bar{height:8px;border-radius:4px;background:#e2e8f0;overflow:hidden}.bar i{display:block;height:100%;background:#0891b2}
.foot{margin-top:18px;font-size:11px;color:#94a3b8}.toolbar{max-width:820px;margin:16px auto 0;display:flex;gap:8px;justify-content:flex-end}
.toolbar button{height:34px;padding:0 14px;border-radius:6px;border:0;background:#0f766e;color:#fff;font-weight:600;cursor:pointer}
.draft{background:#fef3c7;color:#92400e;padding:6px 10px;border-radius:6px;font-size:12px;margin-bottom:10px}
@media (max-width:640px){.kpis{grid-template-columns:repeat(2,1fr)}.cols,.notes{grid-template-columns:1fr}.page{padding:18px}}
@page{size:A4;margin:12mm}
@media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;padding:0}.toolbar,.draft{display:none}section{break-inside:avoid}}
</style></head><body>
${meta.printable !== false ? `<div class="toolbar"><button type="button" onclick="window.print()">In / Lưu PDF</button></div>` : ""}
<div class="page">
${meta.status === "draft" ? `<div class="draft">Bản nháp — chưa gửi khách hàng.</div>` : ""}
<header>${LOGO}<div><h1>Báo cáo quảng cáo — ${esc(d.client_name)}</h1><div class="sub">${esc(d.period.label.replace(/^./, (x) => x.toUpperCase()))} (${dmy(d.period.start)} – ${dmy(d.period.end)}) · so với ${esc(d.prev.label)}</div></div><div class="brand">Fago Group<br><span style="font-weight:400;color:#64748b">AdsOps</span></div></header>
<section class="summary"><h3>Tóm tắt</h3>${sum.map((s) => `<p>${esc(s)}</p>`).join("")}</section>
<section><h3>Chỉ số chính</h3><div class="kpis">${kpis}</div></section>
${ch.length > 1 ? `<section><h3>Theo kênh</h3><table><thead><tr><th>Kênh</th><th class="r">Chi tiêu</th><th style="width:28%">Tỷ trọng</th><th class="r">Lead</th><th class="r">CPL</th></tr></thead><tbody>${ch
    .map(([n, x]) => `<tr><td>${n}</td><td class="r">${dong(x.spend)}</td><td>${x.spend != null && totalSpend > 0 ? `<div class="bar"><i style="width:${((x.spend / totalSpend) * 100).toFixed(1)}%"></i></div>` : ""}</td><td class="r">${n0(x.leads)}</td><td class="r">${dong(x.cpl)}</td></tr>`)
    .join("")}</tbody></table></section>` : ""}
${d.campaigns.top.length || d.campaigns.bottom.length || d.campaigns.no_lead.length ? `<section><h3>Chiến dịch</h3><div class="cols">${campTable(d.campaigns.top, "Hiệu quả nhất (CPL thấp)")}${campTable([...d.campaigns.bottom, ...d.campaigns.no_lead], "Cần cải thiện")}</div></section>` : ""}
${workHtml}
<section><h3>Nhận xét &amp; kế hoạch</h3><div class="notes"><div class="note"><h4>Điểm tốt</h4>${para(notes.good)}</div><div class="note"><h4>Vấn đề</h4>${para(notes.issues)}</div><div class="note"><h4>Kế hoạch kỳ tới</h4>${para(notes.plan)}</div></div></section>
${appHtml}
<div class="foot">${d.notes_data.map(esc).join(" ")} Ô “—” hoặc “Chưa nhập số liệu” là chưa có dữ liệu (không phải 0). Tài khoản: ${esc(d.accounts.map((a) => `${a.label} (${a.platform === "google" ? "Google" : "Facebook"})`).join(", "))}. Lập lúc ${esc(new Date(d.generated_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }))} (giờ VN).</div>
</div></body></html>`;
}

export function messagePage(title: string, body: string, status = 404): Response {
  return new Response(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${esc(title)}</title></head><body style="font:15px system-ui;margin:15vh auto;max-width:480px;text-align:center;color:#334155"><h2>${esc(title)}</h2><p>${esc(body)}</p></body></html>`, {
    status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "x-robots-tag": "noindex" },
  });
}
