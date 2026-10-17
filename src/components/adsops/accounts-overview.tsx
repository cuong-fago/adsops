import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, RefreshCw } from "lucide-react";
import { recheckAccountFn, recheckSpend10Fn } from "@/lib/adsops/recheck.functions";
import { readAccountsOverviewFn, type OverviewRow } from "@/lib/adsops/accounts-overview.functions";
import { readPacingFn, type PacingRow } from "@/lib/adsops/budget-plan.functions";
import { isRedPace } from "@/lib/adsops/budget-plan.types";
import { PaceBadge } from "@/components/adsops/budget-pacing";
import { autoPullChangeLogFn, checkSharedCountsFn } from "@/lib/adsops/change-log.functions";
import { OPT_AMBER_DAYS, OPT_RED_DAYS } from "@/lib/adsops/accounts-overview.types";
import { scoreTone } from "@/lib/adsops/optimization-score.types";
import { runPool, scorePct, scoredToday } from "@/components/adsops/optimization-score-card";
import { refreshAccountScoreFn } from "@/lib/adsops/optimization-score.functions";
import { num } from "@/lib/adsops/format";
import { formatSaigon } from "@/lib/adsops/permissions.types";
import { cn } from "@/lib/cn";
import { InactiveBadge, InactiveToggle, invalidateActivity, useActiveFilter } from "@/components/adsops/account-activity";
import { Badge, DotText, EmptyState, ErrorState, MiniBar, TableSkeleton, riskBarClass, type Tone } from "@/components/adsops/ui";


type Level = "red" | "amber" | "ok" | "none";

const STALE_LOG_MS = 6 * 60 * 60 * 1000;

const th = "sticky top-0 z-10 whitespace-nowrap border-b border-line bg-row-hover px-3 py-2.5 text-left text-[13px] font-semibold text-muted";
const td = "border-b border-line/60 px-3 py-2.5 align-top";
const nameTh = "sticky left-0 top-0 z-30 min-w-[220px] max-w-[320px] border-b border-r border-line bg-row-hover px-3 py-2.5 text-left text-[13px] font-semibold text-muted";
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
const levelTone: Record<Level, Tone> = { red: "danger", amber: "warn", ok: "ok", none: "neutral" };
/** Worst level across budget / score / keyword optimisation, for the row's left accent bar. */
function rowRisk(r: OverviewRow): "red" | "amber" | null {
  const lv = [budgetLevel(r), scoreLevel(r), optLevel(r)];
  return lv.includes("red") ? "red" : lv.includes("amber") ? "amber" : null;
}
/** Budget days → 0–1 for the in-cell bar (14+ days = full). */
const RUNWAY_FULL_DAYS = 14;

function latest(...v: Array<string | null>): string | null {
  const xs = v.filter((x): x is string => Boolean(x)).sort();
  return xs.length ? xs[xs.length - 1] : null;
}

type SortKey = "urgency" | "account" | "budget" | "score" | "opt" | "checked" | "pace";

type TileId = "all" | "action" | "budget" | "score" | "opt" | "pace" | "noplan";
/** Pacing per account (filled after load; tiles read it through this module-level map). */
let PACE: Record<string, PacingRow> = {};
/** One predicate per tile: the tile count and the filtered list use the same function. */
const TILE_PRED: Record<TileId, (r: OverviewRow) => boolean> = {
  all: () => true,
  action: (r) => urgency(r) >= 100,
  budget: (r) => budgetLevel(r) === "red",
  score: (r) => scoreLevel(r) === "red",
  opt: (r) => optLevel(r) === "red",
  pace: (r) => isRedPace(PACE[r.client_id]?.status ?? null),
  noplan: (r) => Boolean(PACE[r.client_id]) && !PACE[r.client_id].plan,
};
const TILE_SORT: Record<TileId, { key: SortKey; dir: 1 | -1 }> = {
  all: { key: "urgency", dir: -1 },
  action: { key: "urgency", dir: -1 },
  budget: { key: "budget", dir: 1 },
  score: { key: "score", dir: 1 },
  opt: { key: "opt", dir: -1 },
  pace: { key: "pace", dir: -1 },
  noplan: { key: "account", dir: 1 },
};
const TILE_LABEL: Record<TileId, string> = {
  all: "Tài khoản",
  action: "Cần xử lý",
  budget: "Ngân sách dưới 3 ngày / sắp hết hạn",
  score: "Điểm tối ưu dưới 70%",
  opt: "Không tối ưu từ khoá ≥ 7 ngày",
  pace: "Tiến độ ngân sách lệch > ±25%",
  noplan: "Chưa đặt kế hoạch tháng",
};

export function AccountsOverview({ onOpenAccount, selectedClientId }: { onOpenAccount: (clientId: string) => void; selectedClientId?: string }) {
  const [rows, setRows] = useState<OverviewRow[] | null>(null);
  const [error, setError] = useState("");
  // Summary tile filter; "Cần xử lý" checkbox is the "action" tile.
  const [tile, setTile] = useState<TileId>("all");
  const onlyRed = tile === "action";
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "urgency", dir: -1 });
  const [epoch, setEpoch] = useState(0);
  const [pace, setPace] = useState<Record<string, PacingRow>>({});
  PACE = pace;
  useEffect(() => {
    let live = true;
    readPacingFn({ data: {} })
      .then((r) => { if (live) setPace(Object.fromEntries(r.rows.map((x) => [x.client_id, x]))); })
      .catch(() => { /* column stays "—" */ });
    return () => { live = false; };
  }, [epoch]);
  const act = useActiveFilter(rows, (r) => r.client_id);
  // Scope: all accounts, or the picker's account after the user changes it here.
  // All accounts by default (each time the tab opens); only an actual picker change while here scopes to one account.
  const [scopeAll, setScopeAll] = useState(true);
  const prevSel = useRef(selectedClientId);
  useEffect(() => {
    if (prevSel.current !== selectedClientId) {
      prevSel.current = selectedClientId;
      setScopeAll(false);
    }
  }, [selectedClientId]);
  const selectedRow = selectedClientId ? (rows || []).find((r) => r.client_id === selectedClientId) : undefined;
  const scoped = !scopeAll && selectedRow;
  const base = scoped ? [selectedRow] : act.shown || [];
  const allCount = (act.shown || []).length;

  // Per-row "Kiểm tra lại" (budget + score + shared counts; server: 2-min per-account lock/cooldown).
  const [rowState, setRowState] = useState<Record<string, { busy: boolean; msg: string | null; tone?: "muted" | "danger" }>>({});
  const [bulk, setBulk] = useState("");
  async function recheck(id: string): Promise<"done" | "cooldown" | "error"> {
    setRowState((s) => ({ ...s, [id]: { busy: true, msg: null } }));
    try {
      const r = await recheckAccountFn({ data: { clientId: id } });
      if (r.state === "cooldown") {
        setRowState((s) => ({ ...s, [id]: { busy: false, msg: "Vừa kiểm tra, thử lại sau", tone: "muted" } }));
        return "cooldown";
      }
      setRowState((s) => ({ ...s, [id]: { busy: false, msg: r.error_vi, tone: "danger" } }));
      return r.error_vi ? "error" : "done";
    } catch (err) {
      setRowState((s) => ({ ...s, [id]: { busy: false, msg: err instanceof Error && err.message ? err.message : "Không kiểm tra được.", tone: "danger" } }));
      return "error";
    }
  }
  async function recheckOne(id: string) {
    await recheck(id);
    invalidateActivity();
    if (mounted.current) setEpoch((n) => n + 1);
  }
  async function recheckAll(ids: string[]) {
    if (bulk) return;
    let done = 0;
    let skipped = 0;
    let failed = 0;
    setBulk(`Đang kiểm tra lại 0/${ids.length}…`);
    await runPool(ids, 4, async (id) => {
      if (!mounted.current) return;
      const r = await recheck(id);
      done += 1;
      if (r === "cooldown") skipped += 1;
      if (r === "error") failed += 1;
      if (mounted.current) setBulk(`Đang kiểm tra lại ${done}/${ids.length}…`);
      if (done % 12 === 0 && mounted.current) setEpoch((n) => n + 1);
    });
    if (!mounted.current) return;
    // Hidden accounts too: only their 10-day spend check, so any that started spending come back.
    const shownSet = new Set(ids);
    const hidden = (rows || []).map((r) => r.client_id).filter((id) => !shownSet.has(id) && act.map?.[id]?.state === "inactive");
    let back = "";
    if (hidden.length && mounted.current) {
      setBulk(`Đang kiểm tra chi tiêu 10 ngày của ${hidden.length} tài khoản đã ẩn…`);
      const r = await recheckSpend10Fn({ data: { clientIds: hidden } }).catch(() => null);
      back = r ? ` · đã ẩn: kiểm tra chi tiêu ${r.checked}/${hidden.length}${r.failed ? `, ${r.failed} lỗi` : ""}` : " · đã ẩn: không kiểm tra được chi tiêu";
    }
    if (!mounted.current) return;
    setBulk("");
    invalidateActivity();
    setRowState((s) => ({ ...s, __summary: { busy: false, msg: `Xong ${done}/${ids.length}${skipped ? ` · ${skipped} vừa kiểm tra, bỏ qua` : ""}${failed ? ` · ${failed} lỗi` : ""}${back}.`, tone: "muted" } }));
    setEpoch((n) => n + 1);
  }
  const [logProgress, setLogProgress] = useState("");
  const autoStarted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    readAccountsOverviewFn()
      .then((res) => { if (!cancelled) setRows(res.rows); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error && err.message ? err.message : "Không đọc được tổng quan."); });
    return () => { cancelled = true; };
  }, [epoch]);

  // Lives for the whole visit; a rows refresh must NOT cancel the background loop.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // Once per visit: refresh change logs older than 6 h, oldest first, 3 at a time (read-only;
  // the server re-checks freshness, lock and error cooldown, so a reload never doubles work).
  useEffect(() => {
    if (!rows || !act.map || autoStarted.current) return;
    autoStarted.current = true;
    const age = (r: OverviewRow) => (r.change_pulled_at ? Date.parse(r.change_pulled_at) : 0);
    const stale = rows
      .filter((r) => act.map?.[r.client_id]?.state !== "inactive")
      .filter((r) => !r.change_pulled_at || Date.now() - age(r) > STALE_LOG_MS)
      .sort((a, b) => age(a) - age(b));
    if (!stale.length) return;
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (mounted.current && next < stale.length) {
        const r = stale[next++];
        try {
          const res = await autoPullChangeLogFn({ data: { clientId: r.client_id } });
          if (res.state === "pulled" && mounted.current) setEpoch((n) => n + 1); // re-read the stored overview
          if (res.state === "error") console.warn("[overview] change-log auto-pull failed", r.client_id, res.error_vi);
        } catch (err) {
          console.warn("[overview] change-log auto-pull threw", r.client_id, err);
        }
        done += 1;
        if (mounted.current) setLogProgress(done < stale.length ? `Đang cập nhật nhật ký tối ưu ${done}/${stale.length}…` : "");
      }
    };
    setLogProgress(`Đang cập nhật nhật ký tối ưu 0/${stale.length}…`);
    void Promise.all([worker(), worker(), worker()]);
  }, [rows, act.map]);

  // Every open: optimization score for accounts not checked today (score only, 4 at a time, server-guarded).
  const scoresStarted = useRef(false);
  useEffect(() => {
    if (!rows || !act.map || scoresStarted.current) return;
    scoresStarted.current = true;
    const stale = rows.filter((r) => !scoredToday(r.score.checked_at) && act.map?.[r.client_id]?.state !== "inactive").map((r) => r.client_id);
    let refreshed = 0;
    void runPool(stale, 4, async (id) => {
      if (!mounted.current) return;
      const res = await refreshAccountScoreFn({ data: { clientId: id } }).catch(() => null);
      if (res?.state === "refreshed" && ++refreshed % 8 === 0 && mounted.current) setEpoch((n) => n + 1);
    }).then(() => { if (refreshed && mounted.current) setEpoch((n) => n + 1); });
  }, [rows, act.map]);

  // Every open: cheap member-count check of shared negative lists for every account (1 GAQL each).
  const countsStarted = useRef(false);
  useEffect(() => {
    if (!rows || !act.map || countsStarted.current) return;
    countsStarted.current = true;
    const list = rows.filter((r) => act.map?.[r.client_id]?.state !== "inactive").map((r) => r.client_id);
    let next = 0;
    const worker = async () => {
      while (mounted.current && next < list.length) {
        const id = list[next++];
        try {
          const r = await checkSharedCountsFn({ data: { clientId: id } });
          if (r.events && mounted.current) setEpoch((n) => n + 1);
          if (r.state === "error") console.warn("[overview] shared list check failed", id, r.error_vi);
        } catch (err) {
          console.warn("[overview] shared list check threw", id, err);
        }
      }
    };
    void Promise.all([worker(), worker(), worker(), worker()]);
  }, [rows, act.map]);

  const counts = useMemo(() => {
    const list = base;
    return {
      total: list.length,
      action: list.filter(TILE_PRED.action).length,
      budget: list.filter(TILE_PRED.budget).length,
      score: list.filter(TILE_PRED.score).length,
      opt: list.filter(TILE_PRED.opt).length,
      pace: list.filter(TILE_PRED.pace).length,
      noplan: list.filter(TILE_PRED.noplan).length,
    };
  }, [base, pace]);

  function pickTile(id: TileId) {
    const next = id === tile || id === "all" ? "all" : id;
    setTile(next);
    setSort(TILE_SORT[next]);
  }

  const shown = useMemo(() => {
    const list = base.filter(TILE_PRED[tile]);
    const val = (r: OverviewRow): number | null => {
      switch (sort.key) {
        case "urgency": return urgency(r);
        case "budget": return r.runway.runway_days;
        case "score": return r.score.score;
        case "opt": { const d = optDays(r); return d ?? (r.change_pulled_at ? 9999 : null); }
        case "pace": { const p = pace[r.client_id]?.pace; return p == null ? null : Math.abs(p); }
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
  }, [base, tile, sort, pace]);

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
    else if (w.kind === "no_budget") main = r.client_id.startsWith("fb_") ? "Không đặt giới hạn chi tiêu" : "Google không cung cấp số dư";
    else if (w.infinite || w.status === "infinite") main = "Không giới hạn";
    else if (w.status === "no_spend") main = "Không tiêu 7 ngày qua";
    else if (w.runway_days != null) main = `${num(w.runway_days, 1)} ngày`;
    else main = "—";
    const end = w.expiring && w.budget_end ? ` · hết hạn ${w.budget_end.slice(8, 10)}/${w.budget_end.slice(5, 7)}` : "";
    const lv = budgetLevel(r);
    if (!w.checked_at) return <span className="text-subtle">—</span>;
    return (
      <span className="block">
        {lv === "red" || lv === "amber" ? (
          <Badge tone={levelTone[lv]}>{main}{end}</Badge>
        ) : (
          <DotText tone={w.kind === "no_budget" || w.kind === "error" ? "neutral" : levelTone[lv]} title={w.kind === "error" ? "Chưa kiểm tra được" : undefined}>{main}{end}</DotText>
        )}
        {w.runway_days != null ? <MiniBar value={w.runway_days / RUNWAY_FULL_DAYS} tone={levelTone[lv]} /> : null}
      </span>
    );
  };

  const scoreCell = (r: OverviewRow) => {
    const s = r.score;
    if (!s.checked_at) return <span className="text-subtle">—</span>;
    if (s.score == null) return <span className="text-subtle">{s.error_vi ? "Chưa đọc được" : "Google chưa có điểm"}</span>;
    const d = s.d1 == null ? null : s.d1 * 100;
    return (
      <span className="block tabular-nums">
        {scoreLevel(r) === "red" || scoreLevel(r) === "amber" ? <Badge tone={levelTone[scoreLevel(r)]}>{scorePct(s.score)}</Badge> : <DotText tone={levelTone[scoreLevel(r)]}>{scorePct(s.score)}</DotText>}
        {d != null ? (
          <span className={cn("ml-1.5 text-xs", d > 0.05 ? "text-ok" : d < -0.05 ? "text-danger" : "text-muted")}>
            {Math.abs(d) < 0.05 ? "= 0" : `${d > 0 ? "▲" : "▼"} ${num(Math.abs(d), 1)}`} điểm / 1 ngày
          </span>
        ) : null}
        <MiniBar value={s.score} tone={levelTone[scoreLevel(r)]} />
      </span>
    );
  };

  const optCell = (r: OverviewRow) => {
    const d = optDays(r);
    const tip =
      (r.change_pulled_at ? `Nhật ký cập nhật lúc ${formatSaigon(r.change_pulled_at)}` : "Chưa kéo nhật ký tối ưu") +
      ". Phủ định trong danh sách dùng chung được ghi nhận theo lúc AdsOps phát hiện.";
    const failed = r.change_last_ok === false ? (
      <span className="mt-1 inline-flex h-5 items-center rounded-sm bg-danger-bg px-1.5 text-[11px] font-medium text-danger" title={`${r.change_last_at ? formatSaigon(r.change_last_at) + ": " : ""}${r.change_last_error || "Lỗi không rõ"}`}>
        Lỗi cập nhật nhật ký
      </span>
    ) : null;
    if (d == null) {
      return (
        <span title={tip}>
          {r.change_pulled_at ? <Badge tone={levelTone[optLevel(r)]}>Chưa ghi nhận trong 30 ngày</Badge> : <span className="text-subtle">—</span>}
          {failed}
        </span>
      );
    }
    return (
      <span className="tabular-nums" title={tip}>
        {optLevel(r) === "red" || optLevel(r) === "amber" ? <Badge tone={levelTone[optLevel(r)]}>{d === 0 ? "Hôm nay" : `${d} ngày trước`}</Badge> : <DotText tone={levelTone[optLevel(r)]}>{d === 0 ? "Hôm nay" : `${d} ngày trước`}</DotText>}
        <span className="block text-xs text-subtle">{dmy(r.last_opt_at as string)}</span>
        {r.change_pulled_at ? <span className="block text-[11px] text-subtle">nhật ký {formatSaigon(r.change_pulled_at)}</span> : null}
        {failed}
      </span>
    );
  };

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-paper px-4 py-4 shadow-sheet md:px-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold tracking-tight">Tổng quan tài khoản</h2>
          <p className="mt-0.5 text-sm text-muted">Ngân sách còn, điểm tối ưu và lần tối ưu từ khoá gần nhất của mọi tài khoản bạn được xem. Số đã lưu, không gọi Google.</p>
          <p className="mt-1 text-xs text-subtle">
            Tối ưu từ khoá = thêm từ khoá, thêm phủ định, hoặc thêm phủ định vào danh sách dùng chung (Nhật ký tối ưu; danh sách dùng chung Google không ghi người sửa). Google chỉ trả lại khoảng 30 ngày gần nhất; thay đổi qua Google Ads Editor có thể không có trong nhật ký. "—" = chưa có số đã lưu.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={Boolean(bulk) || !shown.length}
          onClick={() => void recheckAll(shown.map((r) => r.client_id))}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-paper px-3 text-sm font-medium text-ink hover:bg-inset disabled:opacity-60"
        >
          <RefreshCw className={cn("size-4", bulk && "animate-spin")} /> Kiểm tra lại tất cả ({shown.length})
        </button>
        {scoped ? null : <InactiveToggle show={act.show} onChange={act.setShow} count={act.inactiveCount} />}
        <label className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-line bg-paper px-3 text-sm">
          <input type="checkbox" checked={onlyRed} onChange={(e) => pickTile(e.target.checked ? "action" : "all")} className="accent-[var(--color-accent)]" />
          Cần xử lý{rows ? ` (${counts.action})` : ""}
        </label>
        </div>
      </div>
      {bulk || rowState.__summary?.msg ? <p className="text-xs text-muted">{bulk || rowState.__summary?.msg}</p> : null}
      {rows && selectedRow ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {scoped ? (
            <>
              <span className="inline-flex min-h-7 items-center rounded-sm border border-accent-border bg-accent-soft px-2 py-0.5 font-medium text-accent [overflow-wrap:anywhere]">Chỉ tài khoản: {selectedRow.label}</span>
              <button type="button" onClick={() => setScopeAll(true)} className="inline-flex h-7 items-center rounded-md border border-line bg-paper px-2.5 text-xs font-medium text-ink hover:bg-inset">
                Xem tất cả tài khoản ({allCount})
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setScopeAll(false)} className="inline-flex min-h-7 items-center rounded-md border border-line bg-paper px-2.5 text-xs font-medium text-ink hover:bg-inset [overflow-wrap:anywhere]">
              Chỉ tài khoản đang chọn: {selectedRow.label}
            </button>
          )}
        </div>
      ) : null}
      {rows ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          {([
            ["all", "Tài khoản", counts.total, false],
            ["action", "Cần xử lý", counts.action, true],
            ["budget", "Ngân sách dưới 3 ngày / sắp hết hạn", counts.budget, true],
            ["score", "Điểm tối ưu dưới 70%", counts.score, true],
            ["opt", "Không tối ưu từ khoá ≥ 7 ngày", counts.opt, true],
            ["pace", "Tiến độ ngân sách lệch > ±25%", counts.pace, true],
            ["noplan", "Chưa đặt kế hoạch tháng", counts.noplan, false],
          ] as Array<[TileId, string, number, boolean]>).map(([id, label, n, warn]) => {
            const on = tile === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => pickTile(id)}
                title={id === "all" ? "Hiện tất cả" : on ? "Bấm lần nữa để bỏ lọc" : "Chỉ hiện các tài khoản này"}
                className={cn(
                  "cursor-pointer rounded-xl border bg-paper px-3.5 py-3 text-left transition-colors hover:border-line-strong hover:bg-row-hover",
                  on ? "border-accent bg-accent-soft shadow-[inset_0_-2px_0_var(--color-accent)] hover:bg-accent-soft" : "border-line",
                )}
              >
                <p className={cn("text-xs font-medium", on ? "text-accent" : "text-muted")}>{label}</p>
                <p className={cn("mt-0.5 text-kpi font-semibold tracking-tight tabular-nums", warn && n > 0 ? "text-danger" : "text-ink")}>{n}</p>
              </button>
            );
          })}
        </div>
      ) : null}
      {logProgress ? <p className="text-xs text-muted">{logProgress}</p> : null}
      {error ? <ErrorState message={error} /> : null}
      {!rows && !error ? <TableSkeleton rows={8} cols={6} /> : null}
      {rows ? (
        <>
        {tile !== "all" ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex h-7 items-center rounded-sm border border-accent-border bg-accent-soft px-2 font-medium text-accent">
              Đang lọc: {TILE_LABEL[tile]} ({shown.length})
            </span>
            <button type="button" onClick={() => pickTile("all")} className="inline-flex h-7 items-center rounded-md border border-line bg-paper px-2.5 text-xs font-medium text-ink hover:bg-inset">
              Xem tất cả
            </button>
          </div>
        ) : null}
        <div className="relative max-h-[70vh] overflow-auto rounded-lg border border-line">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {head("account", "Tài khoản", nameTh)}
                {head("budget", "Ngân sách còn")}
                {head("score", "Điểm tối ưu")}
                {head("opt", "Tối ưu từ khoá gần nhất")}
                {head("pace", "Tiến độ ngân sách")}
                {head("checked", "Kiểm tra lúc")}
                <th className="sticky top-0 z-10 border-b border-line bg-row-hover px-2 py-2.5"><span className="sr-only">Kiểm tra lại</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const checked = latest(r.runway.checked_at, r.score.checked_at);
                return (
                  <tr key={r.client_id}>
                    <td className={cn(nameTd, riskBarClass(rowRisk(r)))}>
                      <button
                        type="button"
                        onClick={() => onOpenAccount(r.client_id)}
                        className="line-clamp-3 text-left font-medium text-ink hover:text-accent hover:underline [overflow-wrap:anywhere]"
                        title={[r.label, r.customer_id_dashed].filter(Boolean).join(" · ")}
                      >
                        {r.label}
                      </button>
                      <span className="block text-xs text-subtle tabular-nums [overflow-wrap:anywhere]">{r.customer_id_dashed}</span>
                      <InactiveBadge activity={act.map?.[r.client_id]} />
                    </td>
                    <td className={td}>{budgetCell(r)}</td>
                    <td className={td}>{scoreCell(r)}</td>
                    <td className={td}>{optCell(r)}</td>
                    <td className={td}>{pace[r.client_id] ? <PaceBadge r={pace[r.client_id]} /> : "—"}</td>
                    <td className={cn(td, "whitespace-nowrap text-xs text-muted")}>{checked ? formatSaigon(checked) : "—"}</td>
                    <td className={cn(td, "w-10 px-2")}>
                      <button
                        type="button"
                        disabled={rowState[r.client_id]?.busy || Boolean(bulk)}
                        onClick={() => void recheckOne(r.client_id)}
                        title="Kiểm tra lại ngân sách và điểm tối ưu ngay (chỉ đọc Google Ads)"
                        aria-label={`Kiểm tra lại ${r.label}`}
                        className="inline-flex size-8 items-center justify-center rounded-md border border-line bg-paper text-muted hover:border-line-strong hover:bg-inset hover:text-ink disabled:opacity-60"
                      >
                        <RefreshCw className={cn("size-3.5", rowState[r.client_id]?.busy && "animate-spin")} />
                      </button>
                      {rowState[r.client_id]?.msg ? (
                        <span className={cn("mt-1 block max-w-[12rem] text-[11px] [overflow-wrap:anywhere]", rowState[r.client_id]?.tone === "danger" ? "text-danger" : "text-muted")}>{rowState[r.client_id]?.msg}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {!shown.length ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      title={tile !== "all" ? `Không có tài khoản nào: ${TILE_LABEL[tile]}.` : "Chưa có tài khoản."}
                      action={tile !== "all" ? <button type="button" onClick={() => pickTile("all")} className="inline-flex h-8 items-center rounded-md border border-line bg-paper px-3 text-sm font-medium text-ink hover:bg-inset">Xem tất cả</button> : undefined}
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        </>
      ) : null}
    </section>
  );
}
