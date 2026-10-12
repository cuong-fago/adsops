import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { readAccountsOverviewFn, type OverviewRow } from "@/lib/adsops/accounts-overview.functions";
import { autoPullChangeLogFn } from "@/lib/adsops/change-log.functions";
import { OPT_AMBER_DAYS, OPT_RED_DAYS } from "@/lib/adsops/accounts-overview.types";
import { scoreTone } from "@/lib/adsops/optimization-score.types";
import { scorePct } from "@/components/adsops/optimization-score-card";
import { num } from "@/lib/adsops/format";
import { formatSaigon } from "@/lib/adsops/permissions.types";
import { cn } from "@/lib/cn";

type Level = "red" | "amber" | "ok" | "none";

const STALE_LOG_MS = 6 * 60 * 60 * 1000;

const th = "sticky top-0 z-10 whitespace-nowrap border-b border-line bg-inset px-3 py-2.5 text-left text-[13px] font-medium text-muted";
const td = "border-b border-line/60 px-3 py-2.5 align-top";
const nameTh = "sticky left-0 top-0 z-30 min-w-[220px] max-w-[320px] border-b border-r border-line bg-inset px-3 py-2.5 text-left text-[13px] font-medium text-muted";
const nameTd = "sticky left-0 z-[5] min-w-[220px] max-w-[320px] border-b border-r border-line/60 bg-paper px-3 py-2.5 align-top";

function saigonYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Saigon", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Whole days between the Asia/Saigon calendar dates. */
function daysAgo(isoTs: string): number {
  const a = Date.parse(saigonYmd(new Date(isoTs)));
  const b = Date.parse(saigonYmd(new Date()));
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function dmy(isoTs: string): string {
  const [y, m, d] = saigonYmd(new Date(isoTs)).split("-");
  return `${d}/${m}/${y}`;
}

function budgetLevel(r: OverviewRow): Level {
  const s = r.runway.status;
  if (s === "red" || r.runway.expiring) return "red";
  if (s === "amber") return "amber";
  if (s === "ok" || s === "infinite" || s === "no_spend") return "ok";
  return "none";
}

function scoreLevel(r: OverviewRow): Level {
  const t = scoreTone(r.score.score);
  return t === "green" ? "ok" : t;
}

function optDays(r: OverviewRow): number | null {
  return r.last_opt_at ? daysAgo(r.last_opt_at) : null;
}

function optLevel(r: OverviewRow): Level {
  const d = optDays(r);
  if (d == null) return r.change_pulled_at ? "red" : "none"; // pulled, nothing in ~30 days
  if (d >= OPT_RED_DAYS) return "red";
  if (d >= OPT_AMBER_DAYS) return "amber";
  return "ok";
}

function urgency(r: OverviewRow): number {
  const lv = [budgetLevel(r), scoreLevel(r), optLevel(r)];
  return lv.filter((l) => l === "red").length * 100 + lv.filter((l) => l === "amber").length * 10;
}

const toneCls: Record<Level, string> = { red: "text-danger font-semibold", amber: "text-warn font-medium", ok: "text-ink", none: "text-subtle" };

function latest(...v: Array<string | null>): string | null {
  const xs = v.filter((x): x is string => Boolean(x)).sort();
  return xs.length ? xs[xs.length - 1] : null;
}

type SortKey = "urgency" | "account" | "budget" | "score" | "opt" | "checked";

export function AccountsOverview({ onOpenAccount }: { onOpenAccount: (clientId: string) => void }) {
  const [rows, setRows] = useState<OverviewRow[] | null>(null);
  const [error, setError] = useState("");
  const [onlyRed, setOnlyRed] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "urgency", dir: -1 });
  const [epoch, setEpoch] = useState(0);
  const [logProgress, setLogProgress] = useState("");
  const autoStarted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    readAccountsOverviewFn()
      .then((res) => { if (!cancelled) setRows(res.rows); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error && err.message ? err.message : "Không đọc được tổng quan."); });
    return () => { cancelled = true; };
  }, [epoch]);

  // Once per visit: refresh change logs older than 6 h, one account at a time (read-only;
  // the server re-checks freshness, lock and error cooldown, so a reload never doubles work).
  useEffect(() => {
    if (!rows || autoStarted.current) return;
    autoStarted.current = true;
    const stale = rows.filter((r) => !r.change_pulled_at || Date.now() - Date.parse(r.change_pulled_at) > STALE_LOG_MS);
    if (!stale.length) return;
    let alive = true;
    void (async () => {
      let pulled = 0;
      for (let i = 0; i < stale.length && alive; i++) {
        setLogProgress(`Đang cập nhật nhật ký tối ưu ${i + 1}/${stale.length}…`);
        try {
          const r = await autoPullChangeLogFn({ data: { clientId: stale[i].client_id } });
          if (r.state === "pulled") pulled += 1;
        } catch {
          /* keep going */
        }
        if (pulled && pulled % 5 === 0) setEpoch((n) => n + 1);
      }
      if (!alive) return;
      setLogProgress("");
      if (pulled) setEpoch((n) => n + 1);
    })();
    return () => { alive = false; };
  }, [rows]);

  const counts = useMemo(() => {
    const list = rows || [];
    return {
      total: list.length,
      action: list.filter((r) => urgency(r) >= 100).length,
      budget: list.filter((r) => budgetLevel(r) === "red").length,
      score: list.filter((r) => scoreLevel(r) === "red").length,
      opt: list.filter((r) => optLevel(r) === "red").length,
    };
  }, [rows]);

  const shown = useMemo(() => {
    const list = (rows || []).filter((r) => !onlyRed || urgency(r) >= 100);
    const val = (r: OverviewRow): number | null => {
      switch (sort.key) {
        case "urgency": return urgency(r);
        case "budget": return r.runway.runway_days;
        case "score": return r.score.score;
        case "opt": { const d = optDays(r); return d ?? (r.change_pulled_at ? 9999 : null); }
        case "checked": { const t = latest(r.runway.checked_at, r.score.checked_at); return t ? Date.parse(t) : null; }
        default: return null;
      }
    };
    return [...list].sort((a, b) => {
      if (sort.key === "account") return a.label.localeCompare(b.label, "vi") * sort.dir;
      const va = val(a);
      const vb = val(b);
      if (va == null && vb == null) return a.label.localeCompare(b.label, "vi");
      if (va == null) return 1; // missing values always last
      if (vb == null) return -1;
      if (va !== vb) return (va - vb) * sort.dir;
      // Tie (e.g. same urgency): shortest budget runway first.
      return (a.runway.runway_days ?? Infinity) - (b.runway.runway_days ?? Infinity) || a.label.localeCompare(b.label, "vi");
    });
  }, [rows, onlyRed, sort]);

  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "opt" || key === "urgency" || key === "checked" ? -1 : 1 }));
  const head = (key: SortKey, label: string, cls = th) => (
    <th className={cls} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => toggle(key)} className={cn("inline-flex items-center gap-1 hover:text-ink", sort.key === key && "text-ink")}>
        {label} {sort.key === key ? sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
      </button>
    </th>
  );

  const budgetCell = (r: OverviewRow) => {
    const w = r.runway;
    let main: string;
    if (!w.checked_at) main = "—";
    else if (w.kind === "error") main = "Chưa kiểm tra được";
    else if (w.kind === "no_budget") main = "Google không cung cấp số dư";
    else if (w.infinite || w.status === "infinite") main = "Không giới hạn";
    else if (w.status === "no_spend") main = "Không tiêu 7 ngày qua";
    else if (w.runway_days != null) main = `${num(w.runway_days, 1)} ngày`;
    else main = "—";
    const end = w.expiring && w.budget_end ? ` · hết hạn ${w.budget_end.slice(8, 10)}/${w.budget_end.slice(5, 7)}` : "";
    return <span className={cn("tabular-nums", toneCls[budgetLevel(r)], w.kind === "no_budget" && "font-normal text-muted")}>{main}{end}</span>;
  };

  const scoreCell = (r: OverviewRow) => {
    const s = r.score;
    if (!s.checked_at) return <span className="text-subtle">—</span>;
    if (s.score == null) return <span className="text-subtle">{s.error_vi ? "Chưa đọc được" : "Google chưa có điểm"}</span>;
    const d = s.d1 == null ? null : s.d1 * 100;
    return (
      <span className="tabular-nums">
        <span className={toneCls[scoreLevel(r)]}>{scorePct(s.score)}</span>
        {d != null ? (
          <span className={cn("ml-1.5 text-xs", d > 0.05 ? "text-ok" : d < -0.05 ? "text-danger" : "text-muted")}>
            {Math.abs(d) < 0.05 ? "= 0" : `${d > 0 ? "▲" : "▼"} ${num(Math.abs(d), 1)}`} điểm / 1 ngày
          </span>
        ) : null}
      </span>
    );
  };

  const optCell = (r: OverviewRow) => {
    const d = optDays(r);
    const tip = r.change_pulled_at ? `Nhật ký cập nhật lúc ${formatSaigon(r.change_pulled_at)}` : "Chưa kéo nhật ký tối ưu";
    if (d == null) return <span className={toneCls[optLevel(r)]} title={tip}>{r.change_pulled_at ? "Chưa ghi nhận trong 30 ngày" : "—"}</span>;
    return (
      <span className="tabular-nums" title={tip}>
        <span className={toneCls[optLevel(r)]}>{d === 0 ? "Hôm nay" : `${d} ngày trước`}</span>
        <span className="block text-xs text-subtle">{dmy(r.last_opt_at as string)}</span>
        {r.change_pulled_at ? <span className="block text-[11px] text-subtle">nhật ký {formatSaigon(r.change_pulled_at)}</span> : null}
      </span>
    );
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-paper px-4 py-4 shadow-sheet md:px-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold tracking-tight">Tổng quan tài khoản</h2>
          <p className="mt-0.5 text-sm text-muted">Ngân sách còn, điểm tối ưu và lần tối ưu từ khoá gần nhất của mọi tài khoản bạn được xem. Số đã lưu, không gọi Google.</p>
          <p className="mt-1 text-xs text-subtle">
            Tối ưu từ khoá = thêm từ khoá, thêm phủ định, hoặc thêm phủ định vào danh sách dùng chung (Nhật ký tối ưu; danh sách dùng chung Google không ghi người sửa). Google chỉ trả lại khoảng 30 ngày gần nhất; thay đổi qua Google Ads Editor có thể không có trong nhật ký. "—" = chưa có số đã lưu.
          </p>
        </div>
        <label className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-line bg-paper px-3 text-sm">
          <input type="checkbox" checked={onlyRed} onChange={(e) => setOnlyRed(e.target.checked)} className="accent-[var(--color-accent)]" />
          Cần xử lý{rows ? ` (${counts.action})` : ""}
        </label>
      </div>
      {rows ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {[
            ["Tài khoản", counts.total, false],
            ["Cần xử lý", counts.action, true],
            ["Ngân sách dưới 3 ngày / sắp hết hạn", counts.budget, true],
            ["Điểm tối ưu dưới 70%", counts.score, true],
            ["Không tối ưu từ khoá ≥ 7 ngày", counts.opt, true],
          ].map(([label, n, warn]) => (
            <div key={String(label)} className="rounded-lg border border-line px-3 py-2">
              <p className="text-xs text-muted">{label}</p>
              <p className={cn("text-xl font-semibold tabular-nums", warn && Number(n) > 0 ? "text-danger" : "text-ink")}>{String(n)}</p>
            </div>
          ))}
        </div>
      ) : null}
      {logProgress ? <p className="text-xs text-muted">{logProgress}</p> : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!rows && !error ? <p className="py-4 text-center text-sm text-muted">Đang đọc số đã lưu…</p> : null}
      {rows ? (
        <div className="relative max-h-[70vh] overflow-auto rounded-lg border border-line">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {head("account", "Tài khoản", nameTh)}
                {head("budget", "Ngân sách còn")}
                {head("score", "Điểm tối ưu")}
                {head("opt", "Tối ưu từ khoá gần nhất")}
                {head("checked", "Kiểm tra lúc")}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const checked = latest(r.runway.checked_at, r.score.checked_at);
                return (
                  <tr key={r.client_id} className="hover:bg-inset/50">
                    <td className={nameTd}>
                      <button
                        type="button"
                        onClick={() => onOpenAccount(r.client_id)}
                        className="line-clamp-3 text-left font-medium text-ink hover:text-accent hover:underline [overflow-wrap:anywhere]"
                        title={[r.label, r.customer_id_dashed].filter(Boolean).join(" · ")}
                      >
                        {r.label}
                      </button>
                      <span className="block text-xs text-subtle tabular-nums [overflow-wrap:anywhere]">{r.customer_id_dashed}</span>
                    </td>
                    <td className={td}>{budgetCell(r)}</td>
                    <td className={td}>{scoreCell(r)}</td>
                    <td className={td}>{optCell(r)}</td>
                    <td className={cn(td, "whitespace-nowrap text-xs text-muted")}>{checked ? formatSaigon(checked) : "—"}</td>
                  </tr>
                );
              })}
              {!shown.length ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-muted">
                    {onlyRed ? "Không có tài khoản nào cần xử lý." : "Chưa có tài khoản."}
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
