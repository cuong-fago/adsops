import { Fragment, useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { readStaffPerfFn } from "@/lib/adsops/manager.functions";
import type { StaffPerfRead, StaffRow } from "@/lib/adsops/staff-perf.types";
import { PACE_LABEL } from "@/lib/adsops/budget-plan.types";
import { cn } from "@/lib/cn";
import { Card, EmptyState } from "@/components/adsops/ui";

const tr = (v: number | null | undefined) => (v == null ? "—" : `${(v / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}tr`);
const dong = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v).toLocaleString("vi-VN")}đ`);
const ROLE: Record<string, string> = { admin: "Admin", head_ads: "Trưởng phòng Ads", optimizer: "Người tối ưu", sale: "Sale" };
type Key = "name" | "accounts" | "spend" | "cpl" | "pace" | "health" | "red" | "changes" | "weekly" | "optdays" | "alerts" | "drafts" | "overdue" | "churn";
const VAL: Record<Key, (r: StaffRow) => number | string | null> = {
  name: (r) => r.name, accounts: (r) => r.accounts, spend: (r) => r.cur.spend,
  cpl: (r) => (r.cur.cpl_ok == null || !r.cur.cpl_basis ? null : r.cur.cpl_ok / r.cur.cpl_basis), pace: (r) => (r.pace_ok == null || !r.pace_basis ? null : r.pace_ok / r.pace_basis),
  health: (r) => r.health_avg, red: (r) => r.red_clients, changes: (r) => r.cur.changes, weekly: (r) => (r.weekly_opt == null || !r.weekly_basis ? null : r.weekly_opt / r.weekly_basis),
  optdays: (r) => r.avg_opt_days, alerts: (r) => r.alerts, drafts: (r) => r.drafts, overdue: (r) => r.overdue_reports, churn: (r) => r.churn_high * 10 + r.churn_medium,
};
function Prev({ c, p, money = false }: { c: number | null; p: number | null; money?: boolean }) {
  if (p == null) return <span className="block text-[11px] text-subtle">kỳ trước —</span>;
  const d = c != null ? c - p : null;
  return <span className="block text-[11px] text-subtle">kỳ trước {money ? tr(p) : p}{d != null && d !== 0 ? <span className={d > 0 ? "text-ok" : "text-danger"}> ({d > 0 ? "+" : ""}{money ? tr(d) : d})</span> : null}</span>;
}
const frac = (n: number | null, b: number) => (n == null || !b ? "—" : `${n}/${b} (${Math.round((n / b) * 100)}%)`);

export function StaffPerfView({ range, onOpenAccount }: { range: { start: string | null; end: string | null }; onOpenAccount?: (id: string) => void }) {
  const [data, setData] = useState<StaffPerfRead | null>(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 }>({ k: "spend", dir: -1 });
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    readStaffPerfFn({ data: range }).then((r) => { if (live) { setData(r); setError(""); } }).catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [range]);
  if (error) return <EmptyState title={error} />;
  if (!data) return <p className="px-1 py-16 text-center text-sm text-muted">Đang tính…</p>;
  const rows = [...data.rows].sort((a, b) => {
    const x = VAL[sort.k](a), y = VAL[sort.k](b);
    if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(String(y), "vi") : x - (y as number)) * sort.dir;
  });
  const th = (k: Key, label: string, hint?: string) => (
    <th className="whitespace-nowrap px-2 py-2 text-right first:text-left" title={hint}>
      <button type="button" onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : -1 }))} className={cn("inline-flex items-center gap-0.5 hover:text-ink", sort.k === k && "text-ink")}>
        {label}{sort.k === k ? (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : null}
      </button>
    </th>
  );
  return (
    <Card className="p-4">
      <h3 className="font-semibold">Hiệu suất nhân sự</h3>
      <p className="text-xs text-muted">
        {data.period.label} · so với {data.prev.label}. Phân công = quyền tài khoản đã cấp (Phân quyền). <b>Tài khoản dùng chung được tính cho từng người được giao</b> nên tổng các dòng có thể lớn hơn tổng công ty.
        Thay đổi tối ưu: {data.author_stored ? "ghi cho người sửa theo email trên Google (user_email) khi khớp nhân sự; còn lại ghi theo phân công" : "Nhật ký chưa có email người sửa — ghi theo phân công tài khoản"}.
        Tối ưu hằng tuần: tài khoản Google có ít nhất 1 thay đổi mỗi tuần ({data.weeks} tuần trong kỳ).
      </p>
      {!rows.length ? <p className="mt-3 text-sm text-muted">Chưa có nhân sự được giao tài khoản.</p> : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted"><tr>
              {th("name", "Nhân sự")}{th("accounts", "TK / Khách")}{th("spend", "Chi tiêu")}
              {th("cpl", "Đạt CPL", "Tài khoản có CPL ≤ mục tiêu / tài khoản có mục tiêu và lead")}{th("pace", "Đúng tiến độ", "Tài khoản đúng tiến độ ngân sách tháng / tài khoản có kế hoạch")}
              {th("health", "Sức khoẻ TB", "Điểm sức khoẻ trung bình các khách (logic Bảng điều hành)")}{th("red", "Khách đỏ")}
              {th("changes", "Thay đổi", "Số thay đổi tối ưu trong Nhật ký (thêm từ khoá / phủ định / DS phủ định)")}{th("weekly", "Tối ưu hằng tuần")}{th("optdays", "TB ngày từ lần tối ưu")}
              {th("alerts", "Cảnh báo")}{th("drafts", "BC nháp")}{th("overdue", "Quá hạn BC", "Khách chưa được gửi báo cáo > 35 ngày")}{th("churn", "Nguy cơ rời bỏ", "Cao / trung bình")}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr className={cn("border-t border-line/60 align-top", open === r.id && "bg-inset")}>
                    <td className="px-2 py-1.5"><button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="text-left font-medium hover:text-accent hover:underline">{r.name}</button><span className="block text-[11px] text-subtle">{ROLE[r.role] || r.role}{r.shared_accounts ? ` · ${r.shared_accounts} TK dùng chung` : ""}</span></td>
                    <td className="px-2 text-right tabular-nums">{r.accounts || "—"} / {r.clients || "—"}</td>
                    <td className="px-2 text-right tabular-nums">{tr(r.cur.spend)}<Prev c={r.cur.spend} p={r.prev.spend} money /></td>
                    <td className="px-2 text-right tabular-nums">{frac(r.cur.cpl_ok, r.cur.cpl_basis)}<span className="block text-[11px] text-subtle">kỳ trước {frac(r.prev.cpl_ok, r.prev.cpl_basis)}</span></td>
                    <td className="px-2 text-right tabular-nums">{frac(r.pace_ok, r.pace_basis)}</td>
                    <td className={cn("px-2 text-right tabular-nums", r.health_avg != null && (r.health_avg >= 75 ? "text-ok" : r.health_avg >= 50 ? "text-warn" : "text-danger"))}>{r.health_avg ?? "—"}</td>
                    <td className="px-2 text-right tabular-nums">{r.clients ? r.red_clients : "—"}</td>
                    <td className="px-2 text-right tabular-nums" title={`${r.changes_author} theo người sửa (email) · ${r.changes_assigned} theo phân công`}>{r.cur.changes ?? "—"}<Prev c={r.cur.changes} p={r.prev.changes} /></td>
                    <td className="px-2 text-right tabular-nums">{frac(r.weekly_opt, r.weekly_basis)}</td>
                    <td className="px-2 text-right tabular-nums">{r.avg_opt_days ?? "—"}</td>
                    <td className="px-2 text-right tabular-nums">{r.accounts ? r.alerts : "—"}</td>
                    <td className="px-2 text-right tabular-nums">{r.accounts ? r.drafts : "—"}<span className="block text-[11px] text-subtle">đã gửi {r.cur.reports_sent} (trước {r.prev.reports_sent})</span></td>
                    <td className="px-2 text-right tabular-nums">{r.clients ? r.overdue_reports : "—"}</td>
                    <td className="px-2 text-right tabular-nums">{r.clients ? <><span className="text-danger">{r.churn_high}</span> / <span className="text-warn">{r.churn_medium}</span></> : "—"}</td>
                  </tr>
                  {open === r.id ? (
                    <tr className="bg-inset"><td colSpan={14} className="px-2 pb-3">
                      {!r.detail.length ? <p className="text-sm text-muted">Chưa được giao tài khoản.</p> : (
                        <table className="w-full text-xs">
                          <thead className="text-muted"><tr className="text-left"><th className="py-1">Tài khoản</th><th className="text-right">Chi tiêu</th><th className="text-right">CPL</th><th className="text-right">Mục tiêu</th><th>Tiến độ</th><th className="text-right">Sức khoẻ</th><th className="text-right">Ngày từ tối ưu</th><th>Hằng tuần</th><th>Cảnh báo</th></tr></thead>
                          <tbody>{r.detail.map((a) => (
                            <tr key={a.client_id} className="border-t border-line/60">
                              <td className="py-1">{onOpenAccount ? <button type="button" onClick={() => onOpenAccount(a.client_id)} className="hover:text-accent hover:underline">{a.label}</button> : a.label}{a.shared ? <span className="ml-1 text-subtle">(dùng chung)</span> : null}</td>
                              <td className="text-right tabular-nums">{tr(a.spend)}</td>
                              <td className={cn("text-right tabular-nums", a.cpl_ok != null && (a.cpl_ok ? "text-ok" : "text-danger"))}>{dong(a.cpl)}</td>
                              <td className="text-right tabular-nums">{dong(a.target_cpl)}</td>
                              <td>{a.pace_status ? PACE_LABEL[a.pace_status as keyof typeof PACE_LABEL] || a.pace_status : "—"}</td>
                              <td className="text-right tabular-nums">{a.health ?? "—"}</td>
                              <td className="text-right tabular-nums">{a.last_opt_days ?? "—"}</td>
                              <td>{a.weekly_opt == null ? "—" : a.weekly_opt ? "Có" : "Không"}</td>
                              <td>{a.alerts.length ? a.alerts.join("; ") : "—"}</td>
                            </tr>))}</tbody>
                        </table>
                      )}
                    </td></tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
