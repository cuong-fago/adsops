import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, RefreshCw } from "lucide-react";
import { checkBudgetRunwayFn, readBudgetRunwayFn, type RunwayRow } from "@/lib/adsops/budget-runway.functions";
import { money, num } from "@/lib/adsops/format";
import { formatSaigon } from "@/lib/adsops/permissions.types";
import { cn } from "@/lib/cn";

const th = "sticky top-0 z-10 whitespace-nowrap border-b border-line bg-inset px-3 py-2.5 text-left text-xs font-semibold text-muted";
const td = "border-b border-line/60 px-3 py-2 align-top";
/** Numeric columns: tighter padding so the table fits. */
const tdNum = "border-b border-line/60 px-2 py-2 align-top whitespace-nowrap text-right tabular-nums";
const thNum = "sticky top-0 z-10 whitespace-nowrap border-b border-line bg-inset px-2 py-2.5 text-right text-xs font-semibold text-muted";
/** Account column: wraps (long tokens too), stays visible while scrolling right. */
const nameTh = "sticky left-0 top-0 z-30 min-w-[220px] max-w-[320px] border-b border-r border-line bg-inset px-3 py-2.5 text-left text-xs font-semibold text-muted";
const nameTd = "sticky left-0 z-[5] min-w-[220px] max-w-[320px] border-b border-r border-line/60 px-3 py-2 align-top";
const nameText = "line-clamp-3 font-medium text-ink [overflow-wrap:anywhere]";

type SortKey = "runway" | "account" | "remaining" | "avg";

/** Lower = higher in the default list. Accounts without balance info go to the bottom. */
function rank(r: RunwayRow): number {
  if (r.runway_days != null) return 0;
  if (r.status === "no_spend") return 1;
  if (r.status === "infinite") return 2;
  if (r.status === "no_budget") return 3;
  if (r.status === "error") return 4;
  return 5;
}

function dateVi(local: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(local || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

function StatusCell({ r }: { r: RunwayRow }) {
  const pill = (cls: string, text: string, title?: string) => (
    <span title={title} className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", cls)}>
      {text}
    </span>
  );
  const main = (() => {
    switch (r.status) {
      case "red":
        return pill("bg-danger-bg font-semibold text-danger", "Còn dưới 3 ngày");
      case "amber":
        return pill("bg-warn-bg text-warn", "Còn 3–7 ngày");
      case "ok":
        return pill("bg-ok-bg text-ok", "Đủ chạy");
      case "infinite":
        return pill("bg-inset text-muted", "Không giới hạn");
      case "no_spend":
        return pill("bg-inset text-muted", "Không tiêu");
      case "no_budget":
        return pill("bg-inset text-subtle", "Google không cung cấp số dư");
      case "error":
        return pill("bg-danger-bg text-danger", "Lỗi kiểm tra", r.error_vi || "");
      default:
        return pill("bg-inset text-subtle", "Chưa kiểm tra");
    }
  })();
  return (
    <div className="flex flex-col items-start gap-1">
      {main}
      {r.expiring && r.budget_end ? pill("bg-danger-bg text-danger", `Ngân sách hết hạn ${dateVi(r.budget_end)}`) : null}
      {r.status === "error" && r.error_vi ? <span className="max-w-[16rem] truncate text-xs text-danger" title={r.error_vi}>{r.error_vi}</span> : null}
    </div>
  );
}

export function BudgetRunwayCard({ canCheck }: { canCheck: boolean }) {
  const [rows, setRows] = useState<RunwayRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [onlyRed, setOnlyRed] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "runway", dir: 1 });
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    readBudgetRunwayFn()
      .then((res) => {
        if (!cancelled) setRows(res.rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error && err.message ? err.message : "Không đọc được ngân sách.");
      });
    return () => {
      cancelled = true;
    };
  }, [epoch]);

  async function checkAll() {
    if (!rows || busy) return;
    setBusy(true);
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < rows.length; i++) {
      setProgress(`Đang kiểm tra ${i + 1}/${rows.length}: ${rows[i].label}…`);
      try {
        // Sequential; an error on one account does not stop the rest.
        const r = await checkBudgetRunwayFn({ data: { clientId: rows[i].client_id } });
        if (r.ok) ok += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
      if ((i + 1) % 10 === 0) setEpoch((n) => n + 1);
    }
    setProgress(`Xong: ${ok} tài khoản kiểm tra được${failed ? `, ${failed} lỗi` : ""}.`);
    setBusy(false);
    setEpoch((n) => n + 1);
  }

  const shown = useMemo(() => {
    const list = (rows || []).filter((r) => !onlyRed || r.status === "red" || r.expiring);
    return [...list].sort((a, b) => {
      if (sort.key === "account") return a.label.localeCompare(b.label, "vi") * sort.dir;
      const ra = rank(a);
      const rb = rank(b);
      if (sort.key === "runway") {
        if (ra !== rb) return ra - rb; // no-balance rows always at the bottom
        return ((a.runway_days ?? 0) - (b.runway_days ?? 0)) * sort.dir || a.label.localeCompare(b.label, "vi");
      }
      const va = sort.key === "remaining" ? a.remaining : a.avg7;
      const vb = sort.key === "remaining" ? b.remaining : b.avg7;
      if (va == null && vb == null) return ra - rb;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * sort.dir;
    });
  }, [rows, onlyRed, sort]);

  const redCount = (rows || []).filter((r) => r.status === "red" || r.expiring).length;
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  const head = (key: SortKey, label: string, right = false, cls?: string) => (
    <th className={cls || cn(right ? thNum : th)} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => toggle(key)} className={cn("inline-flex items-center gap-1 hover:text-ink", sort.key === key && "text-ink")}>
        {label} {sort.key === key ? sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
      </button>
    </th>
  );
  const cur = (r: RunwayRow, v: number | null) => (v == null ? "—" : money(v, r.currency || "VND"));

  return (
    <section className="mb-4 flex flex-col gap-3 rounded-xl bg-paper px-4 py-4 shadow-sheet md:px-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold tracking-tight">Ngân sách còn lại</h2>
          <p className="mt-0.5 text-sm text-muted">
            Tài khoản còn chạy được bao nhiêu ngày theo ngân sách tài khoản (account budget) và tiêu TB 7 ngày gần nhất.
          </p>
          <p className="mt-1 text-xs text-subtle">
            Tài khoản trả trước / thanh toán thủ công: Google không cung cấp số dư qua API — AdsOps không ước tính.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-line bg-paper px-3 text-sm">
            <input type="checkbox" checked={onlyRed} onChange={(e) => setOnlyRed(e.target.checked)} className="accent-[var(--color-accent)]" />
            Chỉ hiện dưới 3 ngày{rows ? ` (${redCount})` : ""}
          </label>
          {canCheck ? (
            <button
              type="button"
              disabled={busy || !rows?.length}
              onClick={() => void checkAll()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-sm font-medium text-accent-fg shadow-sm hover:opacity-95 disabled:opacity-60"
            >
              <RefreshCw className={cn("size-4", busy && "animate-spin")} /> Kiểm tra tất cả tài khoản{rows ? ` (${rows.length})` : ""}
            </button>
          ) : null}
        </div>
      </div>
      {progress ? <p className="text-sm text-muted">{progress}</p> : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!rows && !error ? <p className="py-4 text-center text-sm text-muted">Đang đọc kết quả đã lưu…</p> : null}
      {rows ? (
        <div className="relative max-h-[60vh] overflow-auto rounded-lg border border-line">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {head("account", "Tài khoản", false, nameTh)}
                <th className={th}>Hình thức</th>
                <th className={thNum}>Hạn mức</th>
                <th className={thNum}>Đã tiêu</th>
                {head("remaining", "Còn lại", true)}
                {head("avg", "Tiêu TB/ngày (7 ngày)", true)}
                {head("runway", "Số ngày còn chạy", true)}
                <th className={th}>Hết hạn</th>
                <th className={th}>Tình trạng</th>
                <th className={th}>Kiểm tra lúc</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.client_id} className={cn(r.status === "red" && "bg-danger-bg/40")}>
                  <td className={cn(nameTd, r.status === "red" ? "bg-[color-mix(in_srgb,var(--color-danger-bg)_40%,var(--color-paper))]" : "bg-paper")}>
                    <span className={nameText} title={[r.label, r.customer_id_dashed].filter(Boolean).join(" · ")}>{r.label}</span>
                    <span className="block text-xs text-subtle tabular-nums [overflow-wrap:anywhere]">{r.customer_id_dashed}</span>
                  </td>
                  <td className={cn(td, "min-w-[8rem] max-w-[10rem] text-muted")}>
                    {r.kind === "account_budget" ? "Có ngân sách tài khoản" : r.kind === "no_budget" ? "Không có số dư từ Google" : r.kind === "error" ? "—" : "Chưa kiểm tra"}
                  </td>
                  <td className={tdNum}>{r.infinite ? "Không giới hạn" : cur(r, r.limit)}</td>
                  <td className={tdNum}>{cur(r, r.served)}</td>
                  <td className={cn(tdNum, "font-medium")}>{r.infinite ? "Không giới hạn" : cur(r, r.remaining)}</td>
                  <td className={tdNum}>
                    {cur(r, r.avg7)}
                    {r.avg3 != null ? <span className="block text-xs text-subtle">3 ngày: {money(r.avg3, r.currency || "VND")}</span> : null}
                  </td>
                  <td className={cn(tdNum, "font-semibold", r.status === "red" && "text-danger", r.status === "amber" && "text-warn")}>
                    {r.runway_days != null ? num(r.runway_days, 1) : r.status === "infinite" ? "Không giới hạn" : r.status === "no_spend" ? "không tiêu" : "—"}
                  </td>
                  <td className={cn(td, "whitespace-nowrap text-muted")}>{r.budget_end ? dateVi(r.budget_end) : r.kind === "account_budget" ? "Không hết hạn" : "—"}</td>
                  <td className={td}><StatusCell r={r} /></td>
                  <td className={cn(td, "whitespace-nowrap text-xs text-muted")}>{r.checked_at ? formatSaigon(r.checked_at) : "—"}</td>
                </tr>
              ))}
              {!shown.length ? (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-sm text-muted">
                    {onlyRed ? "Không có tài khoản nào dưới 3 ngày (trong các tài khoản đã kiểm tra)." : "Chưa có tài khoản."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
