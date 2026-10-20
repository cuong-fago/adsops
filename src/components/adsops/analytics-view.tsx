import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Columns3, Info, Search, X } from "lucide-react";
import {
  type AnalyticsSnap,
  type DeepFacets,
  type DeepLayerBlock,
  type DeepLayerId,
  type LayerBlock,
  type LayerRow,
  defaultRange,
  isDeepLayer,
  layerRows,
  monthsOverlapping,
  previousEqualRange,
  previousMonths,
  previousWeeks,
  warehouseDates,
  windowCoverage,
} from "@/lib/adsops/analytics";
import { autoFillDeepFn, autoFillWarehouseFn, readConvActionsFn, readDeepLayerFn, readQsFn, readSharesFn, readWasteFn } from "@/lib/adsops/connect.functions";
import { QS_COMPONENT_RANK, QS_COMPONENT_VI, qsTone, type QsCell, type QsRead, type WasteRead } from "@/lib/adsops/google-qs.types";
import { QS_TONE_CLASS, QsOverviewCard, WasteCard } from "@/components/adsops/google-insights";
import { BreakdownView, CallsView, useCalls } from "@/components/adsops/google-breakdown-view";
import { PacingCard } from "@/components/adsops/budget-pacing";
import { BusinessCard } from "@/components/adsops/business-outcomes";
import { GoogleTrendCard } from "@/components/adsops/google-trend-card";
import { SHARE_HINT, SHARE_LABEL, SHARE_LOWER_BETTER, fmtShare, shareBound, type ShareCells, type ShareKey, type ShareRead } from "@/lib/adsops/google-share.types";
import { convCategoryVi, type ActionCells, type ConvActionRead } from "@/lib/adsops/google-conv-actions.types";
import { addDays, formatRangeVi, moneyPlain, num, pct, statusVi } from "@/lib/adsops/format";
import { cn } from "@/lib/cn";
import { BudgetBanner } from "@/components/adsops/budget-banner";
import { Badge, EmptyState, TableSkeleton, cardClass } from "@/components/adsops/ui";
import { chartColors } from "@/components/adsops/chart-theme";

const SUBTABS = [
  { id: "overview", label: "Tổng quan" },
  { id: "monthly", label: "Theo tháng" },
  { id: "campaign", label: "Chiến dịch" },
  { id: "ad_group", label: "Nhóm" },
  { id: "keyword", label: "Từ khoá" },
  { id: "search_term", label: "Search terms" },
  { id: "breakdown", label: "Phân bổ" },
  { id: "calls", label: "Cuộc gọi" },
] as const;

type SubTab = (typeof SUBTABS)[number]["id"];
type TableLayer = "campaign" | DeepLayerId;
const TAB_KEY = "adsops:analytics:subtab:";
const SCOPE_KEY = "adsops:analytics:scope:";

function isSubTab(v: unknown): v is SubTab {
  return SUBTABS.some((t) => t.id === v);
}

function convNum(value: number) {
  return num(value, Math.abs(value - Math.round(value)) < 1e-6 ? 0 : 2);
}
function dong(value: number) {
  return `${moneyPlain(value)}đ`;
}
function dongShort(value: number) {
  const v = Math.abs(value);
  if (v >= 1e9) return `${(value / 1e9).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} tỷ`;
  if (v >= 1e6) return `${(value / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} tr`;
  return dong(value);
}
function invalidLabel(metrics: Record<string, number>) {
  const n = metrics.invalid_clicks || 0;
  const rate = metrics.invalid_click_rate || 0;
  return `${num(n, 0)} · ${(rate * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
}
function formatRangeShort(start: string, end: string) {
  const a = start.split("-");
  const b = end.split("-");
  if (a.length !== 3 || b.length !== 3) return `${start} → ${end}`;
  return `${a[2]}/${a[1]}–${b[2]}/${b[1]}`;
}
function dmy(iso: string) {
  return iso.split("-").reverse().join("/");
}
function fold(s: string) {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}
/** Subtle per-column heat tint (brand green for volume, amber for unit cost). Text stays ink. */
function heat(value: number, max: number, tone: "cool" | "warm" = "cool", min = 0): CSSProperties | undefined {
  if (!(value > 0) || !(max > 0)) return undefined;
  const lo = min > 0 && min < max ? min : 0;
  const u = Math.max(0, Math.min(1, (value - lo) / (max - lo || 1)));
  const a = 0.04 + 0.18 * u;
  return { backgroundColor: tone === "cool" ? `rgb(40 123 51 / ${a.toFixed(3)})` : `rgb(217 119 6 / ${(a * 0.85).toFixed(3)})` };
}

function InfoPopover({ label, children, align = "right" }: { label: string; children: ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-flex">
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-inset hover:text-ink">
        <Info className="size-4" />
      </button>
      {open ? (
        <div role="dialog" aria-label={label} className={cn("absolute top-10 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-line bg-paper p-4 text-left text-sm leading-relaxed text-ink shadow-sheet", align === "right" ? "right-0" : "left-0")}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status?: string }) {
  const code = String(status || "").toUpperCase();
  const live = code === "ENABLED" || code === "ACTIVE";
  const paused = code === "PAUSED";
  return <Badge tone={live ? "ok" : paused ? "warn" : "neutral"}>{statusVi(status)}</Badge>;
}

function Skeleton({ rows = 6 }: { rows?: number }) {
  return <TableSkeleton rows={rows} cols={5} />;
}

function Sparkline({ values, tone = "cool" }: { values: (number | null)[]; tone?: "cool" | "warm" }) {
  const W = 120;
  const H = 32;
  const present = values.filter((v): v is number => v != null);
  if (present.length < 2) return <div className="h-8" />;
  const max = Math.max(...present);
  const min = Math.min(0, ...present);
  const span = max - min || 1;
  const step = values.length > 1 ? W / (values.length - 1) : W;
  const segments: string[] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (cur.length) segments.push(cur.join(" "));
      cur = [];
      return;
    }
    cur.push(`${(i * step).toFixed(1)},${(H - 2 - ((v - min) / span) * (H - 4)).toFixed(1)}`);
  });
  if (cur.length) segments.push(cur.join(" "));
  const color = tone === "cool" ? chartColors.primary : chartColors.warn;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-8 w-full" aria-hidden>
      {segments.map((pts, i) =>
        pts.includes(" ") ? (
          <polyline key={i} points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ) : (
          <circle key={i} cx={pts.split(",")[0]} cy={pts.split(",")[1]} r={1.4} fill={color} />
        ),
      )}
    </svg>
  );
}

function Segmented<T extends string>({ items, value, onChange, size = "md" }: { items: readonly { id: T; label: string }[]; value: T; onChange: (v: T) => void; size?: "sm" | "md" }) {
  return (
    <div className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-md border border-line bg-inset p-0.5 [scrollbar-width:none]" role="tablist">
      {items.map((item) => (
        <button key={item.id} type="button" role="tab" aria-selected={value === item.id} onClick={() => onChange(item.id)} className={cn("shrink-0 whitespace-nowrap rounded-md font-medium transition-colors duration-150", size === "sm" ? "h-7 px-3 text-xs" : "h-8 px-3.5 text-sm", value === item.id ? "bg-paper text-ink shadow-sheet" : "text-muted hover:text-ink")}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

const card = cardClass;

export function AnalyticsView({
  snap,
  allowCompare = true,
  deepEpoch = 0,
  userKey,
  onReloadAnalytics,
}: {
  snap: AnalyticsSnap;
  allowCompare?: boolean;
  deepEpoch?: number;
  userKey?: string | null;
  /** Staff shell: re-read the analytics snapshot after the warehouse was extended. */
  onReloadAnalytics?: () => Promise<void> | void;
}) {
  const range0 = defaultRange(snap);
  const warehouseEnd = snap.warehouse_end || snap.data_through;
  const warehouseStart = snap.warehouse_start || range0.start;
  const [draftStart, setDraftStart] = useState(range0.start);
  const [draftEnd, setDraftEnd] = useState(range0.end);
  const [start, setStart] = useState(range0.start);
  const [end, setEnd] = useState(range0.end);
  const [tab, setTabState] = useState<SubTab>("overview");
  const [periodLayer, setPeriodLayer] = useState<"account" | "campaign">("campaign");
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [adGroupId, setAdGroupId] = useState<string | null>(null);
  const [adGroupLabel, setAdGroupLabel] = useState("");
  const [onlyConv, setOnlyConv] = useState(false);
  const [tableQuery, setTableQuery] = useState("");
  const [facetsByLayer, setFacetsByLayer] = useState<Partial<Record<DeepLayerId, DeepFacets>>>({});
  const [weekN, setWeekN] = useState(0);
  const [monthN, setMonthN] = useState(0);
  const [prevEqual, setPrevEqual] = useState(allowCompare);

  const storageKey = `${TAB_KEY}${userKey || "anon"}`;
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (isSubTab(saved)) setTabState(saved);
    } catch { /* storage blocked */ }
  }, [storageKey]);
  function setTab(next: SubTab) {
    setTabState(next);
    try { window.localStorage.setItem(storageKey, next); } catch { /* ignore */ }
  }

  // Last campaign / ad group filter, per user + account.
  const scopeKey = `${SCOPE_KEY}${userKey || "anon"}:${snap.client_id}`;
  const scopeLoaded = useRef("");
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(scopeKey);
      const saved = raw ? (JSON.parse(raw) as { c?: string | null; g?: string | null; gl?: string }) : null;
      if (saved?.c && snap.campaigns.some((c) => c.id === saved.c)) {
        setCampaignId(saved.c);
        setAdGroupId(saved.g || null);
        setAdGroupLabel(saved.gl || "");
      }
    } catch { /* storage blocked */ }
    scopeLoaded.current = scopeKey;
  }, [scopeKey, snap.campaigns]);
  useEffect(() => {
    if (scopeLoaded.current !== scopeKey) return;
    try {
      if (campaignId || adGroupId) window.localStorage.setItem(scopeKey, JSON.stringify({ c: campaignId, g: adGroupId, gl: adGroupLabel }));
      else window.localStorage.removeItem(scopeKey);
    } catch { /* ignore */ }
  }, [scopeKey, campaignId, adGroupId, adGroupLabel]);

  const groups = snap.conversion_groups.groups;
  function applyRange(nextStart: string, nextEnd: string) {
    setDraftStart(nextStart); setDraftEnd(nextEnd); setStart(nextStart); setEnd(nextEnd); setWeekN(0); setMonthN(0);
  }
  const daySpan = Math.round((new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 86400000) + 1;
  const presets = [
    { id: "7", label: "7 ngày", days: 7 },
    { id: "14", label: "14 ngày", days: 14 },
    { id: "30", label: "30 ngày", days: 30 },
    { id: "90", label: "90 ngày", days: 90 },
  ];
  // Calendar presets (days outside the warehouse stay blank, never 0).
  const yesterday = addDays(new Date().toLocaleDateString("en-CA", { timeZone: snap.timezone || "Asia/Saigon" }), -1);
  const monthStart = `${warehouseEnd.slice(0, 7)}-01`;
  const lastMonthEnd = addDays(monthStart, -1);
  const lastMonthStart = `${lastMonthEnd.slice(0, 7)}-01`;
  const calPresets = [
    { id: "yesterday", label: "Hôm qua", start: yesterday, end: yesterday },
    ...presets.map((p) => ({ id: p.id, label: p.label, start: addDays(warehouseEnd, -(p.days - 1)), end: warehouseEnd })),
    { id: "month", label: "Tháng này", start: monthStart, end: warehouseEnd },
    { id: "lastmonth", label: "Tháng trước", start: lastMonthStart, end: lastMonthEnd },
    { id: "all", label: "Toàn kho", start: warehouseStart, end: warehouseEnd },
  ];
  const activePreset = weekN || monthN ? "" : calPresets.find((p) => p.start === start && p.end === end)?.id || "";
  function pickDate(nextStart: string, nextEnd: string) {
    setDraftStart(nextStart); setDraftEnd(nextEnd);
    // Applies at once when the range is valid (no extra "Xem số" click).
    if (nextStart && nextEnd && nextStart <= nextEnd) applyRange(nextStart, nextEnd);
  }

  const dates = useMemo(() => warehouseDates(snap), [snap]);
  // Older snapshots carry no per-campaign Gọi/Zalo/Form split (all 0 while account has some):
  // show "—" there instead of a misleading 0.
  const splitKnown = useMemo(() => {
    const keys = ["conv_call", "conv_zalo", "conv_facebook_chat", "conv_form", "conv_other"] as const;
    const sum = (rows: Record<string, unknown>[]) =>
      rows.reduce((s, r) => s + keys.reduce((t, k) => t + Number(r[k] || 0), 0), 0);
    const acct = sum(snap.daily.account as unknown as Record<string, unknown>[]);
    return acct === 0 || sum(snap.daily.campaign as unknown as Record<string, unknown>[]) > 0;
  }, [snap]);
  const cov = windowCoverage(dates, start, end);
  const account = useMemo(() => layerRows(snap, { layer: "account", start, end }), [snap, start, end]);
  const tableLayer: TableLayer | null = tab === "campaign" || isDeepLayer(tab) ? (tab as TableLayer) : null;
  const campaignBlock = useMemo(
    () => (tab === "campaign" || tab === "overview" ? layerRows(snap, { layer: "campaign", start, end, onlyWithConv: tab === "campaign" && onlyConv }) : null),
    [snap, tab, start, end, onlyConv],
  );

  /** Bumped after an auto-fill so the table re-reads (rows stay on screen: no flicker). */
  const [fillEpoch, setFillEpoch] = useState(0);
  const [deepBlock, setDeepBlock] = useState<DeepLayerBlock | null>(null);
  /** client|layer|start|end the shown deepBlock was read for. */
  const [deepFor, setDeepFor] = useState("");
  const [deepLoading, setDeepLoading] = useState(false);
  const [deepError, setDeepError] = useState("");
  const deepShown = useRef<{ clientId: string; layer: string } | null>(null);
  const pmaxSelected = Boolean(snap.campaigns.find((c) => c.id === campaignId)?.pmax);

  useEffect(() => {
    if (!tableLayer || !isDeepLayer(tableLayer) || pmaxSelected) {
      deepShown.current = null;
      setDeepBlock(null); setDeepError(""); setDeepLoading(false); return;
    }
    let cancelled = false;
    const shown = deepShown.current;
    const keepRows = shown?.clientId === snap.client_id && shown.layer === tableLayer;
    if (!keepRows) setDeepLoading(true);
    setDeepError("");
    readDeepLayerFn({ data: { clientId: snap.client_id, layer: tableLayer, start, end, campaignId, adGroupId, onlyWithConv: onlyConv } })
      .then((block) => {
        if (cancelled) return;
        deepShown.current = { clientId: snap.client_id, layer: tableLayer };
        setDeepBlock(block); setDeepFor(`${snap.client_id}|${tableLayer}|${start}|${end}`); setDeepLoading(false);
        if (block.facets) setFacetsByLayer((prev) => ({ ...prev, [tableLayer]: block.facets as DeepFacets }));
      })
      .catch((err) => { if (!cancelled) { deepShown.current = null; setDeepBlock(null); setDeepError(err instanceof Error ? err.message : "Không đọc được lớp nhóm / từ khoá."); setDeepLoading(false); } });
    return () => { cancelled = true; };
  }, [snap.client_id, tableLayer, pmaxSelected, start, end, campaignId, adGroupId, onlyConv, deepEpoch, fillEpoch]);

  // ── Auto-fill: missing days of the deep layers are pulled (read-only) for every viewer ──
  const fillLayer = tableLayer && isDeepLayer(tableLayer) && !pmaxSelected ? tableLayer : null;
  // Google keeps search terms ~90 days: never ask for older days.
  const fillStart = fillLayer === "search_term" ? maxYmd(start, addDaysYmd(todaySaigon(), -(SEARCH_TERM_DAYS - 1))) : start;
  const fillKey = fillLayer && fillStart <= end ? `${snap.client_id}|${fillLayer}|${fillStart}|${end}` : "";
  const [fill, setFill] = useState<{ key: string; state: "filling" | "error" | "done"; x: number; y: number }>({ key: "", state: "done", x: 0, y: 0 });
  const fillTried = useRef(new Set<string>());
  const fillRun = useRef(0);
  async function runFill(key: string, retry: boolean) {
    const run = ++fillRun.current;
    const [clientId, , s, e] = key.split("|");
    setFill({ key, state: "filling", x: 0, y: 0 });
    let pulled = 0;
    let total = 0;
    let shownEarly = false;
    for (let i = 0, waits = 0; i < 30; i++) {
      let r: Awaited<ReturnType<typeof autoFillDeepFn>>;
      try {
        r = await autoFillDeepFn({ data: { clientId, start: s, end: e, retry: retry && i === 0 } });
      } catch {
        r = { state: "error", remaining_months: 0, pulled: null, error_vi: null, retry_after_s: null };
      }
      if (run !== fillRun.current) return; // range / layer / account changed
      if (r.state === "busy") {
        // Someone else is filling this account: wait, then look again.
        if (++waits > 12) { setFill({ key, state: "error", x: pulled, y: total }); return; }
        await new Promise((res) => setTimeout(res, 5000));
        if (run !== fillRun.current) return;
        setFillEpoch((n) => n + 1);
        continue;
      }
      if (r.state === "error" || r.state === "cooldown") { setFill({ key, state: "error", x: pulled, y: total }); setFillEpoch((n) => n + 1); return; }
      if (r.pulled) pulled += 1;
      total = Math.max(total, pulled + r.remaining_months);
      if (r.state === "done") break;
      setFill({ key, state: "filling", x: Math.min(pulled + 1, total), y: total });
      // First month in: show it now (rows stay; later refreshes do not blank the table).
      if (!shownEarly) { shownEarly = true; setFillEpoch((n) => n + 1); }
    }
    if (run !== fillRun.current) return;
    setFill({ key, state: "done", x: pulled, y: total });
    setFillEpoch((n) => n + 1);
  }
  useEffect(() => {
    if (!fillKey || !deepBlock || deepLoading || deepBlock.complete || fillTried.current.has(fillKey)) return;
    if (deepFor !== `${snap.client_id}|${fillLayer}|${start}|${end}`) return; // block still from the previous range
    if (fill.key === fillKey && fill.state === "filling") return;
    fillTried.current.add(fillKey);
    void runFill(fillKey, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillKey, deepBlock, deepLoading, deepFor]);
  useEffect(() => () => { fillRun.current += 1; }, []);
  // About to start (effect not run yet) counts as filling: no one-frame "empty" flash.
  const fillPending = Boolean(fillKey && deepBlock && !deepLoading && !deepBlock.complete && !fillTried.current.has(fillKey) && deepFor === `${snap.client_id}|${fillLayer}|${start}|${end}`);
  const filling = fillPending || (Boolean(fillKey) && fill.key === fillKey && fill.state === "filling");
  const fillFailed = Boolean(fillKey) && fill.key === fillKey && fill.state === "error";
  const fillLabel = `Đang tải số liệu từ Google Ads…${fill.y > 1 ? ` (tháng ${Math.max(1, fill.x)}/${fill.y})` : ""}`;

  const current: LayerBlock | DeepLayerBlock | null =
    tableLayer === "campaign" ? campaignBlock :
    pmaxSelected ? { complete: true, rows: [], pmax_note: snap.pmax_note || "PMax không có search term / keyword chuẩn" } :
    deepBlock;

  const deepLayer = tableLayer && isDeepLayer(tableLayer) ? tableLayer : null;
  const prevRange = allowCompare && prevEqual ? previousEqualRange(start, end) : null;
  const prevStart = prevRange?.start || "";
  const prevEnd = prevRange?.end || "";
  const prevAccount = useMemo(
    () => (prevStart && prevEnd ? layerRows(snap, { layer: "account", start: prevStart, end: prevEnd }) : null),
    [snap, prevStart, prevEnd],
  );
  // ── "So kỳ trước" (staff only: allowCompare is false for client roles) ─────────────
  const prevCov = prevRange ? windowCoverage(dates, prevStart, prevEnd) : null;
  const prevTotalDays = prevCov ? prevCov.present + prevCov.missing : 0;
  // Top level: extend the warehouse back to the previous start (read-only), once per start.
  const whStartNow = snap.warehouse_start || dates[0] || "";
  const [whFill, setWhFill] = useState<{ key: string; state: "filling" | "error" | "done" }>({ key: "", state: "done" });
  const whTried = useRef(new Set<string>());
  const whKey = prevRange && onReloadAnalytics && whStartNow && prevStart < whStartNow ? `${snap.client_id}|${prevStart}` : "";
  useEffect(() => {
    if (!whKey || whTried.current.has(whKey)) return;
    whTried.current.add(whKey);
    let cancelled = false;
    setWhFill({ key: whKey, state: "filling" });
    (async () => {
      for (let i = 0; i < 6; i++) {
        let r: Awaited<ReturnType<typeof autoFillWarehouseFn>>;
        try {
          r = await autoFillWarehouseFn({ data: { clientId: snap.client_id, start: prevStart } });
        } catch {
          r = { state: "error", error_vi: null };
        }
        if (cancelled) return;
        if (r.state === "busy") { await new Promise((res) => setTimeout(res, 5000)); continue; }
        if (r.state === "filled") await onReloadAnalytics?.();
        if (!cancelled) setWhFill({ key: whKey, state: r.state === "filled" || r.state === "done" ? "done" : "error" });
        return;
      }
      if (!cancelled) setWhFill({ key: whKey, state: "error" });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whKey]);
  const whFilling = Boolean(whKey) && whFill.key === whKey && whFill.state === "filling";
  const prevNoteTop: CompareNote | null = !prevRange
    ? null
    : whFilling
      ? { text: "Đang tải kỳ trước…", warn: false }
      : !prevCov?.present
        ? { text: `Kỳ trước (${formatRangeVi(prevStart, prevEnd)}) chưa có số — không so`, warn: true }
        : !prevCov.complete
          ? { text: `Kỳ trước thiếu dữ liệu (${prevCov.present}/${prevTotalDays} ngày) — so sánh chỉ tham khảo`, warn: true }
          : { text: `So với ${formatRangeVi(prevStart, prevEnd)}`, warn: false };
  const prevCampaignMap = useMemo(() => {
    if (!prevStart || !prevEnd || tableLayer !== "campaign") return null;
    const b = layerRows(snap, { layer: "campaign", start: prevStart, end: prevEnd });
    return b.rows.length || b.complete ? new Map(b.rows.map((r) => [r.id, r.metrics])) : null;
  }, [snap, prevStart, prevEnd, tableLayer]);

  // Deep layers: the same table for the previous range (server read), auto-filled when missing.
  const stTooOld = deepLayer === "search_term" && Boolean(prevStart) && prevStart < addDaysYmd(todaySaigon(), -(SEARCH_TERM_DAYS - 1));
  const prevDeepKey = prevRange && fillLayer && !stTooOld ? `${snap.client_id}|${fillLayer}|${prevStart}|${prevEnd}|${campaignId || ""}|${adGroupId || ""}` : "";
  const [prevDeep, setPrevDeep] = useState<{ key: string; block: DeepLayerBlock | null; state: "loading" | "filling" | "ready" | "error" }>({ key: "", block: null, state: "ready" });
  const prevDeepFilled = useRef(new Set<string>());
  const [prevDeepEpoch, setPrevDeepEpoch] = useState(0);
  useEffect(() => {
    if (!prevDeepKey || !fillLayer) return;
    let cancelled = false;
    setPrevDeep((cur) => (cur.key === prevDeepKey ? { ...cur, state: cur.block ? cur.state : "loading" } : { key: prevDeepKey, block: null, state: "loading" }));
    readDeepLayerFn({ data: { clientId: snap.client_id, layer: fillLayer, start: prevStart, end: prevEnd, campaignId, adGroupId, onlyWithConv: false } })
      .then((block) => { if (!cancelled) setPrevDeep({ key: prevDeepKey, block, state: "ready" }); })
      .catch(() => { if (!cancelled) setPrevDeep({ key: prevDeepKey, block: null, state: "error" }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevDeepKey, prevDeepEpoch, deepEpoch]);
  // Missing previous days: same guarded read-only fill as the table (after the main fill).
  const prevFillRange = prevRange && fillLayer && !stTooOld ? `${snap.client_id}|${prevStart}|${prevEnd}` : "";
  useEffect(() => {
    const blk = prevDeep.key === prevDeepKey ? prevDeep.block : null;
    if (!prevFillRange || !blk || blk.complete || filling || prevDeepFilled.current.has(prevFillRange)) return;
    prevDeepFilled.current.add(prevFillRange);
    let cancelled = false;
    setPrevDeep((cur) => ({ ...cur, state: "filling" }));
    (async () => {
      let failed = false;
      for (let i = 0, waits = 0; i < 20; i++) {
        let r: Awaited<ReturnType<typeof autoFillDeepFn>>;
        try {
          r = await autoFillDeepFn({ data: { clientId: snap.client_id, start: prevStart, end: prevEnd, retry: false } });
        } catch {
          failed = true; break;
        }
        if (cancelled) return;
        if (r.state === "busy") { if (++waits > 12) { failed = true; break; } await new Promise((res) => setTimeout(res, 5000)); continue; }
        if (r.state === "error" || r.state === "cooldown") { failed = true; break; }
        if (r.state === "done") break;
      }
      if (cancelled) return;
      setPrevDeep((cur) => ({ ...cur, state: failed ? "error" : "ready" }));
      setPrevDeepEpoch((n) => n + 1);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevFillRange, prevDeep, prevDeepKey, filling]);
  const prevDeepBlock = prevDeep.key === prevDeepKey ? prevDeep.block : null;
  const prevNoteDeep: CompareNote | null = !prevRange || !fillLayer
    ? null
    : stTooOld
      ? { text: `Google chỉ giữ cụm từ tìm kiếm khoảng ${SEARCH_TERM_DAYS} ngày — kỳ trước (${formatRangeVi(prevStart, prevEnd)}) quá cũ, không so`, warn: true }
      : prevDeep.key !== prevDeepKey || prevDeep.state === "loading" || prevDeep.state === "filling"
        ? { text: "Đang tải kỳ trước…", warn: false }
        : !prevDeepBlock || !prevDeepBlock.covered_days
          ? { text: `Kỳ trước (${formatRangeVi(prevStart, prevEnd)}) chưa có số — không so`, warn: true }
          : !prevDeepBlock.complete
            ? { text: `Kỳ trước thiếu dữ liệu (${prevDeepBlock.covered_days}/${prevDeepBlock.total_days} ngày) — so sánh chỉ tham khảo`, warn: true }
            : { text: `So với ${formatRangeVi(prevStart, prevEnd)}`, warn: false };
  const tableCompare: TableCompare | null = !prevRange
    ? null
    : tableLayer === "campaign"
      ? prevCampaignMap && prevCov?.present ? { map: prevCampaignMap, partial: false } : null
      : prevDeepBlock && prevDeepBlock.covered_days && !stTooOld
        ? { map: new Map(prevDeepBlock.rows.map((r) => [r.id, r.metrics])), partial: prevDeepBlock.truncated }
        : null;
  // Campaign table: the header pill already carries the top-level note.
  const tableNote = fillLayer ? prevNoteDeep : null;

  // ── Conversion actions: per-row breakdown + "Loại chuyển đổi" filter (campaign / ad group / keyword) ──
  const convLayer = tableLayer === "campaign" || tableLayer === "ad_group" || tableLayer === "keyword" ? tableLayer : null;
  const convKey = convLayer ? `${snap.client_id}|${convLayer}|${start}|${end}|${campaignId || ""}|${adGroupId || ""}|${prevStart}|${prevEnd}` : "";
  const [conv, setConv] = useState<{ key: string; data: ConvActionRead | null; state: "loading" | "ready" | "error" }>({ key: "", data: null, state: "ready" });
  const [convSel, setConvSel] = useState<Set<string>>(new Set());
  useEffect(() => { setConvSel(new Set()); }, [snap.client_id]);
  useEffect(() => {
    if (!convKey || !convLayer) return;
    let cancelled = false;
    setConv((cur) => (cur.key === convKey ? cur : { key: convKey, data: cur.data?.layer === convLayer ? cur.data : null, state: "loading" }));
    readConvActionsFn({
      data: {
        clientId: snap.client_id, layer: convLayer, start, end,
        campaignId: convLayer === "campaign" ? null : campaignId, adGroupId: convLayer === "keyword" ? adGroupId : null,
        prevStart: prevStart || null, prevEnd: prevEnd || null,
      },
    })
      .then((data) => { if (!cancelled) setConv({ key: convKey, data, state: "ready" }); })
      .catch(() => { if (!cancelled) setConv((cur) => ({ ...cur, key: convKey, state: "error" })); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convKey, deepEpoch, fillEpoch]);
  const convData = conv.data && conv.data.layer === convLayer ? conv.data : null;
  // Selected ids that exist in this read (a stale selection never zeroes the table silently).
  const convActive = useMemo(() => (convData ? [...convSel].filter((id) => convData.actions.some((a) => a.id === id)) : []), [convSel, convData]);
  const convOn = convActive.length > 0;
  const shownBlock = useMemo(() => (current && convOn && convData ? applyConvFilter(current, convData.rows, convActive) : current), [current, convOn, convData, convActive]);
  const shownCompare = useMemo<TableCompare | null>(() => {
    if (!tableCompare || !convOn || !convData) return tableCompare;
    if (!convData.prev_rows || !convData.prev_covered_days) return null;
    const map = new Map<string, Record<string, number>>();
    for (const [id, m] of tableCompare.map) map.set(id, withConv(m, convData.prev_rows[id], convActive));
    return { ...tableCompare, map };
  }, [tableCompare, convOn, convData, convActive]);
  // ── Impression share (range aggregate from Google, cached per range) ──
  const shareLayer = convLayer ?? (tab === "overview" ? "campaign" : null);
  const shareKey = shareLayer ? `${snap.client_id}|${shareLayer}|${start}|${end}|${prevStart}|${prevEnd}` : "";
  const [shareSt, setShareSt] = useState<{ key: string; data: ShareRead | null }>({ key: "", data: null });
  useEffect(() => {
    if (!shareKey || !shareLayer) return;
    let cancelled = false;
    setShareSt((cur) => (cur.key === shareKey ? cur : { key: shareKey, data: null }));
    readSharesFn({ data: { clientId: snap.client_id, layer: shareLayer, start, end, prevStart: prevStart || null, prevEnd: prevEnd || null } })
      .then((data) => { if (!cancelled) setShareSt({ key: shareKey, data }); })
      .catch(() => { if (!cancelled) setShareSt({ key: shareKey, data: null }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareKey]);
  const shareData = shareSt.key === shareKey && shareSt.data && shareSt.data.layer === shareLayer ? shareSt.data : null;
  // ── Quality Score (keyword tab + overview) and wasted search-term spend (search terms + overview) ──
  const qsOn = tab === "keyword" || tab === "overview";
  const qsKey = qsOn ? `${snap.client_id}|${start}|${end}` : "";
  const [qsSt, setQsSt] = useState<{ key: string; data: QsRead | null; loading: boolean }>({ key: "", data: null, loading: false });
  useEffect(() => {
    if (!qsKey) return;
    let cancelled = false;
    setQsSt((cur) => (cur.key === qsKey ? cur : { key: qsKey, data: cur.data, loading: true }));
    readQsFn({ data: { clientId: snap.client_id, start, end } })
      .then((data) => { if (!cancelled) setQsSt({ key: qsKey, data, loading: false }); })
      .catch(() => { if (!cancelled) setQsSt({ key: qsKey, data: null, loading: false }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qsKey, deepEpoch]);
  const qsData = qsSt.key === qsKey ? qsSt.data : null;
  const wasteOn = tab === "search_term" || tab === "overview";
  const wasteKey = wasteOn ? `${snap.client_id}|${start}|${end}|${prevStart}|${prevEnd}` : "";
  const [wasteSt, setWasteSt] = useState<{ key: string; data: WasteRead | null; loading: boolean }>({ key: "", data: null, loading: false });
  useEffect(() => {
    if (!wasteKey) return;
    let cancelled = false;
    setWasteSt((cur) => (cur.key === wasteKey ? cur : { key: wasteKey, data: null, loading: true }));
    readWasteFn({ data: { clientId: snap.client_id, start, end, prevStart: prevStart || null, prevEnd: prevEnd || null } })
      .then((data) => { if (!cancelled) setWasteSt({ key: wasteKey, data, loading: false }); })
      .catch(() => { if (!cancelled) setWasteSt({ key: wasteKey, data: null, loading: false }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wasteKey]);
  const wasteData = wasteSt.key === wasteKey ? wasteSt.data : null;
  // "Cuộc gọi" tab only when the account has calls in the range (cached call_view read).
  const callsProbe = useCalls(snap.client_id, start, end, "", true);
  const hasCalls = Boolean(callsProbe.data && callsProbe.data.total > 0);
  const campaignOpts = useMemo(() => [...snap.campaigns].map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name, "vi")), [snap.campaigns]);
  const campaignHints = useMemo(
    () => (shareData && shareData.layer === "campaign" ? shareHints(campaignBlock?.rows || [], shareData.rows, account.rows[0]?.metrics || {}) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shareData, campaignBlock, account],
  );
  const convDetail = convData
    ? (row: LayerRow) => <ConvBreakdown row={row} cells={convData.rows[row.id]} names={convData.actions} highlight={convActive} />
    : undefined;

  const weeks = allowCompare && weekN ? previousWeeks(end, weekN) : [];
  const prevMonths = allowCompare && monthN ? previousMonths(end, monthN) : [];
  const inMonths = monthsOverlapping(start, end);
  const periodCols =
    weeks.length > 0
      ? weeks.map((w, i) => ({ id: `w${i}`, label: formatRangeShort(w.start, w.end), sub: "T2–CN", start: w.start, end: w.end, complete: windowCoverage(dates, w.start, w.end).complete }))
      : monthN > 0
        ? prevMonths.map((m, i) => ({ id: `pm${i}`, label: m.label, sub: formatRangeShort(m.start, m.end), start: m.start, end: m.end, complete: windowCoverage(dates, m.start, m.end).complete }))
        : inMonths.map((m, i) => ({ id: `im${i}`, label: m.label, sub: formatRangeShort(m.start, m.end), start: m.start, end: m.end, complete: windowCoverage(dates, m.calendar_start, m.calendar_end).complete }));

  const periodColsKey = periodCols.map((c) => `${c.id}:${c.start}:${c.end}:${c.complete}`).join("|");
  const periodBlocks = useMemo(
    () => (tab === "monthly" ? periodCols.map((col) => ({ ...layerRows(snap, { layer: periodLayer, start: col.start, end: col.end }), complete: col.complete })) : []),
    // periodCols rebuilt each render; key captures identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, snap, periodLayer, periodColsKey],
  );
  const periodAccountBlocks = useMemo(
    () =>
      tab !== "monthly" ? [] :
      periodLayer === "account" ? periodBlocks :
      periodCols.map((col) => ({ ...layerRows(snap, { layer: "account", start: col.start, end: col.end }), complete: col.complete })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, snap, periodLayer, periodBlocks, periodColsKey],
  );

  const metrics = account.rows[0]?.metrics || {};
  // Partial previous periods still compare (labelled "chỉ tham khảo"); none at all → no compare.
  const prevMetrics = prevAccount?.rows.length ? prevAccount.rows[0]?.metrics : undefined;
  const facets = deepLayer ? facetsByLayer[deepLayer] : undefined;
  const scoped = Boolean(deepLayer && (campaignId || (adGroupId && deepLayer !== "ad_group")));
  useEffect(() => { setTableQuery(""); }, [tableLayer]);

  function drill(row: LayerRow) {
    if (tableLayer === "campaign") { setCampaignId(row.id); setAdGroupId(null); setTab(row.pmax ? "search_term" : "ad_group"); }
    else if (tableLayer === "ad_group") { setAdGroupId(row.id); setAdGroupLabel(row.name); setTab("keyword"); }
  }
  function clearScope() { setCampaignId(null); setAdGroupId(null); setAdGroupLabel(""); }
  function clearFilters() { clearScope(); setTableQuery(""); }
  const rangeLabel = formatRangeVi(start, end);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {snap.budget_pace && <BudgetBanner pace={snap.budget_pace} currency={snap.currency} />}

      <div className="z-30 -mx-4 bg-bg/90 px-4 pb-1 pt-2 backdrop-blur md:sticky md:top-0 md:-mx-1 md:px-1">
        <div className={cn(card, "flex flex-col gap-3 p-3 md:p-4")}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium uppercase tracking-wider text-subtle">Phân tích · {snap.display_name}</p>
              <p className="font-display text-xl font-semibold tracking-tight tabular-nums md:text-2xl">
                {rangeLabel}
                <span className="ml-2 align-middle font-sans text-sm font-normal text-muted">{daySpan} ngày</span>
              </p>
            </div>
            <InfoPopover label="Giải thích số liệu">
              <p className="font-medium">Về số liệu</p>
              <ul className="mt-2 list-disc space-y-1.5 pl-4 text-muted">
                <li>Chỉ đọc từ Google Ads — không apply, không sửa tài khoản.</li>
                <li>Chuyển đổi Google (CPA / Platform CPL) ≠ Qualified Lead. All conversions không gộp vào.</li>
                <li>Cột Gọi / Zalo / Facebook chat / Form map từ conversion action của tài khoản này. Secondary (page view) không lên màn.</li>
                <li>CPC / CTR / CR / chi phí mỗi chuyển đổi tính trên mọi click. Conv = 0 → chi/conv = 0.</li>
                <li>Ngày không có số để trống (—), không điền 0, không ngoại suy.</li>
                <li>Màu nền ô = độ lớn trong cột (xanh Fago: khối lượng; vàng: chi phí trên đơn vị).</li>
                <li>Timezone {snap.timezone}.</li>
                {snap.warehouse_start ? (
                  <li>Kho {dmy(snap.warehouse_start)} → {dmy(warehouseEnd)}{typeof snap.day_count === "number" ? ` (${snap.day_count} ngày có số)` : ""}{typeof snap.analytics_lookback_days === "number" ? ` · lần kéo đầy đủ gần nhất ${snap.analytics_lookback_days} ngày` : ""}.</li>
                ) : null}
                {prevRange ? <li>So với {formatRangeVi(prevRange.start, prevRange.end)}.</li> : null}
              </ul>
            </InfoPopover>
          </div>

          <div className="flex flex-col gap-2 border-t border-line pt-3" role="group" aria-label="Khoảng thời gian">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-sm font-semibold text-ink">Khoảng thời gian</span>
              {calPresets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyRange(p.start, p.end)}
                  aria-pressed={activePreset === p.id}
                  className={cn("h-9 rounded-md border px-3 text-sm font-medium transition-colors", activePreset === p.id ? "border-accent-border bg-accent-soft font-semibold text-accent" : "border-line bg-paper text-ink hover:bg-inset")}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">Từ<input type="date" value={draftStart} min={snap.warehouse_start || undefined} max={warehouseEnd} onChange={(e) => pickDate(e.target.value, draftEnd)} className="h-10 rounded-md border border-line bg-bg px-2.5 text-sm text-ink" /></label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">Đến<input type="date" value={draftEnd} min={snap.warehouse_start || undefined} max={warehouseEnd} onChange={(e) => pickDate(draftStart, e.target.value)} className="h-10 rounded-md border border-line bg-bg px-2.5 text-sm text-ink" /></label>
              {draftStart && draftEnd && draftStart > draftEnd ? <span className="pb-2.5 text-xs text-danger">Ngày bắt đầu sau ngày kết thúc.</span> : null}
              {allowCompare ? (
                <>
                  <label className="flex h-9 items-center gap-2 rounded-md border border-line bg-inset px-3 text-sm"><input type="checkbox" checked={prevEqual} onChange={(e) => setPrevEqual(e.target.checked)} className="size-4 accent-accent" />So kỳ trước cùng độ dài{prevRange ? <span className="text-xs text-muted">({formatRangeShort(prevStart, prevEnd)})</span> : null}</label>
                  {snap.week_choices.length ? (
                    <label className="flex h-9 items-center gap-2 rounded-md border border-line bg-inset px-3 text-sm">Tuần
                      <select value={weekN} onChange={(e) => { setWeekN(Number(e.target.value)); setMonthN(0); if (Number(e.target.value)) setTab("monthly"); }} className="h-8 bg-transparent text-sm">
                        <option value={0}>—</option>
                        {snap.week_choices.map((n) => <option key={n} value={n}>{n} tuần (T2–CN)</option>)}
                      </select>
                    </label>
                  ) : null}
                  <label className="flex h-9 items-center gap-2 rounded-md border border-line bg-inset px-3 text-sm">Các tháng trước
                    <select value={monthN} onChange={(e) => { setMonthN(Number(e.target.value)); setWeekN(0); if (Number(e.target.value)) setTab("monthly"); }} className="h-8 bg-transparent text-sm">
                      <option value={0}>—</option>
                      {(snap.month_choices.length ? snap.month_choices : [1, 2, 3, 4, 5, 6, 7, 8, 9]).map((n) => <option key={n} value={n}>{n} tháng</option>)}
                    </select>
                  </label>
                </>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented items={SUBTABS.filter((s) => s.id !== "calls" || hasCalls || tab === "calls")} value={tab} onChange={setTab} />
            {prevNoteTop && (tab === "overview" || tableLayer === "campaign") ? (
              <span className={cn("inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium", prevNoteTop.warn ? "bg-warn-bg text-warn" : "bg-inset text-muted")}>{prevNoteTop.text}</span>
            ) : null}
            {!cov.complete ? (
              <span className="inline-flex items-center gap-1.5 rounded-sm bg-warn-bg px-2 py-0.5 text-xs font-medium text-warn">Kho có số {cov.present}/{cov.present + cov.missing} ngày trong khoảng · ngày thiếu để trống</span>
            ) : null}
          </div>
        </div>
      </div>

      {tab === "overview" ? (
        <Overview snap={snap} start={start} end={end} metrics={metrics} prevMetrics={prevRange ? prevMetrics : undefined} prevIncomplete={Boolean(prevRange && prevAccount && !prevAccount.complete)} prevLoading={whFilling} hasRows={account.rows.length > 0} campaigns={campaignBlock?.rows || []} groups={groups} hints={campaignHints} onOpenCampaigns={() => setTab("campaign")} onPickCampaign={(row) => { setCampaignId(row.id); setAdGroupId(null); setTab(row.pmax ? "search_term" : "ad_group"); }} />
      ) : null}

      {tab === "monthly" ? (
        <PeriodSection title={weeks.length ? "Từng tuần cạnh nhau" : monthN ? "Các tháng trước" : "Theo tháng"} cols={periodCols} blocks={periodBlocks} accountBlocks={periodAccountBlocks} groups={groups} layer={periodLayer} onLayerChange={setPeriodLayer} splitKnown={splitKnown} onWholeWarehouse={() => applyRange(warehouseStart, warehouseEnd)} onPickCampaign={(id) => { const pm = snap.campaigns.find((c) => c.id === id)?.pmax; setCampaignId(id); setAdGroupId(null); setTab(pm ? "search_term" : "ad_group"); }} />
      ) : null}

      {tab === "overview" ? <PacingCard clientId={snap.client_id} /> : null}
      {tab === "overview" ? <BusinessCard clientId={snap.client_id} /> : null}
      {tab === "overview" && allowCompare ? <GoogleTrendCard clientId={snap.client_id} /> : null}
      {tab === "overview" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <QsOverviewCard data={qsData} loading={qsSt.loading} />
          <WasteCard data={wasteData} loading={wasteSt.loading} compact />
        </div>
      ) : null}
      {tab === "breakdown" ? <BreakdownView clientId={snap.client_id} start={start} end={end} campaigns={campaignOpts} /> : null}
      {tab === "calls" ? <CallsView clientId={snap.client_id} start={start} end={end} campaigns={campaignOpts} /> : null}
      {tableLayer === "search_term" ? <WasteCard data={wasteData} loading={wasteSt.loading} /> : null}

      {tableLayer ? (
        <section className={cn(card, "flex min-w-0 flex-col gap-3 p-3 md:p-4")}>
          {deepLayer ? (
            <ScopeFilters
              layer={deepLayer}
              facets={facets}
              campaigns={snap.campaigns}
              campaignId={campaignId}
              adGroupId={adGroupId}
              adGroupLabel={adGroupLabel}
              onCampaign={(id) => { setCampaignId(id); setAdGroupId(null); setAdGroupLabel(""); }}
              onAdGroup={(id, label, cid) => { setAdGroupId(id); setAdGroupLabel(label); if (id && cid) setCampaignId(cid); }}
              onlyConv={onlyConv}
              onOnlyConv={setOnlyConv}
              canClear={scoped || Boolean(tableQuery) || onlyConv}
              onClear={() => { clearFilters(); setOnlyConv(false); }}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex h-9 items-center gap-2 rounded-md border border-line bg-inset px-3 text-sm"><input type="checkbox" checked={onlyConv} onChange={(e) => setOnlyConv(e.target.checked)} className="size-4 accent-accent" />Chỉ có conv</label>
            </div>
          )}
          {convLayer ? (
            <ConvActionFilter data={convData} loading={conv.state === "loading" && !convData} error={conv.state === "error"} selected={convActive} onChange={(ids) => setConvSel(new Set(ids))} />
          ) : null}
          {(() => {
            const deepRows = fillLayer ? deepBlock?.rows.length || 0 : 0;
            const retryBtn = (
              <button type="button" onClick={() => fillKey && void runFill(fillKey, true)} className="h-8 shrink-0 rounded-lg border border-line bg-paper px-3 text-sm font-medium text-ink hover:bg-inset">
                Thử lại
              </button>
            );
            if (fillLayer && (deepLoading || (filling && !deepRows))) {
              return (
                <div className="space-y-2">
                  {filling ? <FillProgress label={fillLabel} x={fill.x} y={fill.y} /> : null}
                  <Skeleton rows={8} />
                </div>
              );
            }
            if (deepError && fillLayer) return <p className="rounded-md bg-warn-bg px-4 py-6 text-sm text-warn">{deepError}</p>;
            if (fillLayer && fillFailed && !deepRows) {
              return (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-inset px-4 py-5 text-sm text-muted">
                  <span>Chưa lấy được số liệu từ Google Ads. Thử lại sau ít phút.</span>
                  {retryBtn}
                </div>
              );
            }
            if (!current) return <p className="rounded-md bg-inset px-4 py-6 text-sm text-muted">Chưa có số liệu cho khoảng ngày này.</p>;
            return (
              <div className="space-y-2">
                {tableNote ? <p className={cn("text-xs", tableNote.warn ? "text-warn" : "text-subtle")}>{tableNote.text}</p> : null}
                {fillLayer && filling ? <p className="text-xs text-subtle">Đang bổ sung các ngày còn thiếu…{fill.y > 1 ? ` (tháng ${Math.max(1, fill.x)}/${fill.y})` : ""}</p> : null}
                {fillLayer && fillFailed ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
                    <span>Chưa lấy được các ngày còn thiếu từ Google Ads. Thử lại sau ít phút.</span>
                    {retryBtn}
                  </div>
                ) : null}
                <DataTable key={`${tableLayer}:${campaignId}:${adGroupId}`} layer={tableLayer} block={shownBlock || current} convDetail={convDetail} groups={groups} canDrill={tableLayer === "campaign" || tableLayer === "ad_group"} onDrill={drill} splitKnown={splitKnown} campaignNames={Object.fromEntries(snap.campaigns.map((c) => [c.id, c.name]))} query={tableQuery} onQueryChange={setTableQuery} scoped={scoped} totalAll={facets?.total_rows} emptyText={fillLayer ? deepEmptyText(fillLayer, current as DeepLayerBlock) : undefined} compare={shownCompare} storeKey={userKey} share={shareData && shareData.layer === tableLayer ? shareData : null} shareCompare={Boolean(prevRange)} hints={tableLayer === "campaign" ? campaignHints : undefined} qs={tableLayer === "keyword" ? qsData?.rows || null : null} />
              </div>
            );
          })()}
        </section>
      ) : null}
    </div>
  );
}

type KpiDef = {
  id: string;
  label: string;
  value: (m: Record<string, number>) => string;
  daily: (r: Record<string, number>) => number | null;
  tone?: "cool" | "warm";
  primary?: boolean;
  hint?: string;
};

const KPIS: KpiDef[] = [
  { id: "cost", label: "Chi tiêu", value: (m) => dong(m.cost || 0), daily: (r) => r.cost || 0, primary: true },
  { id: "conversions", label: "Chuyển đổi (primary)", value: (m) => convNum(m.conversions || 0), daily: (r) => r.conversions || 0, primary: true, hint: "Chuyển đổi Google ≠ Qualified Lead" },
  { id: "cost_per_conversion", label: "Platform CPL", value: (m) => dong(m.cost_per_conversion || 0), daily: (r) => (r.conversions ? (r.cost || 0) / r.conversions : null), tone: "warm", primary: true, hint: "CPA Google ≠ Qualified Lead" },
  { id: "clicks", label: "Click", value: (m) => num(m.clicks || 0), daily: (r) => r.clicks || 0, primary: true },
  { id: "impressions", label: "Hiển thị", value: (m) => num(m.impressions || 0), daily: (r) => r.impressions || 0 },
  { id: "ctr", label: "CTR", value: (m) => pct(m.ctr || 0), daily: (r) => (r.impressions ? (r.clicks || 0) / r.impressions : null) },
  { id: "cpc", label: "CPC (mọi click)", value: (m) => dong(m.cpc || 0), daily: (r) => (r.clicks ? (r.cost || 0) / r.clicks : null), tone: "warm" },
  { id: "invalid_clicks", label: "Click không hợp lệ", value: (m) => invalidLabel(m), daily: (r) => r.invalid_clicks || 0, tone: "warm" },
];

type CompareNote = { text: string; warn: boolean };
/** Previous-period rows by id. `partial` = the server capped the list (missing ≠ new). */
type TableCompare = { map: Map<string, Record<string, number>>; partial: boolean };

/** Which direction is good for a metric (colour of the delta). */
const METRIC_BETTER: Record<string, "up" | "down" | "neutral"> = {
  cost: "neutral",
  impressions: "up",
  clicks: "up",
  conversions: "up",
  ctr: "up",
  cpc: "down",
  cost_per_conversion: "down",
};
/** Table columns that get a delta line. */
const DELTA_COLS = new Set(["cost", "clicks", "conversions", "cost_per_conversion", "ctr", "cpc"]);

/**
 * Change vs the previous period, or null when there is nothing honest to say
 * (ratios need a non-zero base in both periods; 0 → 0 says nothing).
 */
function metricDelta(key: string, now: Record<string, number>, prev: Record<string, number>): { text: string; tone: "good" | "bad" | "flat" } | null {
  const base = key === "cost_per_conversion" ? "conversions" : key === "cpc" ? "clicks" : key === "ctr" ? "impressions" : null;
  if (base && (!(now[base] > 0) || !(prev[base] > 0))) return null;
  const n = Number(now[key] || 0);
  const p = Number(prev[key] || 0);
  if (n === 0 && p === 0) return null;
  const better = METRIC_BETTER[key] || "neutral";
  const toneOf = (up: boolean) => (better === "neutral" ? "flat" : (better === "up") === up ? "good" : "bad");
  if (p === 0) return { text: "▲ từ 0", tone: toneOf(true) };
  const d = (n - p) / Math.abs(p);
  if (Math.abs(d) < 0.005) return { text: "= 0%", tone: "flat" };
  const pctTxt = Math.abs(d) >= 10 ? ">999%" : `${Math.round(Math.abs(d) * 100)}%`;
  return { text: `${d > 0 ? "▲" : "▼"} ${pctTxt}`, tone: toneOf(d > 0) };
}

function DeltaText({ d, className }: { d: { text: string; tone: "good" | "bad" | "flat" } | null; className?: string }) {
  if (!d) return null;
  return <span className={cn("text-xs font-normal tabular-nums", d.tone === "good" ? "text-ok" : d.tone === "bad" ? "text-danger" : "text-subtle", className)}>{d.text}</span>;
}

function Overview({
  snap, start, end, metrics, prevMetrics, prevIncomplete, prevLoading = false, hasRows, campaigns, groups, onOpenCampaigns, onPickCampaign, hints = {},
}: {
  hints?: Record<string, CampaignHint[]>;
  snap: AnalyticsSnap; start: string; end: string; metrics: Record<string, number>; prevMetrics?: Record<string, number>;
  prevIncomplete: boolean; prevLoading?: boolean; hasRows: boolean; campaigns: LayerRow[];
  groups: { id: string; label: string; metric: string; actions?: string[] }[];
  onOpenCampaigns: () => void; onPickCampaign: (row: LayerRow) => void;
}) {
  const series = useMemo(() => {
    const byDate = new Map(snap.daily.account.map((r) => [r.date, r as unknown as Record<string, number>]));
    const days: (Record<string, number> | null)[] = [];
    let cur = start; let guard = 0;
    while (cur <= end && guard < 800) { days.push(byDate.get(cur) || null); cur = addDays(cur, 1); guard += 1; }
    return days;
  }, [snap, start, end]);

  if (!hasRows) return <section className={cn(card, "px-5 py-10 text-center text-sm text-muted")}>Thiếu dữ liệu trong khoảng này — không đoán số.</section>;
  const totalConv = groups.reduce((s, g) => s + Number(metrics[g.metric] || 0), 0);
  const top = campaigns.slice(0, 6);
  const maxCost = Math.max(0, ...top.map((r) => r.metrics.cost || 0));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPIS.filter((k) => k.primary).map((k) => (
          <KpiCard key={k.id} def={k} metrics={metrics} prev={prevMetrics} prevIncomplete={prevIncomplete} prevLoading={prevLoading} values={series.map((d) => (d ? k.daily(d) : null))} big />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPIS.filter((k) => !k.primary).map((k) => (
          <KpiCard key={k.id} def={k} metrics={metrics} prev={prevMetrics} prevIncomplete={prevIncomplete} prevLoading={prevLoading} values={series.map((d) => (d ? k.daily(d) : null))} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <section className={cn(card, "p-4 lg:col-span-2")}>
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold tracking-tight">Loại chuyển đổi</h3>
            <InfoPopover label="Giải thích loại chuyển đổi">
              <p className="text-muted">Map từ conversion action của tài khoản đang xem. Chuyển đổi Google ≠ Qualified Lead. All conversions không gộp.</p>
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {groups.map((g) => (
                  <li key={g.id}><span className="font-medium text-ink">{g.label}:</span> {(g.actions && g.actions.length) ? g.actions.join(", ") : "không có action"}</li>
                ))}
              </ul>
            </InfoPopover>
          </div>
          <ul className="mt-3 space-y-2.5">
            {groups.map((g) => {
              const v = Number(metrics[g.metric] || 0);
              const share = totalConv > 0 ? v / totalConv : 0;
              return (
                <li key={g.id}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-muted">{g.label}</span>
                    <span className="font-medium tabular-nums">{convNum(v)}<span className="ml-2 text-xs font-normal text-subtle">{totalConv > 0 ? pct(share) : "—"}</span></span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-sm bg-inset"><div className="h-full rounded-sm bg-accent" style={{ width: `${(share * 100).toFixed(1)}%` }} /></div>
                </li>
              );
            })}
          </ul>
        </section>
        <section className={cn(card, "p-4 lg:col-span-3")}>
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold tracking-tight">Chiến dịch chi nhiều nhất</h3>
            <button type="button" onClick={onOpenCampaigns} className="inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium text-accent hover:bg-inset">Xem tất cả ({campaigns.length}) <ChevronRight className="size-4" /></button>
          </div>
          {top.length === 0 ? <EmptyState title="Không có chiến dịch có số trong khoảng này." className="py-6" /> : (
            <ul className="mt-2 divide-y divide-line">
              {top.map((row) => (
                <li key={row.id}>
                  <button type="button" onClick={() => onPickCampaign(row)} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 py-2.5 text-left hover:bg-inset/40">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium" title={row.name}>{row.name}</span>
                      {row.pmax ? <span className="shrink-0 rounded-sm bg-inset px-1.5 py-0.5 text-[11px] font-medium text-muted">PMax</span> : null}
                    </span>
                    <span className="text-right text-sm font-medium tabular-nums">{dongShort(row.metrics.cost || 0)}</span>
                    <span className="h-1 overflow-hidden rounded-sm bg-inset"><span className="block h-full rounded-sm bg-accent/70" style={{ width: `${maxCost ? ((row.metrics.cost || 0) / maxCost) * 100 : 0}%` }} /></span>
                    <span className="text-right text-xs text-muted tabular-nums">{convNum(row.metrics.conversions || 0)} conv · CPL {dongShort(row.metrics.cost_per_conversion || 0)}</span>
                    {hints[row.id]?.length ? <span className="col-span-2"><HintChips hints={hints[row.id]} /></span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function KpiCard({ def, metrics, prev, prevIncomplete, prevLoading, values, big }: { def: KpiDef; metrics: Record<string, number>; prev?: Record<string, number>; prevIncomplete?: boolean; prevLoading?: boolean; values: (number | null)[]; big?: boolean }) {
  // Trend / previous-period only when `prev` is passed (staff with allowCompare). Clients never get it.
  const d = prev ? metricDelta(def.id, metrics, prev) : null;
  return (
    <div className={cn(card, "flex min-w-0 flex-col gap-1.5 p-4", big && "border-accent-border")}>
      <p className="text-[13px] font-medium leading-[18px] text-muted" title={def.hint || def.label}>{def.label}</p>
      <p className={cn("font-semibold tracking-tight tabular-nums [overflow-wrap:anywhere]", big ? "text-kpi" : "text-kpi-sm")}>{def.value(metrics)}</p>
      <Sparkline values={values} tone={def.tone} />
      {prevLoading ? (
        <p className="text-xs leading-4 text-subtle">Đang tải kỳ trước…</p>
      ) : prev ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs leading-4 text-muted" title={prevIncomplete ? "Kỳ trước thiếu ngày — chỉ tham khảo" : undefined}>
          <span className="tabular-nums">Kỳ trước {def.value(prev)}{prevIncomplete ? "*" : ""}</span>
          <DeltaText d={d} className="text-xs font-medium" />
        </p>
      ) : null}
    </div>
  );
}

const PERIOD_KPIS = [
  { id: "cost", label: "Chi tiêu", fmt: (m: Record<string, number>) => dong(m.cost || 0), tone: "cool" as const },
  { id: "clicks", label: "Click", fmt: (m: Record<string, number>) => num(m.clicks || 0), tone: "cool" as const },
  { id: "conversions", label: "Conv", fmt: (m: Record<string, number>) => convNum(m.conversions || 0), tone: "cool" as const },
  { id: "cost_per_conversion", label: "CPL", fmt: (m: Record<string, number>) => dong(m.cost_per_conversion || 0), tone: "warm" as const },
] as const;
type PeriodKpi = (typeof PERIOD_KPIS)[number]["id"];
type MetricDef = { key: string; label: string; cell: (m: Record<string, number>) => string; strong?: boolean; tone: "cool" | "warm" };

function metricDefs(groups: { id: string; label: string; metric: string }[]): MetricDef[] {
  return [
    { key: "cost", label: "Chi tiêu", cell: (m) => dong(m.cost || 0), strong: true, tone: "cool" },
    { key: "clicks", label: "Click", cell: (m) => num(m.clicks || 0), tone: "cool" },
    { key: "invalid_clicks", label: "Click lệch", cell: (m) => invalidLabel(m), tone: "warm" },
    { key: "conversions", label: "Conv", cell: (m) => convNum(m.conversions || 0), strong: true, tone: "cool" },
    { key: "cpc", label: "CPC", cell: (m) => dong(m.cpc || 0), tone: "warm" },
    { key: "cost_per_conversion", label: "CPL", cell: (m) => dong(m.cost_per_conversion || 0), tone: "warm" },
    ...groups.map((g) => ({ key: g.metric, label: g.label, cell: (m: Record<string, number>) => convNum(Number(m[g.metric] || 0)), tone: "cool" as const })),
  ];
}

function entityUnion(blocks: LayerBlock[]) {
  const map = new Map<string, { id: string; name: string; cost: number; status?: string; pmax?: boolean }>();
  for (const block of blocks) {
    for (const row of block.rows) {
      const prev = map.get(row.id);
      map.set(row.id, { id: row.id, name: row.name, status: row.status, pmax: row.pmax, cost: (prev?.cost || 0) + (row.metrics.cost || 0) });
    }
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost);
}

const scrollBox = "relative max-h-[70vh] overflow-auto overscroll-contain rounded-xl border border-line bg-paper shadow-sm";
/** Metric columns shown by default (the rest: "Cột" → thêm). */
const DEFAULT_METRIC_COLS = new Set(["cost", "impressions", "clicks", "ctr", "conversions", "cpc", "cost_per_conversion", "qs:qs"]);
const COLS_KEY = "adsops:analytics:cols:v1:";
const thBase = "sticky top-0 z-10 whitespace-nowrap border-b border-line bg-row-hover px-3 py-2.5 text-[13px] font-semibold text-muted";
const stickyCol = "sticky left-0 z-[5] bg-paper shadow-[1px_0_0_var(--color-line)]";
const cornerCell = "sticky left-0 top-0 z-20 bg-row-hover shadow-[1px_0_0_var(--color-line)]";

function PeriodSection({
  title, cols, blocks, accountBlocks, groups, layer, onLayerChange, onPickCampaign, onWholeWarehouse, splitKnown,
}: {
  title: string;
  cols: { id: string; label: string; sub: string; complete: boolean }[];
  blocks: LayerBlock[]; accountBlocks: LayerBlock[];
  groups: { id: string; label: string; metric: string }[];
  layer: "account" | "campaign";
  onLayerChange: (next: "account" | "campaign") => void;
  onPickCampaign: (id: string) => void;
  onWholeWarehouse: () => void;
  splitKnown: boolean;
}) {
  const [kpi, setKpi] = useState<PeriodKpi>("cost");
  const [mode, setMode] = useState<"matrix" | "full">("matrix");
  const [showAll, setShowAll] = useState(false);
  const defs = metricDefs(groups);
  const campaigns = layer === "campaign" ? entityUnion(blocks) : [];
  const kpiMeta = PERIOD_KPIS.find((item) => item.id === kpi) || PERIOD_KPIS[0];
  const TOP = 15;
  const shown = showAll ? campaigns : campaigns.slice(0, TOP);
  const colMax = cols.map((_, i) => Math.max(0, ...campaigns.map((c) => Number(blocks[i]?.rows.find((r) => r.id === c.id)?.metrics[kpi] || 0))));
  const colMin =
    kpi === "cost_per_conversion"
      ? cols.map((_, i) => {
          const v = campaigns.map((c) => Number(blocks[i]?.rows.find((r) => r.id === c.id)?.metrics[kpi] || 0)).filter((x) => x > 0);
          return v.length > 2 ? Math.min(...v) * 0.85 : 0;
        })
      : cols.map(() => 0);

  if (cols.length < 2) {
    return (
      <section className={cn(card, "flex flex-col items-start gap-3 p-5")}>
        <h3 className="font-display text-lg font-semibold">{title}</h3>
        <p className="text-sm text-muted">Khoảng ngày đang chọn nằm trong 1 tháng. Chọn khoảng dài hơn để xem các tháng cạnh nhau.</p>
        <button type="button" onClick={onWholeWarehouse} className="h-9 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover">Xem toàn kho theo tháng</button>
      </section>
    );
  }

  const header = (firstLabel: string) => (
    <thead>
      <tr>
        <th className={cn(thBase, cornerCell, "min-w-[11rem] text-left md:min-w-[16rem]")}>{firstLabel}</th>
        {cols.map((col) => (
          <th key={col.id} className={cn(thBase, "text-right")}>
            <span className="block text-sm font-semibold text-ink">{col.label}</span>
            <span className="block font-normal text-subtle">{col.sub}</span>
            {!col.complete ? <span className="mt-0.5 inline-block rounded bg-warn-bg px-1.5 text-[11px] font-medium text-warn">Thiếu dữ liệu</span> : null}
          </th>
        ))}
      </tr>
    </thead>
  );

  const rowCells = (def: MetricDef, pick: (i: number) => Record<string, number> | undefined, rowHeat: boolean, isAccount = false) => {
    const vals = cols.map((_, i) => pick(i));
    const nums = vals.map((m) => Number(m?.[def.key] || 0)).filter((v) => v > 0);
    const max = rowHeat && nums.length ? Math.max(...nums) : 0;
    const min = nums.length > 2 ? Math.min(...nums) * 0.85 : 0;
    const splitHidden = !isAccount && !splitKnown && def.key.startsWith("conv_") && def.key !== "conversions";
    return cols.map((col, i) => {
      const m = vals[i];
      return (
        <td key={col.id} className={cn("whitespace-nowrap border-b border-line/60 px-3 py-2 text-right tabular-nums", def.strong && "font-medium")} style={m && rowHeat && !splitHidden ? heat(Number(m[def.key] || 0), max, def.tone, min) : undefined}>
          {m && !splitHidden ? def.cell(m) : "—"}
        </td>
      );
    });
  };

  return (
    <section className={cn(card, "flex min-w-0 flex-col gap-3 p-3 md:p-4")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <h3 className="font-display text-lg font-semibold tracking-tight">{title}</h3>
          <InfoPopover label="Giải thích bảng theo tháng" align="left">
            <p className="text-muted">
              {layer === "campaign" ? "Mỗi dòng một chiến dịch, cột là tháng (hoặc tuần). Dòng cuối = tổng tài khoản. Bấm tên chiến dịch để xuống nhóm. Tháng cắt theo khoảng ngày đang chọn." : "Tổng mọi chiến dịch theo tháng. Đổi sang Chiến dịch để so từng chiến dịch."}{" "}
              Tháng chưa đủ ngày trong kho được đánh dấu &quot;Thiếu dữ liệu&quot;. Ô trống (—) = không có số, không điền 0.
            </p>
          </InfoPopover>
        </div>
        <Segmented size="sm" items={[{ id: "account", label: "Tài khoản" }, { id: "campaign", label: "Chiến dịch" }] as const} value={layer} onChange={onLayerChange} />
      </div>
      {layer === "campaign" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Segmented size="sm" items={[{ id: "matrix", label: "1 chỉ số" }, { id: "full", label: "Đủ chỉ số" }] as const} value={mode} onChange={setMode} />
          {mode === "matrix" ? <Segmented size="sm" items={PERIOD_KPIS} value={kpi} onChange={setKpi} /> : null}
        </div>
      ) : null}

      <div className={scrollBox}>
        {layer === "account" ? (
          <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
            {header("Chỉ số")}
            <tbody>
              {defs.map((def) => (
                <tr key={def.key}>
                  <td className={cn(stickyCol, "whitespace-nowrap border-b border-line/60 px-3 py-2 text-muted", def.strong && "font-medium text-ink")}>{def.label}</td>
                  {rowCells(def, (i) => blocks[i]?.rows[0]?.metrics, true, true)}
                </tr>
              ))}
            </tbody>
          </table>
        ) : campaigns.length === 0 ? (
          <EmptyState title="Không có chiến dịch có số trong các kỳ này." description="Không đoán số." className="py-6" />
        ) : mode === "matrix" ? (
          <table id="analytics-campaign-matrix" className="min-w-full border-separate border-spacing-0 text-left text-sm">
            {header(`${kpiMeta.label} theo chiến dịch`)}
            <tbody>
              {shown.map((camp) => (
                <tr key={camp.id} className="group">
                  <td className={cn(stickyCol, "border-b border-line/60 px-3 py-1 group-hover:bg-inset")}>
                    <button type="button" onClick={() => onPickCampaign(camp.id)} className="flex min-h-10 w-full max-w-[11rem] items-center gap-2 text-left font-medium md:max-w-[22rem]" title={camp.name}>
                      <span className="truncate">{camp.name}</span>
                      {camp.pmax ? <span className="shrink-0 rounded-sm bg-inset px-1.5 text-[11px] text-muted">PMax</span> : null}
                    </button>
                  </td>
                  {cols.map((col, i) => {
                    const m = blocks[i]?.rows.find((r) => r.id === camp.id)?.metrics;
                    return (
                      <td key={col.id} className="whitespace-nowrap border-b border-line/60 px-3 py-2 text-right tabular-nums" style={m ? heat(Number(m[kpi] || 0), colMax[i], kpiMeta.tone, colMin[i]) : undefined}>
                        {m ? kpiMeta.fmt(m) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className={cn(stickyCol, "sticky bottom-0 z-[15] border-t border-line-strong bg-inset px-3 py-2.5 font-semibold")}>Tài khoản (tổng)</td>
                {cols.map((col, i) => {
                  const m = accountBlocks[i]?.rows[0]?.metrics;
                  return <td key={col.id} className="sticky bottom-0 z-10 whitespace-nowrap border-t border-line-strong bg-inset px-3 py-2.5 text-right font-semibold tabular-nums">{m ? kpiMeta.fmt(m) : "—"}</td>;
                })}
              </tr>
            </tfoot>
          </table>
        ) : (
          <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
            {header("Chiến dịch / chỉ số")}
            {shown.map((camp) => (
              <tbody key={camp.id}>
                <tr>
                  <td className={cn(stickyCol, "border-b border-line bg-inset px-3 py-1")}>
                    <button type="button" onClick={() => onPickCampaign(camp.id)} className="flex min-h-10 w-full max-w-[11rem] items-center gap-2 text-left font-semibold text-ink md:max-w-[22rem]" title={camp.name}>
                      <span className="truncate">{camp.name}</span>
                      {camp.pmax ? <span className="shrink-0 rounded-sm bg-paper px-1.5 text-[11px] text-muted">PMax</span> : null}
                    </button>
                  </td>
                  {cols.map((col) => <td key={col.id} className="border-b border-line bg-inset" />)}
                </tr>
                {defs.map((def) => (
                  <tr key={def.key}>
                    <td className={cn(stickyCol, "whitespace-nowrap border-b border-line/60 py-2 pl-6 pr-3 text-muted", def.strong && "font-medium text-ink")}>{def.label}</td>
                    {rowCells(def, (i) => blocks[i]?.rows.find((r) => r.id === camp.id)?.metrics, true)}
                  </tr>
                ))}
              </tbody>
            ))}
            <tbody>
              <tr>
                <td className={cn(stickyCol, "border-b border-line-strong bg-inset px-3 py-2.5 font-semibold")}>Tài khoản (tổng)</td>
                {cols.map((col) => <td key={col.id} className="border-b border-line-strong bg-inset" />)}
              </tr>
              {defs.map((def) => (
                <tr key={`acct-${def.key}`}>
                  <td className={cn(stickyCol, "whitespace-nowrap border-b border-line/60 py-2 pl-6 pr-3 text-muted", def.strong && "font-medium text-ink")}>{def.label}</td>
                  {rowCells(def, (i) => accountBlocks[i]?.rows[0]?.metrics, false, true)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {layer === "campaign" && campaigns.length > TOP ? (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="self-start rounded-md bg-inset px-3.5 py-2 text-sm font-medium text-ink hover:bg-line">
          {showAll ? `Chỉ hiện top ${TOP} chiến dịch` : `Xem tất cả ${campaigns.length} chiến dịch (đang hiện top ${TOP} theo chi tiêu)`}
        </button>
      ) : null}
    </section>
  );
}

function coverageNote(block: LayerBlock | DeepLayerBlock, layer: string): { text: string; warn: boolean } | null {
  if (!("coverage" in block)) return null;
  const deep = block as DeepLayerBlock;
  const ranges = deep.coverage;
  const cap = deep.search_term_cap_days ?? 90;
  if (!ranges.length) {
    return {
      text: layer === "search_term" ? `Google chỉ lưu cụm từ tìm kiếm khoảng ${cap} ngày gần nhất; khoảng đã chọn chưa có số.` : "Chưa có số liệu cho khoảng ngày này.",
      warn: true,
    };
  }
  const rangeText = ranges.map((r) => `${dmy(r.start)} → ${dmy(r.end)}`).join("; ");
  const name = layer === "ad_group" ? "Nhóm quảng cáo" : layer === "keyword" ? "Từ khoá" : "Search terms";
  const bits = [`${name} có số từ ${rangeText}`];
  if (!deep.complete) bits.push("các ngày khác chưa có số — tổng chỉ gồm ngày đã có, không điền 0");
  if (layer === "search_term") bits.push(`search term tối đa ${cap} ngày gần nhất`);
  return { text: bits.join(" · "), warn: !deep.complete };
}

const SEARCH_TERM_DAYS = 90;

function todaySaigon(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Saigon", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function maxYmd(a: string, b: string): string {
  return a > b ? a : b;
}

/** One message for an empty deep table (never two). */
function deepEmptyText(layer: DeepLayerId, block: DeepLayerBlock): string {
  const noun = layer === "ad_group" ? "nhóm quảng cáo" : layer === "keyword" ? "từ khoá" : "cụm từ tìm kiếm";
  const cap = block.search_term_cap_days ?? SEARCH_TERM_DAYS;
  const stNote = layer === "search_term" ? ` Google chỉ lưu cụm từ tìm kiếm khoảng ${cap} ngày gần nhất.` : "";
  if (block.complete) return `Không có ${noun} nào có hiển thị trong khoảng này.`;
  if (block.covered_days > 0) return `Không có ${noun} nào có hiển thị trong các ngày đã có số.${stNote}`;
  return layer === "search_term" ? `Google chỉ lưu cụm từ tìm kiếm khoảng ${cap} ngày gần nhất; khoảng đã chọn chưa có số.` : "Chưa có số liệu cho khoảng ngày này.";
}

function FillProgress({ label, x, y }: { label: string; x: number; y: number }) {
  const pctDone = y > 0 ? Math.min(100, Math.round((Math.max(0, x - 1) / y) * 100)) : 0;
  return (
    <div className="rounded-md bg-inset px-4 py-3 text-sm text-muted" role="status" aria-live="polite">
      <p>{label}</p>
      <div className="mt-2 h-1 overflow-hidden rounded-sm bg-line">
        <div className={cn("h-full rounded-sm bg-accent transition-all", y > 0 ? "" : "w-1/3 animate-pulse")} style={y > 0 ? { width: `${Math.max(8, pctDone)}%` } : undefined} />
      </div>
    </div>
  );
}

type CampaignLite = { id: string; name: string; pmax?: boolean };

const selectBox = "flex h-9 min-w-0 items-center gap-2 rounded-md border border-line bg-inset pl-3 pr-1 text-sm sm:max-w-[20rem]";
const selectEl = "h-8 min-w-0 flex-1 cursor-pointer truncate rounded-md bg-transparent pr-1 text-base font-medium text-ink outline-none sm:text-sm";

type ScopeOpt = { id: string; label: string };

/** Type-to-filter over options already in memory. Typing does not fetch. */
function ScopeCombo({
  label, placeholder, emptyLabel, options, value, disabled, onPick,
}: {
  label: string;
  placeholder: string;
  emptyLabel: string;
  options: ScopeOpt[];
  value: string | null;
  disabled?: boolean;
  onPick: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = label === "Chiến dịch" ? "scope-campaign" : "scope-group";
  const selected = options.find((o) => o.id === value);
  const closed = selected?.label || emptyLabel;
  const q = fold(query.trim());
  const matches = q ? options.filter((o) => fold(o.label).includes(q)) : options;
  const rows: { id: string | null; label: string }[] = [{ id: null, label: emptyLabel }, ...matches];
  const active = rows.length ? Math.min(hi, rows.length - 1) : 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function choose(id: string | null) {
    onPick(id);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={box} className={cn(selectBox, "relative", disabled && "opacity-60")}>
      <span className="shrink-0 text-xs font-medium text-muted">{label}</span>
      <input
        value={open ? query : closed}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={label === "Chiến dịch" ? "Lọc theo chiến dịch" : "Lọc theo nhóm quảng cáo"}
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onFocus={() => { if (disabled) return; setOpen(true); setQuery(""); setHi(0); }}
        onChange={(e) => {
          const v = e.target.value;
          setQuery(v);
          setOpen(true);
          setHi(v.trim() ? 1 : 0);
          if (v === "") choose(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); setQuery(""); return; }
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi(active + 1 >= rows.length ? active : active + 1); return; }
          if (e.key === "ArrowUp") { e.preventDefault(); setOpen(true); setHi(active > 0 ? active - 1 : 0); return; }
          if (e.key === "Enter") { e.preventDefault(); choose(rows[active]?.id ?? null); }
        }}
        className={selectEl + " placeholder:font-normal placeholder:text-subtle"}
      />
      {open && !disabled ? (
        <ul id={listId} role="listbox" className="absolute left-0 top-full z-30 mt-1 max-h-72 min-w-full w-max max-w-[28rem] overflow-auto rounded-lg border border-line bg-paper py-1 shadow-sheet">
          {rows.map((row, i) => (
            <li key={row.id ?? "all"} role="presentation">
              <button
                type="button"
                id={`${listId}-${i}`}
                role="option"
                aria-selected={row.id === value}
                className={cn("block w-full truncate px-3 py-2 text-left text-sm text-ink", i === active ? "bg-inset" : "hover:bg-inset", row.id != null && row.id === value && "font-medium")}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHi(i)}
                onClick={() => choose(row.id)}
              >
                {row.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ScopeFilters({
  layer, facets, campaigns, campaignId, adGroupId, adGroupLabel, onCampaign, onAdGroup, onlyConv, onOnlyConv, canClear, onClear,
}: {
  layer: DeepLayerId;
  facets?: DeepFacets;
  campaigns: CampaignLite[];
  campaignId: string | null;
  adGroupId: string | null;
  adGroupLabel: string;
  onCampaign: (id: string | null) => void;
  onAdGroup: (id: string | null, label: string, campaignId: string | null) => void;
  onlyConv: boolean;
  onOnlyConv: (v: boolean) => void;
  canClear: boolean;
  onClear: () => void;
}) {
  const snapName = (id: string) => campaigns.find((c) => c.id === id)?.name || "";
  const campOpts = (facets?.campaigns || []).map((c) => ({ id: c.id, name: c.name || snapName(c.id) || c.id, rows: c.rows as number | null }));
  if (campaignId && !campOpts.some((c) => c.id === campaignId)) campOpts.unshift({ id: campaignId, name: snapName(campaignId) || campaignId, rows: null });
  const allGroups = facets?.ad_groups || [];
  let groupOpts = (campaignId ? allGroups.filter((g) => g.campaign_id === campaignId) : allGroups).map((g) => ({ ...g, rows: g.rows as number | null }));
  const nameCount = new Map<string, number>();
  for (const g of groupOpts) nameCount.set(g.name, (nameCount.get(g.name) || 0) + 1);
  if (adGroupId && !groupOpts.some((g) => g.id === adGroupId)) groupOpts = [{ id: adGroupId, name: adGroupLabel || adGroupId, campaign_id: campaignId || "", rows: null }, ...groupOpts];
  const showGroups = layer !== "ad_group";
  const countSuffix = (n: number | null) => (n == null ? "" : ` (${n})`);
  const campEmpty = `Tất cả chiến dịch${facets ? ` (${facets.campaigns.length})` : ""}`;
  const groupCount = groupOpts.filter((g) => g.rows != null).length;
  const groupEmpty = `${campaignId ? "Tất cả nhóm trong chiến dịch" : "Tất cả nhóm"}${groupOpts.length ? ` (${groupCount})` : ""}`;
  const campOptions = campOpts.map((c) => ({ id: c.id, label: `${c.name}${countSuffix(c.rows)}` }));
  const groupOptions = groupOpts.map((g) => {
    const extra = !campaignId && (nameCount.get(g.name) || 0) > 1 ? ` — ${snapName(g.campaign_id) || campOpts.find((c) => c.id === g.campaign_id)?.name || g.campaign_id}` : "";
    return { id: g.id, label: `${g.name || g.id}${extra}${countSuffix(g.rows)}` };
  });
  return (
    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center" role="group" aria-label="Lọc theo chiến dịch / nhóm">
      <ScopeCombo
        label="Chiến dịch"
        placeholder="Gõ chiến dịch…"
        emptyLabel={campEmpty}
        options={campOptions}
        value={campaignId}
        onPick={onCampaign}
      />
      {showGroups ? (
        <ScopeCombo
          label="Nhóm"
          placeholder="Gõ nhóm…"
          emptyLabel={groupEmpty}
          options={groupOptions}
          value={adGroupId}
          disabled={!groupOpts.length}
          onPick={(id) => {
            const g = groupOpts.find((x) => x.id === id);
            onAdGroup(id, g?.name || "", g?.campaign_id || null);
          }}
        />
      ) : null}
      <div className="flex items-center gap-2">
        <label className="flex h-9 items-center gap-2 rounded-md border border-line bg-inset px-3 text-sm"><input type="checkbox" checked={onlyConv} onChange={(e) => onOnlyConv(e.target.checked)} className="size-4 accent-accent" />Chỉ có conv</label>
        {canClear ? (
          <button type="button" onClick={onClear} className="inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium text-accent hover:bg-inset"><X className="size-4" /> Xoá lọc</button>
        ) : null}
      </div>
    </div>
  );
}

type ColDef = {
  key: string;
  label: string;
  cell: (r: LayerRow) => string;
  sortVal: (r: LayerRow) => number;
  total?: (t: Record<string, number>) => string;
  heat?: "cool" | "warm";
  strong?: boolean;
  hint?: string;
  /** Extra text class per cell (e.g. QS colour). */
  tone?: (r: LayerRow) => string | undefined;
};

function DataTable({
  layer, block, groups, canDrill, onDrill, campaignNames, splitKnown = true, query: queryProp, onQueryChange, scoped = false, totalAll, emptyText, compare = null, storeKey, convDetail, share = null, shareCompare = false, hints, qs = null,
}: {
  /** Keyword Quality Score by keyword id (latest snapshot). */
  qs?: Record<string, QsCell> | null;
  /** Impression-share values for this layer (range aggregate). */
  share?: ShareRead | null;
  /** Show share deltas (a previous period is being compared). */
  shareCompare?: boolean;
  /** Campaign insight chips by row id. */
  hints?: Record<string, CampaignHint[]>;
  /** Per-conversion-action breakdown for a row (popover from the Conv cell). */
  convDetail?: (row: LayerRow) => ReactNode;
  layer: TableLayer;
  block: LayerBlock | DeepLayerBlock;
  groups: { id: string; label: string; metric: string }[];
  canDrill: boolean;
  onDrill: (row: LayerRow) => void;
  campaignNames: Record<string, string>;
  splitKnown?: boolean;
  query?: string;
  onQueryChange?: (q: string) => void;
  /** Campaign / ad group filter active (count shows "x / total"). */
  scoped?: boolean;
  /** Rows in the whole layer for the range, before campaign / ad group / text filters. */
  totalAll?: number;
  /** Message when there are no rows (deep layers: layer-specific wording). */
  emptyText?: string;
  /** Staff "So kỳ trước": previous-period metrics by row id (sorting stays on current values). */
  compare?: TableCompare | null;
  /** Per-user key for the remembered column choice. */
  storeKey?: string | null;
}) {
  const [queryLocal, setQueryLocal] = useState("");
  const query = queryProp ?? queryLocal;
  const setQuery = onQueryChange ?? setQueryLocal;
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "cost", dir: -1 });
  const [convPop, setConvPop] = useState<{ id: string; top: number; right: number } | null>(null);
  useEffect(() => {
    if (!convPop) return;
    const close = (e: Event) => { if (!(e.target instanceof Element && e.target.closest("[data-conv-pop]"))) setConvPop(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setConvPop(null); };
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); window.removeEventListener("scroll", close, true); document.removeEventListener("keydown", esc); };
  }, [convPop]);
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState(0);
  const note = coverageNote(block, layer);
  const deep = "coverage" in block ? (block as DeepLayerBlock) : null;
  const isDeep = Boolean(deep);
  const showMatch = layer === "keyword" || layer === "search_term";
  const showConvSplit = deep ? deep.conv_split : splitKnown;

  const baseCols: ColDef[] = useMemo(
    () => [
      { key: "cost", label: "Chi tiêu", cell: (r) => dong(r.metrics.cost || 0), sortVal: (r) => r.metrics.cost || 0, total: (t) => dong(t.cost || 0), heat: "cool", strong: true },
      { key: "impressions", label: "Hiển thị", cell: (r) => num(r.metrics.impressions || 0), sortVal: (r) => r.metrics.impressions || 0, total: (t) => num(t.impressions || 0), heat: "cool" },
      { key: "clicks", label: "Click", cell: (r) => num(r.metrics.clicks || 0), sortVal: (r) => r.metrics.clicks || 0, total: (t) => num(t.clicks || 0), heat: "cool" },
      { key: "ctr", label: "CTR", cell: (r) => pct(r.metrics.ctr || 0), sortVal: (r) => r.metrics.ctr || 0, total: (t) => pct(t.ctr || 0) },
      { key: "invalid_clicks", label: "Click lệch", cell: (r) => (isDeep ? "—" : invalidLabel(r.metrics)), sortVal: (r) => (isDeep ? 0 : r.metrics.invalid_clicks || 0), total: (t) => (isDeep ? "—" : invalidLabel(t)) },
      { key: "conversions", label: "Conv", cell: (r) => convNum(r.metrics.conversions || 0), sortVal: (r) => r.metrics.conversions || 0, total: (t) => convNum(t.conversions || 0), heat: "cool", strong: true },
      { key: "cpc", label: "CPC", cell: (r) => dong(r.metrics.cpc || 0), sortVal: (r) => r.metrics.cpc || 0, total: (t) => dong(t.cpc || 0), heat: "warm" },
      { key: "cost_per_conversion", label: "CPL", cell: (r) => dong(r.metrics.cost_per_conversion || 0), sortVal: (r) => r.metrics.cost_per_conversion || 0, total: (t) => dong(t.cost_per_conversion || 0), heat: "warm" },
      ...groups.map((g) => ({
        key: g.metric,
        label: g.label,
        cell: (r: LayerRow) => (showConvSplit ? convNum(Number(r.metrics[g.metric] || 0)) : "—"),
        sortVal: (r: LayerRow) => (showConvSplit ? Number(r.metrics[g.metric] || 0) : 0),
        total: (t: Record<string, number>) => (showConvSplit ? convNum(Number(t[g.metric] || 0)) : "—"),
        heat: showConvSplit ? ("cool" as const) : undefined,
      })),
    ],
    [groups, isDeep, showConvSplit],
  );
  const shareCols: ColDef[] = useMemo(() => {
    if (!share) return [];
    const keys: ShareKey[] = layer === "campaign"
      ? ["is", "is_lost_budget", "is_lost_rank", "top_is", "abs_top_is", "top_pct", "abs_top_pct", "exact_is"]
      : ["is", "is_lost_rank", "top_is", "abs_top_is", "top_pct", "abs_top_pct"];
    const val = (r: LayerRow, k: string) => share.rows[r.id]?.[k];
    return keys.map((k) => ({
      key: `share:${k}`,
      label: SHARE_LABEL[k],
      hint: SHARE_HINT[k],
      cell: (r: LayerRow) => fmtShare(val(r, k)),
      sortVal: (r: LayerRow) => val(r, k) ?? -1,
      total: layer === "campaign" ? () => fmtShare(share.account?.[k]) : () => "—",
    }));
  }, [share, layer]);
  const qsCols: ColDef[] = useMemo(() => {
    if (!qs || layer !== "keyword") return [];
    const compCol = (key: "creative" | "post_click" | "ctr", label: string, hint: string): ColDef => ({
      key: `qs:${key}`,
      label,
      hint,
      cell: (r) => { const v = qs[r.id]?.[key]; return v ? QS_COMPONENT_VI[v] : "—"; },
      sortVal: (r) => { const v = qs[r.id]?.[key]; return v ? QS_COMPONENT_RANK[v] : -1; },
      total: () => "—",
      tone: (r) => { const v = qs[r.id]?.[key]; return v === "BELOW_AVERAGE" ? "text-danger" : v === "ABOVE_AVERAGE" ? "text-ok" : undefined; },
    });
    return [
      {
        key: "qs:qs",
        label: "QS",
        hint: "Quality Score 1–10 (ảnh chụp hiện tại từ Google). ≤3 đỏ, 4–6 vàng, ≥7 xanh.",
        cell: (r) => { const v = qs[r.id]?.qs; return v != null ? String(v) : "—"; },
        sortVal: (r) => qs[r.id]?.qs ?? -1,
        total: () => "—",
        tone: (r) => { const t = qsTone(qs[r.id]?.qs); return t ? QS_TONE_CLASS[t] : undefined; },
      },
      compCol("creative", "Mức liên quan QC", "Mức độ liên quan của quảng cáo với từ khoá (creative_quality_score)."),
      compCol("post_click", "Trải nghiệm trang đích", "Trải nghiệm trang đích sau click (post_click_quality_score)."),
      compCol("ctr", "CTR dự kiến", "Khả năng quảng cáo được click khi hiển thị cho từ khoá (search_predicted_ctr)."),
    ];
  }, [qs, layer]);
  const cols = useMemo(() => [...baseCols, ...qsCols, ...shareCols], [baseCols, qsCols, shareCols]);

  // ── "Cột": which columns are shown (remembered per user + layer) ──────────────────
  const optCols = useMemo(() => {
    const out: { key: string; label: string; def: boolean }[] = [];
    if (layer !== "search_term") out.push({ key: "status", label: "Trạng thái", def: true });
    if (layer === "keyword" || layer === "search_term") out.push({ key: "match", label: "Khớp", def: true });
    if (layer !== "campaign") out.push({ key: "campaign", label: "Chiến dịch", def: true });
    if (layer === "keyword" || layer === "search_term") out.push({ key: "adgroup", label: "Nhóm", def: true });
    for (const c of cols) out.push({ key: c.key, label: c.label, def: DEFAULT_METRIC_COLS.has(c.key) });
    return out;
  }, [layer, cols]);
  const colStore = `${COLS_KEY}${storeKey || "anon"}:${layer}`;
  const [colPref, setColPref] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(colStore);
      setColPref(raw ? (JSON.parse(raw) as Record<string, boolean>) : {});
    } catch { setColPref({}); }
  }, [colStore]);
  function saveColPref(next: Record<string, boolean>) {
    setColPref(next);
    try {
      if (Object.keys(next).length) window.localStorage.setItem(colStore, JSON.stringify(next));
      else window.localStorage.removeItem(colStore);
    } catch { /* storage blocked */ }
  }
  const isOn = (key: string) => {
    const o = optCols.find((c) => c.key === key);
    if (!o) return false;
    return key in colPref ? colPref[key] : o.def;
  };
  const [colsOpen, setColsOpen] = useState(false);
  const colsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!colsOpen) return;
    const close = (e: MouseEvent) => { if (colsRef.current && !colsRef.current.contains(e.target as Node)) setColsOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setColsOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [colsOpen]);
  const shownCols = cols.filter((c) => isOn(c.key));
  const onCount = optCols.filter((c) => isOn(c.key)).length;

  const filtered = useMemo(() => {
    const q = fold(query.trim());
    let rows = block.rows;
    if (q) rows = rows.filter((r) => fold(`${r.name} ${r.campaign_name || campaignNames[r.campaign_id || ""] || ""} ${r.ad_group_name || ""}`).includes(q));
    const col = cols.find((c) => c.key === sort.key);
    const campName = (r: LayerRow) => r.campaign_name || campaignNames[r.campaign_id || ""] || "";
    return [...rows].sort((a, b) => {
      if (sort.key === "name") return a.name.localeCompare(b.name, "vi") * sort.dir;
      if (sort.key === "status") return String(a.status || "").localeCompare(String(b.status || "")) * sort.dir;
      if (sort.key === "campaign") return campName(a).localeCompare(campName(b), "vi") * sort.dir;
      if (sort.key === "adgroup") return (a.ad_group_name || "").localeCompare(b.ad_group_name || "", "vi") * sort.dir;
      return ((col?.sortVal(a) || 0) - (col?.sortVal(b) || 0)) * sort.dir;
    });
  }, [block.rows, query, sort, cols, campaignNames]);

  const colMax = useMemo(() => Object.fromEntries(cols.map((c) => [c.key, Math.max(0, ...filtered.map((r) => c.sortVal(r)))])), [cols, filtered]);
  const colMin = useMemo(
    () =>
      Object.fromEntries(
        cols.map((c) => {
          const v = filtered.map((r) => c.sortVal(r)).filter((x) => x > 0);
          return [c.key, c.heat === "warm" && v.length > 2 ? Math.min(...v) * 0.85 : 0];
        }),
      ),
    [cols, filtered],
  );

  // Totals: deep layers use the server total (covered days only); campaigns sum every row in range.
  const totals = useMemo(() => {
    if (deep) return deep.totals;
    if (!block.rows.length) return null;
    const acc: Record<string, number> = {};
    for (const r of block.rows) for (const [k, v] of Object.entries(r.metrics)) if (typeof v === "number") acc[k] = (acc[k] || 0) + v;
    acc.ctr = acc.impressions ? (acc.clicks || 0) / acc.impressions : 0;
    acc.cpc = acc.clicks ? (acc.cost || 0) / acc.clicks : 0;
    acc.cost_per_conversion = acc.conversions ? (acc.cost || 0) / acc.conversions : 0;
    acc.invalid_click_rate = acc.clicks ? (acc.invalid_clicks || 0) / acc.clicks : 0;
    return acc;
  }, [deep, block.rows]);

  if (block.pmax_note && block.rows.length === 0) {
    return <p className="rounded-md bg-inset px-4 py-6 text-sm text-muted">PMax: {block.pmax_note || "không có search term / keyword chuẩn"}</p>;
  }
  if (block.rows.length === 0) {
    return (
      <p className="rounded-md bg-inset px-4 py-6 text-sm text-muted">
        {scoped
          ? "Không có dòng khớp bộ lọc chiến dịch / nhóm trong khoảng ngày này."
          : emptyText || (block.complete ? "Không có dòng trong khoảng ngày này." : note?.text || "Thiếu dữ liệu — mốc chưa đủ ngày; API không trả hết cửa sổ. Không đoán số.")}
      </p>
    );
  }

  const TOP = 20;
  const PAGE = 50;
  const paginate = (showAll || Boolean(query)) && filtered.length > 100;
  const pages = paginate ? Math.ceil(filtered.length / PAGE) : 1;
  const safePage = Math.min(page, pages - 1);
  const visible = !showAll && !query ? filtered.slice(0, TOP) : paginate ? filtered.slice(safePage * PAGE, safePage * PAGE + PAGE) : filtered;
  const firstLabel = layer === "campaign" ? "Chiến dịch" : layer === "ad_group" ? "Nhóm quảng cáo" : layer === "keyword" ? "Từ khoá" : "Search term";
  const showStatus = layer !== "search_term" && isOn("status");
  const showMatchCol = showMatch && isOn("match");
  const showCampaign = layer !== "campaign" && isOn("campaign");
  const showAdGroup = (layer === "keyword" || layer === "search_term") && isOn("adgroup");
  const campOf = (row: LayerRow) => row.campaign_name || campaignNames[row.campaign_id || ""] || "";

  function contextLine(row: LayerRow) {
    const camp = row.campaign_name || campaignNames[row.campaign_id || ""] || "";
    return [camp, row.ad_group_name || ""].filter(Boolean).join(" · ");
  }
  function toggleSort(key: string) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" || key === "status" || key === "campaign" || key === "adgroup" ? 1 : -1 }));
    setPage(0);
  }
  const sortIcon = (key: string) => (sort.key === key ? (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : null);
  const totalLabel = deep
    ? `Tổng (chỉ ngày đã kéo${deep.coverage.length ? `: ${deep.coverage.map((r) => `${dmy(r.start)}→${dmy(r.end)}`).join("; ")}` : ""})`
    : `Tổng ${block.rows.length} chiến dịch`;
  const stickyFoot = "sticky bottom-0 z-10 border-t border-line-strong bg-inset";
  const rowCount = deep ? deep.row_count : block.rows.length;
  const countLabel =
    query || scoped
      ? `${num(query ? filtered.length : rowCount, 0)} / ${num(totalAll ?? rowCount, 0)} dòng`
      : `${num(rowCount, 0)} dòng`;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {note ? (
        <p className={cn("rounded-md px-3 py-2 text-sm", note.warn ? "bg-warn-bg text-warn" : "bg-inset text-muted")}>
          {note.text}
          {deep?.truncated ? ` · server trả ${deep.rows.length}/${deep.row_count} dòng chi nhiều nhất` : ""}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-0 flex-1 items-center sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 size-4 text-subtle" />
          <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder={`Tìm ${firstLabel.toLowerCase()}…`} className="h-9 w-full rounded-md border border-line bg-bg pl-9 pr-3 text-sm text-ink placeholder:text-subtle" />
        </label>
        <span className="text-xs text-muted tabular-nums">
          {countLabel}
          {canDrill ? " · bấm tên để xuống tầng dưới" : ""}
        </span>
        <div ref={colsRef} className="relative ml-auto">
          <button type="button" onClick={() => setColsOpen((v) => !v)} aria-expanded={colsOpen} aria-haspopup="true" className={cn("inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium", colsOpen ? "bg-ink text-paper" : "border border-line bg-paper text-ink hover:bg-inset")}>
            <Columns3 className="size-4" /> Cột <span className="text-xs tabular-nums opacity-70">{onCount}/{optCols.length}</span>
          </button>
          {colsOpen ? (
            <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-lg border border-line bg-paper p-2 shadow-sheet" role="group" aria-label="Chọn cột">
              <div className="mb-1.5 flex gap-1.5">
                <button type="button" onClick={() => saveColPref(Object.fromEntries(optCols.map((c) => [c.key, true])))} className="h-8 flex-1 rounded-md bg-inset px-2 text-xs font-medium text-ink hover:bg-line">Hiện tất cả</button>
                <button type="button" onClick={() => saveColPref({})} className="h-8 flex-1 rounded-md bg-inset px-2 text-xs font-medium text-ink hover:bg-line">Mặc định</button>
              </div>
              <ul className="max-h-72 overflow-y-auto">
                {optCols.map((c) => (
                  <li key={c.key}>
                    <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-inset">
                      <input type="checkbox" checked={isOn(c.key)} onChange={(e) => saveColPref({ ...colPref, [c.key]: e.target.checked })} className="size-4 accent-accent" />
                      <span className="flex-1">{c.label}</span>
                      {!c.def ? <span className="text-[11px] text-subtle">thêm</span> : null}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      <div className={scrollBox}>
        <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr>
              <th className={cn(thBase, cornerCell, "min-w-[10rem] text-left md:min-w-[14rem]")}>
                <button type="button" onClick={() => toggleSort("name")} className="inline-flex items-center gap-1 hover:text-ink">{firstLabel} {sortIcon("name")}</button>
              </th>
              {showStatus ? (
                <th className={cn(thBase, "text-left")}>
                  <button type="button" onClick={() => toggleSort("status")} className="inline-flex items-center gap-1 hover:text-ink">Trạng thái {sortIcon("status")}</button>
                </th>
              ) : null}
              {showMatchCol ? <th className={cn(thBase, "text-left")}>Khớp</th> : null}
              {showCampaign ? (
                <th className={cn(thBase, "text-left")} aria-sort={sort.key === "campaign" ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                  <button type="button" onClick={() => toggleSort("campaign")} className={cn("inline-flex items-center gap-1 hover:text-ink", sort.key === "campaign" && "text-ink")}>Chiến dịch {sortIcon("campaign")}</button>
                </th>
              ) : null}
              {showAdGroup ? (
                <th className={cn(thBase, "text-left")} aria-sort={sort.key === "adgroup" ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                  <button type="button" onClick={() => toggleSort("adgroup")} className={cn("inline-flex items-center gap-1 hover:text-ink", sort.key === "adgroup" && "text-ink")}>Nhóm {sortIcon("adgroup")}</button>
                </th>
              ) : null}
              {shownCols.map((c) => (
                <th key={c.key} className={cn(thBase, "text-right")} aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                  <button type="button" onClick={() => toggleSort(c.key)} title={c.hint} className={cn("inline-flex items-center gap-1 hover:text-ink", sort.key === c.key && "text-ink", c.hint && "underline decoration-dotted underline-offset-4")}>{sortIcon(c.key)}{c.label}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} className="group">
                <td className={cn(stickyCol, "border-b border-line/60 px-3 py-2.5 group-hover:bg-row-hover")}>
                  {canDrill ? (
                    <button type="button" onClick={() => onDrill(row)} className="flex min-h-9 w-full max-w-[12rem] items-center gap-2 text-left font-medium text-ink hover:text-accent hover:underline md:max-w-[22rem]" title={row.name}>
                      <span className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]">{row.name}</span>
                      {compare && !compare.partial && !compare.map.has(row.id) ? <span className="shrink-0 rounded-sm bg-ok-bg px-1.5 text-[11px] font-medium text-ok">mới</span> : null}
                      {row.pmax ? <span className="shrink-0 rounded-sm bg-inset px-1.5 text-[11px] font-medium text-muted">PMax</span> : null}
                      <ChevronRight className="size-3.5 shrink-0 text-subtle" />
                    </button>
                  ) : !canDrill ? (
                    <div className="flex min-h-9 max-w-[12rem] flex-col justify-center md:max-w-[22rem]" title={row.name}>
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="line-clamp-2 min-w-0 font-medium [overflow-wrap:anywhere]">{row.name}</span>
                        {compare && !compare.partial && !compare.map.has(row.id) ? <span className="shrink-0 rounded-sm bg-ok-bg px-1.5 text-[11px] font-medium text-ok">mới</span> : null}
                      </span>
                      {(layer === "search_term" || layer === "keyword") && !showCampaign && !showAdGroup && contextLine(row) ? <span className="truncate text-xs text-subtle" title={contextLine(row)}>{contextLine(row)}</span> : null}
                    </div>
                  ) : null}
                  {canDrill && hints?.[row.id]?.length ? <HintChips hints={hints[row.id]} /> : null}
                </td>
                {showStatus ? <td className="border-b border-line/60 px-3 py-2.5"><StatusBadge status={row.status} /></td> : null}
                {showMatchCol ? <td className="whitespace-nowrap border-b border-line/60 px-3 py-2.5 text-muted">{row.match_type_label || row.match_type || "—"}</td> : null}
                {showCampaign ? <td className="min-w-[8rem] max-w-[11rem] border-b border-line/60 px-3 py-2.5 text-muted" title={campOf(row)}><span className="line-clamp-2 [overflow-wrap:anywhere]">{campOf(row) || "—"}</span></td> : null}
                {showAdGroup ? <td className="min-w-[8rem] max-w-[11rem] border-b border-line/60 px-3 py-2.5 text-muted" title={row.ad_group_name || ""}><span className="line-clamp-2 [overflow-wrap:anywhere]">{row.ad_group_name || "—"}</span></td> : null}
                {shownCols.map((c) => (
                  <td key={c.key} className={cn("h-10 whitespace-nowrap border-b border-line/60 px-3 py-2.5 text-right font-medium tabular-nums", c.strong && "font-medium", c.tone?.(row))} style={c.heat ? heat(c.sortVal(row), colMax[c.key], c.heat, colMin[c.key]) : undefined}>
                    {c.key === "conversions" && convDetail ? (
                      <button
                        type="button"
                        data-conv-pop
                        aria-expanded={convPop?.id === row.id}
                        title="Xem theo hành động chuyển đổi"
                        onClick={(e) => {
                          const r = e.currentTarget.getBoundingClientRect();
                          setConvPop((cur) => (cur?.id === row.id ? null : { id: row.id, top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) }));
                        }}
                        className="inline-flex items-center gap-0.5 rounded hover:text-accent"
                      >
                        {c.cell(row)}
                        <ChevronDown className={cn("size-3 text-subtle transition-transform", convPop?.id === row.id && "rotate-180")} />
                      </button>
                    ) : c.cell(row)}
                    {share && shareCompare && c.key.startsWith("share:") ? (
                      <DeltaText d={shareDelta(c.key.slice(6), share.rows[row.id], share.prev_rows?.[row.id])} className="block leading-tight" />
                    ) : null}
                    {compare && DELTA_COLS.has(c.key) && compare.map.has(row.id) ? (
                      <DeltaText d={metricDelta(c.key, row.metrics, compare.map.get(row.id) || {})} className="block leading-tight" />
                    ) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {totals ? (
            <tfoot>
              <tr>
                <td className={cn(stickyCol, "sticky bottom-0 z-[15] border-t border-line-strong bg-inset px-3 py-2.5 text-xs font-semibold md:text-sm")}>
                  <span className="block max-w-[10rem] md:max-w-[24rem]" title={totalLabel}>{totalLabel}</span>
                </td>
                {showStatus ? <td className={stickyFoot} /> : null}
                {showMatchCol ? <td className={stickyFoot} /> : null}
                {showCampaign ? <td className={stickyFoot} /> : null}
                {showAdGroup ? <td className={stickyFoot} /> : null}
                {shownCols.map((c) => (
                  <td key={c.key} className={cn(stickyFoot, "whitespace-nowrap px-2.5 py-2.5 text-right font-semibold tabular-nums")}>{c.total ? c.total(totals) : "—"}</td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
        {convPop && convDetail ? (() => {
          const row = visible.find((r) => r.id === convPop.id);
          return row ? (
            <div data-conv-pop className="fixed z-50 w-[min(34rem,calc(100vw-1rem))] rounded-lg border border-line bg-paper p-3 text-left shadow-sheet" style={{ top: convPop.top, right: convPop.right }}>
              {convDetail(row)}
            </div>
          ) : null;
        })() : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!query && filtered.length > TOP ? (
          <button type="button" onClick={() => { setShowAll((v) => !v); setPage(0); }} className="rounded-md bg-inset px-3.5 py-2 text-sm font-medium text-ink hover:bg-line">
            {showAll ? `Chỉ hiện top ${TOP}` : `Xem tất cả ${filtered.length} dòng (đang hiện top ${TOP} theo sắp xếp)`}
          </button>
        ) : null}
        {paginate ? (
          <div className="ml-auto flex items-center gap-1 text-sm">
            <button type="button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} className="h-9 rounded-md px-3 hover:bg-inset disabled:opacity-40">← Trước</button>
            <span className="tabular-nums text-muted">Trang {safePage + 1}/{pages}</span>
            <button type="button" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)} className="h-9 rounded-md px-3 hover:bg-inset disabled:opacity-40">Sau →</button>
          </div>
        ) : null}
      </div>
      {totals && (query || visible.length < filtered.length) ? (
        <p className="text-xs text-subtle">Dòng tổng tính trên toàn bộ {deep ? "dòng trong ngày đã kéo" : "chiến dịch trong khoảng"}, không theo ô tìm / trang.</p>
      ) : null}
    </div>
  );
}

// ── Conversion actions ─────────────────────────────────────────────────────────────

/** Metrics with Conv / CPL / CR counted from the selected actions only. */
function withConv(m: Record<string, number>, cells: ActionCells | undefined, ids: string[]): Record<string, number> {
  let c = 0;
  for (const id of ids) c += cells?.[id]?.[0] || 0;
  const cost = m.cost || 0;
  const clicks = m.clicks || 0;
  return { ...m, conversions: c, cost_per_conversion: c ? cost / c : 0, cr: clicks ? c / clicks : 0 };
}

function applyConvFilter(block: LayerBlock | DeepLayerBlock, rows: Record<string, ActionCells>, ids: string[]): LayerBlock | DeepLayerBlock {
  const next = { ...block, rows: block.rows.map((r) => ({ ...r, metrics: withConv(r.metrics, rows[r.id], ids) })) } as LayerBlock | DeepLayerBlock;
  if ("totals" in block && block.totals) {
    let c = 0;
    for (const cells of Object.values(rows)) for (const id of ids) c += cells[id]?.[0] || 0;
    const t = block.totals as Record<string, number>;
    (next as DeepLayerBlock).totals = { ...t, conversions: c, cost_per_conversion: c ? (t.cost || 0) / c : 0, cr: t.clicks ? c / t.clicks : 0 } as DeepLayerBlock["totals"];
  }
  return next;
}

function ConvActionFilter({
  data, loading, error, selected, onChange,
}: {
  data: ConvActionRead | null;
  loading: boolean;
  error: boolean;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const actions = data?.actions || [];
  const sel = new Set(selected);
  const names = actions.filter((a) => sel.has(a.id)).map((a) => a.name);
  const partial = data && data.covered_days < data.total_days;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <div ref={box} className="relative">
        <button
          type="button"
          disabled={!actions.length}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-md border px-3 font-medium disabled:opacity-60",
            sel.size ? "border-accent bg-accent-soft text-accent" : "border-line bg-paper text-ink hover:bg-inset",
          )}
        >
          Loại chuyển đổi{sel.size ? ` (${sel.size})` : ": Tất cả"}
          <ChevronDown className="size-3.5" />
        </button>
        {open ? (
          <div className="absolute left-0 top-full z-40 mt-1 max-h-80 w-[min(28rem,calc(100vw-2rem))] overflow-auto rounded-lg border border-line bg-paper py-1 shadow-sheet">
            <button type="button" onClick={() => onChange([])} className={cn("block w-full px-3 py-2 text-left text-sm hover:bg-inset", !sel.size && "font-semibold text-accent")}>Tất cả</button>
            {actions.map((a) => (
              <label key={a.id} className="flex cursor-pointer items-start gap-2 px-3 py-2 hover:bg-inset">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-accent"
                  checked={sel.has(a.id)}
                  onChange={() => onChange(sel.has(a.id) ? selected.filter((x) => x !== a.id) : [...selected, a.id])}
                />
                <span className="min-w-0 flex-1">
                  <span className="block [overflow-wrap:anywhere] text-ink">{a.name}</span>
                  <span className="text-xs text-muted">{convCategoryVi(a.category)}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted">{convNum(a.conversions)}</span>
              </label>
            ))}
          </div>
        ) : null}
      </div>
      {loading ? <span className="text-xs text-subtle">Đang tải loại chuyển đổi…</span> : null}
      {error ? <span className="text-xs text-warn">Chưa đọc được loại chuyển đổi.</span> : null}
      {!loading && !error && data && !actions.length ? <span className="text-xs text-subtle">Không có hành động chuyển đổi trong khoảng này.</span> : null}
      {sel.size ? (
        <span className="rounded-md bg-accent-soft px-2 py-1 text-xs text-accent" title={names.join(", ")}>
          Conv / CPL / CR chỉ tính: {names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ")}
        </span>
      ) : null}
      {partial ? <span className="text-xs text-warn">Loại chuyển đổi mới có {data!.covered_days}/{data!.total_days} ngày — số theo loại chỉ tham khảo.</span> : null}
    </div>
  );
}

function ConvBreakdown({
  row, cells, names, highlight,
}: {
  row: LayerRow;
  cells: ActionCells | undefined;
  names: ConvActionRead["actions"];
  highlight: string[];
}) {
  const byId = new Map(names.map((a) => [a.id, a]));
  const list = Object.entries(cells || {})
    .map(([id, [c, v, all]]) => ({ id, name: byId.get(id)?.name || id, category: byId.get(id)?.category || null, c, v, all }))
    .filter((x) => x.c > 0 || x.all > 0)
    .sort((a, b) => b.c - a.c || b.all - a.all);
  const total = list.reduce((s, x) => s + x.c, 0);
  const cost = row.metrics.cost || 0;
  const hl = new Set(highlight);
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-ink [overflow-wrap:anywhere]">Chuyển đổi theo hành động · {row.name}</p>
      {list.length ? (
        <table className="w-full text-xs">
          <thead className="text-muted">
            <tr>
              <th className="pb-1 text-left font-medium">Hành động</th>
              <th className="pb-1 pl-2 text-right font-medium">Conv</th>
              <th className="pb-1 pl-2 text-right font-medium">%</th>
              <th className="pb-1 pl-2 text-right font-medium">Giá trị</th>
              <th className="pb-1 pl-2 text-right font-medium">Chi phí/conv</th>
            </tr>
          </thead>
          <tbody>
            {list.map((x) => (
              <tr key={x.id} className={cn("border-t border-line/60 align-top", hl.has(x.id) && "bg-accent-soft/60")}>
                <td className="py-1.5 pr-2">
                  <span className="block [overflow-wrap:anywhere] text-ink">{x.name}</span>
                  <span className="text-muted">{convCategoryVi(x.category)}{x.c === 0 && x.all > 0 ? ` · chỉ "Mọi chuyển đổi": ${convNum(x.all)}` : ""}</span>
                </td>
                <td className="py-1.5 pl-2 text-right tabular-nums text-ink">{convNum(x.c)}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums text-muted">{total > 0 ? `${((x.c / total) * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%` : ""}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums text-muted">{x.v > 0 ? dong(x.v) : ""}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums text-ink">{x.c > 0 && cost > 0 ? dong(cost / x.c) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-muted">Chưa có số theo hành động cho dòng này (chưa kéo hoặc không có chuyển đổi).</p>
      )}
      <p className="mt-2 text-[11px] text-subtle">Chi phí/conv = chi tiêu của dòng ÷ conv của hành động. Conv chính (cột Conv) chỉ gồm hành động được đặt làm chính trong Google Ads.</p>
    </div>
  );
}

// ── Impression share helpers ───────────────────────────────────────────────────────

type CampaignHint = { id: "budget" | "rank"; text: string; title: string };

/** Lost IS (budget) above this + the campaign converts well → "Nên tăng ngân sách". */
const HINT_BUDGET_LOST = 0.2;
/** Lost IS (rank) above this → "Cần cải thiện Quality Score / giá thầu". */
const HINT_RANK_LOST = 0.3;

/**
 * Per-campaign insight chips. "Converts well" = at least 1 conversion in the range and a CPL no higher
 * than the account's CPL for the same range (campaigns without conversions never get the budget hint).
 */
function shareHints(rows: LayerRow[], shares: Record<string, ShareCells>, account: Record<string, number>): Record<string, CampaignHint[]> {
  const out: Record<string, CampaignHint[]> = {};
  const accCpl = account.conversions > 0 ? (account.cost || 0) / account.conversions : null;
  for (const r of rows) {
    const s = shares[r.id];
    if (!s) continue;
    const list: CampaignHint[] = [];
    const conv = r.metrics.conversions || 0;
    const cpl = conv > 0 ? (r.metrics.cost || 0) / conv : null;
    const convertsWell = cpl != null && (accCpl == null || cpl <= accCpl);
    if (s.is_lost_budget != null && s.is_lost_budget > HINT_BUDGET_LOST && convertsWell) {
      list.push({ id: "budget", text: "Nên tăng ngân sách", title: `Mất ${fmtShare(s.is_lost_budget)} lượt hiển thị vì ngân sách, CPL ${dong(cpl || 0)} ≤ CPL tài khoản` });
    }
    if (s.is_lost_rank != null && s.is_lost_rank > HINT_RANK_LOST) {
      list.push({ id: "rank", text: "Cần cải thiện Quality Score / giá thầu", title: `Mất ${fmtShare(s.is_lost_rank)} lượt hiển thị vì xếp hạng quảng cáo (Ad Rank)` });
    }
    if (list.length) out[r.id] = list;
  }
  return out;
}

function HintChips({ hints }: { hints: CampaignHint[] }) {
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {hints.map((h) => (
        <span key={h.id} title={h.title} className={cn("rounded-sm px-1.5 py-0.5 text-[11px] font-medium", h.id === "budget" ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn")}>{h.text}</span>
      ))}
    </span>
  );
}

/** Change in percentage points; nothing when either side is missing or a "<10%" / ">90%" bound. */
function shareDelta(key: string, cur: ShareCells | undefined, prev: ShareCells | undefined): { text: string; tone: "good" | "bad" | "flat" } | null {
  const n = cur?.[key];
  const p = prev?.[key];
  if (n == null || p == null || shareBound(n) || shareBound(p)) return null;
  const d = (n - p) * 100;
  if (Math.abs(d) < 0.05) return { text: "= 0 đ%", tone: "flat" };
  const up = d > 0;
  const good = SHARE_LOWER_BETTER.has(key) ? !up : up;
  return { text: `${up ? "▲" : "▼"} ${Math.abs(d).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} đ%`, tone: good ? "good" : "bad" };
}
