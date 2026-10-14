import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, RefreshCw } from "lucide-react";
import {
  checkOptimizationScoreFn,
  readAccountScoreFn,
  readOptimizationScoresFn,
  refreshAccountScoreFn,
  type ScoreRow,
} from "@/lib/adsops/optimization-score.functions";
import { SCORE_RED, scoreTone, type ScorePoint, type ScoreTone } from "@/lib/adsops/optimization-score.types";
import { num } from "@/lib/adsops/format";
import { formatSaigon } from "@/lib/adsops/permissions.types";
import { cn } from "@/lib/cn";
import { EmptyState, ErrorState, MiniBar, TableSkeleton, riskBarClass } from "@/components/adsops/ui";
import { InactiveBadge, InactiveToggle, useActiveFilter } from "@/components/adsops/account-activity";


/** DOM id of the card (the account-strip pill scrolls here). */
export const SCORE_CARD_ID = "optimization-score";

const th = "sticky top-0 z-10 whitespace-nowrap border-b border-line bg-row-hover px-3 py-2.5 text-left text-[13px] font-semibold text-muted";
const thNum = "sticky top-0 z-10 whitespace-nowrap border-b border-line bg-row-hover px-3 py-2.5 text-right text-[13px] font-semibold text-muted";
const td = "border-b border-line/60 px-3 py-2.5 align-top";
const tdNum = "border-b border-line/60 px-2 py-2.5 align-top whitespace-nowrap text-right font-medium tabular-nums";
const nameTh = "sticky left-0 top-0 z-30 min-w-[220px] max-w-[320px] border-b border-r border-line bg-row-hover px-3 py-2.5 text-left text-[13px] font-semibold text-muted";
const nameTd = "sticky left-0 z-[5] min-w-[220px] max-w-[320px] border-b border-r border-line/60 bg-paper px-3 py-2.5 align-top";
const nameText = "line-clamp-3 font-medium text-ink [overflow-wrap:anywhere]";

/** 0..1 → "86,3%". */
export function scorePct(score: number | null | undefined): string {
  return score == null ? "—" : `${num(score * 100, 1)}%`;
}

/** Change in points: "▲ 1,2 điểm" / "▼ 0,4 điểm" / "= 0 điểm". */
function deltaPts(d: number | null): string {
  if (d == null) return "—";
  const p = d * 100;
  if (Math.abs(p) < 0.05) return "= 0 điểm";
  return `${p > 0 ? "▲" : "▼"} ${num(Math.abs(p), 1)} điểm`;
}

function toneText(t: ScoreTone): string {
  return t === "red" ? "text-danger" : t === "amber" ? "text-warn" : t === "green" ? "text-ok" : "text-subtle";
}

function shortSaigon(isoTs: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Saigon", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", hour12: false }).formatToParts(new Date(isoTs));
  const get = (k: string) => parts.find((x) => x.type === k)?.value ?? "";
  return `${get("hour")}:${get("minute")} ${get("day")}/${get("month")}`;
}

/** Stored days only (no padding before tracking started); gaps stay gaps. */
function Sparkline({ points }: { points: ScorePoint[] }) {
  const vals = points.filter((p) => p.score != null);
  if (vals.length < 2) return <span className="text-xs text-subtle">{vals.length ? "1 ngày" : "—"}</span>;
  const w = 96;
  const h = 24;
  const min = Math.min(...vals.map((p) => p.score as number));
  const max = Math.max(...vals.map((p) => p.score as number));
  const span = max - min || 0.01;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  let d = "";
  let pen = false;
  points.forEach((p, i) => {
    if (p.score == null) { pen = false; return; }
    const x = i * step;
    const y = h - 2 - ((p.score - min) / span) * (h - 4);
    d += `${pen ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)} `;
    pen = true;
  });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="text-accent">
      <path d={d.trim()} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Account-strip pill for staff (stored score; background check when today's is missing). */
export function ScoreStrip({ clientId, onOpen }: { clientId: string; onOpen?: () => void }) {
  const [row, setRow] = useState<ScoreRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const tried = useRef(new Set<string>());
  const shownFor = useRef("");

  useEffect(() => {
    let cancelled = false;
    if (shownFor.current !== clientId) { shownFor.current = clientId; setRow(null); setLoaded(false); }
    readAccountScoreFn({ data: { clientId } })
      .then((r) => {
        if (cancelled) return;
        setRow(r);
        setLoaded(true);
        if (tried.current.has(clientId)) return;
        tried.current.add(clientId);
        // The server decides whether today's score is missing (and applies the guards).
        setRefreshing(true);
        refreshAccountScoreFn({ data: { clientId } })
          .then((res) => { if (!cancelled && res.state === "refreshed") setEpoch((n) => n + 1); })
          .catch(() => null)
          .finally(() => { if (!cancelled) setRefreshing(false); });
      })
      .catch(() => { if (!cancelled) { setRow(null); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [clientId, epoch]);

  if (!loaded) return null;
  const tone = scoreTone(row?.score);
  let text: string;
  if (!row?.checked_at) text = "Điểm tối ưu: chưa kiểm tra";
  else if (row.score == null) text = row.error_vi ? "Điểm tối ưu: chưa đọc được" : "Điểm tối ưu: Google chưa có điểm";
  else {
    const cmp = row.d1 != null ? ` · ${deltaPts(row.d1)} so với hôm qua` : row.d7 != null ? ` · ${deltaPts(row.d7)} so với 7 ngày trước` : "";
    text = `Điểm tối ưu: ${scorePct(row.score)}${cmp}`;
  }
  const when = row?.checked_at ? ` · kiểm tra lúc ${shortSaigon(row.checked_at)}` : "";
  const cls = cn(
    "inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-sm border px-2 py-0.5 text-left text-xs tabular-nums [overflow-wrap:anywhere] transition-colors",
    tone === "red" ? "border-danger-border bg-danger-bg font-semibold text-danger" : tone === "amber" ? "border-warn-border bg-warn-bg font-medium text-warn" : tone === "green" ? "border-ok-border bg-ok-bg font-medium text-ok" : "border-line bg-inset text-muted",
    onOpen ? "cursor-pointer hover:border-line-strong" : "",
  );
  const body = (
    <>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", tone === "red" ? "bg-danger" : tone === "amber" ? "bg-warn" : tone === "green" ? "bg-ok" : "bg-subtle")} />
      <span>{text}</span>
      <span className="font-normal text-subtle">{when}{refreshing ? " · đang kiểm tra…" : ""}</span>
    </>
  );
  return onOpen ? (
    <button type="button" onClick={onOpen} className={cls} title="Mở Cảnh báo → Điểm tối ưu hoá">{body}</button>
  ) : (
    <span className={cls}>{body}</span>
  );
}

type SortKey = "score" | "account" | "d1" | "d7" | "d30";

/** Run `fn` over `items` with at most `n` in flight; errors are the caller's business. */
export async function runPool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

/** Checked today (Asia/Saigon calendar day). */
export function scoredToday(checkedAt: string | null | undefined): boolean {
  if (!checkedAt) return false;
  const f = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Saigon" });
  return f(new Date(checkedAt)) === f(new Date());
}

export function OptimizationScoreCard({ canCheck }: { canCheck: boolean }) {
  const [rows, setRows] = useState<ScoreRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "score", dir: 1 });
  const [epoch, setEpoch] = useState(0);
  const [autoProgress, setAutoProgress] = useState("");
  const act = useActiveFilter(rows, (r) => r.client_id);

  useEffect(() => {
    let cancelled = false;
    readOptimizationScoresFn()
      .then((res) => { if (!cancelled) setRows(res.rows); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error && err.message ? err.message : "Không đọc được điểm tối ưu."); });
    return () => { cancelled = true; };
  }, [epoch]);

  const autoStarted = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // On open: accounts without today's score are checked in the background (score only,
  // 1 read-only GAQL each, 4 at a time). The server guards each one (lock, 30-min error cooldown).
  useEffect(() => {
    if (!rows || !act.map || autoStarted.current) return;
    autoStarted.current = true;
    // Inactive accounts are skipped in background checks (the button still checks what is shown).
    const stale = rows.filter((r) => !scoredToday(r.checked_at) && act.map?.[r.client_id]?.state !== "inactive").map((r) => r.client_id);
    if (!stale.length) return;
    let done = 0;
    void runPool(stale, 4, async (id) => {
      if (!mounted.current) return;
      const res = await refreshAccountScoreFn({ data: { clientId: id } }).catch(() => null);
      done += 1;
      if (!mounted.current) return;
      setAutoProgress(done < stale.length ? `Đang tự kiểm tra tài khoản chưa có điểm hôm nay ${done}/${stale.length}…` : "");
      if (res?.state === "refreshed" && done % 8 === 0) setEpoch((n) => n + 1);
    }).then(() => { if (mounted.current) { setAutoProgress(""); setEpoch((n) => n + 1); } });
  }, [rows, act.map]);

  async function checkAll() {
    const rows = act.shown;
    if (!rows || busy) return;
    setBusy(true);
    const list = rows.map((r) => r.client_id);
    let ok = 0;
    let failed = 0;
    let done = 0;
    setProgress(`Đang kiểm tra 0/${list.length}…`);
    // Client-side loop, one account per server call, 4 at a time: never one long server call.
    await runPool(list, 4, async (id) => {
      try {
        const r = await checkOptimizationScoreFn({ data: { clientId: id } });
        if (r.ok) ok += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
      done += 1;
      if (!mounted.current) return;
      setProgress(`Đang kiểm tra ${done}/${list.length}…`);
      if (done % 12 === 0) setEpoch((n) => n + 1); // partial table refresh
    });
    if (!mounted.current) return;
    setProgress(`Xong ${done}/${list.length}: ${ok} tài khoản đọc được điểm${failed ? `, ${failed} lỗi` : ""}.`);
    setBusy(false);
    setEpoch((n) => n + 1);
  }

  const shown = useMemo(() => {
    const list = (act.shown || []).filter((r) => !onlyLow || (r.score != null && r.score < SCORE_RED));
    const val = (r: ScoreRow) => (sort.key === "score" ? r.score : sort.key === "d1" ? r.d1 : sort.key === "d7" ? r.d7 : sort.key === "d30" ? r.d30 : null);
    return [...list].sort((a, b) => {
      if (sort.key === "account") return a.label.localeCompare(b.label, "vi") * sort.dir;
      const va = val(a);
      const vb = val(b);
      // Accounts without a value always go to the bottom.
      if (va == null && vb == null) return a.label.localeCompare(b.label, "vi");
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * sort.dir;
    });
  }, [act.shown, onlyLow, sort]);

  const lowCount = (act.shown || []).filter((r) => r.score != null && r.score < SCORE_RED).length;
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  const head = (key: SortKey, label: string, cls: string) => (
    <th className={cls} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => toggle(key)} className={cn("inline-flex items-center gap-1 hover:text-ink", sort.key === key && "text-ink")}>
        {label} {sort.key === key ? sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
      </button>
    </th>
  );
  const deltaCell = (d: number | null) => (
    <td className={cn(tdNum, d == null ? "text-subtle" : d > 0.0005 ? "text-ok" : d < -0.0005 ? "text-danger" : "text-muted")}>{deltaPts(d)}</td>
  );

  return (
    <section id={SCORE_CARD_ID} className="mb-4 flex scroll-mt-24 flex-col gap-4 rounded-xl bg-paper px-4 py-4 shadow-sheet md:px-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold tracking-tight">Điểm tối ưu hoá</h2>
          <p className="mt-0.5 text-sm text-muted">Điểm số tối ưu hoá Google Ads của từng tài khoản — dưới 70% đỏ, 70–85% vàng, từ 85% xanh.</p>
          <p className="mt-1 text-xs text-subtle">Điểm do Google tính; AdsOps chỉ đọc. AdsOps lưu lại mỗi ngày từ hôm nay để xem xu hướng.</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-line bg-paper px-3 text-sm">
            <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} className="accent-[var(--color-accent)]" />
            Chỉ hiện dưới 70%{rows ? ` (${lowCount})` : ""}
          </label>
          <InactiveToggle show={act.show} onChange={act.setShow} count={act.inactiveCount} />
          {canCheck ? (
            <button type="button" disabled={busy || !act.shown?.length} onClick={() => void checkAll()} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
              <RefreshCw className={cn("size-4", busy && "animate-spin")} /> Kiểm tra tất cả tài khoản{act.shown ? ` (${act.shown.length})` : ""}
            </button>
          ) : null}
        </div>
      </div>
      {progress ? <p className="text-sm text-muted">{progress}</p> : null}
      {autoProgress && !busy ? <p className="text-xs text-muted">{autoProgress}</p> : null}
      {error ? <ErrorState message={error} /> : null}
      {!rows && !error ? <TableSkeleton rows={6} cols={6} /> : null}
      {rows ? (
        <div className="relative max-h-[60vh] overflow-auto rounded-lg border border-line">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {head("account", "Tài khoản", nameTh)}
                {head("score", "Điểm hôm nay", thNum)}
                {head("d1", "Thay đổi 1 ngày", thNum)}
                {head("d7", "Thay đổi 7 ngày", thNum)}
                {head("d30", "Thay đổi 30 ngày", thNum)}
                <th className={th}>30 ngày đã lưu</th>
                <th className={th}>Kiểm tra lúc</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.client_id}>
                  <td className={cn(nameTd, riskBarClass(scoreTone(r.score) === "red" ? "red" : scoreTone(r.score) === "amber" ? "amber" : null))}>
                    <span className={nameText} title={[r.label, r.customer_id_dashed].filter(Boolean).join(" · ")}>{r.label}</span>
                    <span className="block text-xs text-subtle tabular-nums [overflow-wrap:anywhere]">{r.customer_id_dashed}</span>
                    <InactiveBadge activity={act.map?.[r.client_id]} />
                  </td>
                  <td className={cn(tdNum, "font-semibold", toneText(scoreTone(r.score)))}>
                    {r.score != null ? <>{scorePct(r.score)}<MiniBar className="ml-auto w-16" value={r.score} tone={scoreTone(r.score) === "red" ? "danger" : scoreTone(r.score) === "amber" ? "warn" : "ok"} /></> : !r.checked_at ? <span className="font-normal text-subtle">Chưa kiểm tra</span> : r.error_vi ? <span className="font-normal text-danger" title={r.error_vi}>Lỗi đọc</span> : <span className="font-normal text-subtle">Google chưa có điểm</span>}
                  </td>
                  {deltaCell(r.d1)}
                  {deltaCell(r.d7)}
                  {deltaCell(r.d30)}
                  <td className={td}><Sparkline points={r.series} /></td>
                  <td className={cn(td, "whitespace-nowrap text-xs text-muted")}>{r.checked_at ? formatSaigon(r.checked_at) : "—"}</td>
                </tr>
              ))}
              {!shown.length ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState title={onlyLow ? "Không có tài khoản nào dưới 70%" : "Chưa có tài khoản."} description={onlyLow ? "Trong các tài khoản đã kiểm tra." : undefined} />
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
