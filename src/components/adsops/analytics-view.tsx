import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Info, Search, SlidersHorizontal, X } from "lucide-react";
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
import { readDeepLayerFn } from "@/lib/adsops/connect.functions";
import { addDays, formatRangeVi, moneyPlain, num, pct, statusVi } from "@/lib/adsops/format";
import { cn } from "@/lib/cn";
import { BudgetBanner } from "@/components/adsops/budget-banner";

const SUBTABS = [
  { id: "overview", label: "Tổng quan" },
  { id: "monthly", label: "Theo tháng" },
  { id: "campaign", label: "Chiến dịch" },
  { id: "ad_group", label: "Nhóm" },
  { id: "keyword", label: "Từ khoá" },
  { id: "search_term", label: "Search terms" },
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
/** Subtle per-column heat tint. Text stays ink (contrast ≥ 7:1 on every step). */
function heat(value: number, max: number, tone: "cool" | "warm" = "cool", min = 0): CSSProperties | undefined {
  if (!(value > 0) || !(max > 0)) return undefined;
  const lo = min > 0 && min < max ? min : 0;
  const t = Math.max(0, Math.min(1, (value - lo) / (max - lo || 1)));
  const a = 0.03 + 0.22 * t;
  return { backgroundColor: tone === "cool" ? `rgb(33 84 92 / ${a.toFixed(3)})` : `rgb(154 103 0 / ${a.toFixed(3)})` };
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
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex size-9 items-center justify-center rounded-full text-muted hover:bg-inset hover:text-ink">
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
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", live ? "bg-ok-bg text-ok" : paused ? "bg-warn-bg text-warn" : "bg-inset text-muted")}>
      <span className={cn("size-1.5 rounded-full", live ? "bg-ok" : paused ? "bg-warn" : "bg-subtle")} />
      {statusVi(status)}
    </span>
  );
}

function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-2 p-1" aria-label="Đang tải">
      <div className="h-9 rounded-md bg-inset" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-2">
          <div className="h-8 w-1/3 rounded bg-inset/80" />
          <div className="h-8 flex-1 rounded bg-inset/60" />
        </div>
      ))}
    </div>
  );
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
  const color = tone === "cool" ? "var(--color-accent)" : "var(--color-warn)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-8 w-full" aria-hidden>
      {segments.map((pts, i) =>
        pts.includes(" ") ? (
          <polyline key={i} points={pts} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ) : (
          <circle key={i} cx={pts.split(",")[0]} cy={pts.split(",")[1]} r={1.4} fill={color} />
        ),
      )}
    </svg>
  );
}

function Segmented<T extends string>({ items, value, onChange, size = "md" }: { items: readonly { id: T; label: string }[]; value: T; onChange: (v: T) => void; size?: "sm" | "md" }) {
  return (
    <div className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-inset p-1 [scrollbar-width:none]" role="tablist">
      {items.map((item) => (
        <button key={item.id} type="button" role="tab" aria-selected={value === item.id} onClick={() => onChange(item.id)} className={cn("shrink-0 whitespace-nowrap rounded-full font-medium transition-colors duration-150", size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-3.5 text-sm", value === item.id ? "bg-paper text-ink shadow-sm" : "text-muted hover:text-ink")}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

const card = "rounded-xl bg-paper shadow-sheet";

export function AnalyticsView({
  snap,
  allowCompare = true,
  deepEpoch = 0,
  userKey,
}: {
  snap: AnalyticsSnap;
  allowCompare?: boolean;
  deepEpoch?: number;
  userKey?: string | null;
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
  const [filtersOpen, setFiltersOpen] = useState(false);

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
  const activePreset =
    weekN || monthN ? "" :
    end === warehouseEnd && start === warehouseStart ? "all" :
    end === warehouseEnd ? presets.find((p) => p.days === daySpan)?.id || "" : "";

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

  const [deepBlock, setDeepBlock] = useState<DeepLayerBlock | null>(null);
  const [deepLoading, setDeepLoading] = useState(false);
  const [deepError, setDeepError] = useState("");
  const pmaxSelected = Boolean(snap.campaigns.find((c) => c.id === campaignId)?.pmax);

  useEffect(() => {
    if (!tableLayer || !isDeepLayer(tableLayer) || pmaxSelected) {
      setDeepBlock(null); setDeepError(""); setDeepLoading(false); return;
    }
    let cancelled = false;
    setDeepLoading(true); setDeepError("");
    readDeepLayerFn({ data: { clientId: snap.client_id, layer: tableLayer, start, end, campaignId, adGroupId, onlyWithConv: onlyConv } })
      .then((block) => {
        if (cancelled) return;
        setDeepBlock(block); setDeepLoading(false);
        if (block.facets) setFacetsByLayer((prev) => ({ ...prev, [tableLayer]: block.facets as DeepFacets }));
      })
      .catch((err) => { if (!cancelled) { setDeepBlock(null); setDeepError(err instanceof Error ? err.message : "Không đọc được lớp nhóm / từ khoá."); setDeepLoading(false); } });
    return () => { cancelled = true; };
  }, [snap.client_id, tableLayer, pmaxSelected, start, end, campaignId, adGroupId, onlyConv, deepEpoch]);

  const current: LayerBlock | DeepLayerBlock | null =
    tableLayer === "campaign" ? campaignBlock :
    pmaxSelected ? { complete: true, rows: [], pmax_note: snap.pmax_note || "PMax không có search term / keyword chuẩn" } :
    deepBlock;

  const prevRange = allowCompare && prevEqual ? previousEqualRange(start, end) : null;
  const prevStart = prevRange?.start || "";
  const prevEnd = prevRange?.end || "";
  const prevAccount = useMemo(
    () => (prevStart && prevEnd ? layerRows(snap, { layer: "account", start: prevStart, end: prevEnd }) : null),
    [snap, prevStart, prevEnd],
  );
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
  const prevMetrics = prevAccount?.complete ? prevAccount.rows[0]?.metrics : undefined;
  const deepLayer = tableLayer && isDeepLayer(tableLayer) ? tableLayer : null;
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

      <div className="sticky top-0 z-30 -mx-4 bg-bg/90 px-4 pb-1 pt-2 backdrop-blur md:-mx-1 md:px-1">
        <div className={cn(card, "flex flex-col gap-3 p-3 md:p-4")}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium uppercase tracking-wider text-subtle">Phân tích · {snap.display_name}</p>
              <p className="truncate font-display text-lg font-medium tracking-tight tabular-nums md:text-xl">
                {rangeLabel}
                <span className="ml-2 align-middle font-sans text-xs font-normal text-muted">{daySpan} ngày</span>
              </p>
            </div>
            <div className="hidden items-center gap-1 lg:flex">
              {presets.map((p) => (
                <button key={p.id} type="button" onClick={() => applyRange(addDays(warehouseEnd, -(p.days - 1)), warehouseEnd)} className={cn("h-9 rounded-full px-3 text-sm font-medium transition-colors", activePreset === p.id ? "bg-accent text-accent-fg" : "text-ink hover:bg-inset")}>{p.label}</button>
              ))}
              <button type="button" onClick={() => applyRange(warehouseStart, warehouseEnd)} className={cn("h-9 rounded-full px-3 text-sm font-medium transition-colors", activePreset === "all" ? "bg-accent text-accent-fg" : "text-ink hover:bg-inset")}>Toàn kho</button>
            </div>
            <button type="button" onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen} className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium", filtersOpen ? "bg-ink text-paper" : "bg-inset text-ink hover:bg-line")}>
              <SlidersHorizontal className="size-4" /> Lọc ngày
            </button>
            <InfoPopover label="Giải thích số liệu">
              <p className="font-medium">Về số liệu</p>
              <ul className="mt-2 list-disc space-y-1.5 pl-4 text-muted">
                <li>Chỉ đọc từ Google Ads — không apply, không sửa tài khoản.</li>
                <li>Chuyển đổi Google (CPA / Platform CPL) ≠ Qualified Lead. All conversions không gộp vào.</li>
                <li>Cột Gọi / Zalo / Facebook chat / Form map từ conversion action của tài khoản này. Secondary (page view) không lên màn.</li>
                <li>CPC / CTR / CR / chi phí mỗi chuyển đổi tính trên mọi click. Conv = 0 → chi/conv = 0.</li>
                <li>Ngày không có số để trống (—), không điền 0, không ngoại suy.</li>
                <li>Màu nền ô = độ lớn trong cột (xanh: khối lượng; vàng: chi phí trên đơn vị).</li>
                <li>Timezone {snap.timezone}.</li>
                {snap.warehouse_start ? (
                  <li>Kho {dmy(snap.warehouse_start)} → {dmy(warehouseEnd)}{typeof snap.day_count === "number" ? ` (${snap.day_count} ngày có số)` : ""}{typeof snap.analytics_lookback_days === "number" ? ` · lần kéo đầy đủ gần nhất ${snap.analytics_lookback_days} ngày` : ""}.</li>
                ) : null}
                {prevRange ? <li>So với {formatRangeVi(prevRange.start, prevRange.end)}.</li> : null}
              </ul>
            </InfoPopover>
          </div>

          {filtersOpen ? (
            <div className="flex flex-col gap-3 border-t border-line pt-3">
              <div className="flex flex-wrap gap-1 lg:hidden">
                {presets.map((p) => (
                  <button key={p.id} type="button" onClick={() => applyRange(addDays(warehouseEnd, -(p.days - 1)), warehouseEnd)} className={cn("h-9 rounded-full px-3 text-sm font-medium", activePreset === p.id ? "bg-accent text-accent-fg" : "bg-inset text-ink")}>{p.label}</button>
                ))}
                <button type="button" onClick={() => applyRange(warehouseStart, warehouseEnd)} className={cn("h-9 rounded-full px-3 text-sm font-medium", activePreset === "all" ? "bg-accent text-accent-fg" : "bg-inset text-ink")}>Toàn kho</button>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs font-medium text-muted">Từ<input type="date" value={draftStart} min={snap.warehouse_start || undefined} max={warehouseEnd} onChange={(e) => setDraftStart(e.target.value)} className="h-10 rounded-md border border-line bg-bg px-2.5 text-sm text-ink" /></label>
                <label className="flex flex-col gap-1 text-xs font-medium text-muted">Đến<input type="date" value={draftEnd} min={snap.warehouse_start || undefined} max={warehouseEnd} onChange={(e) => setDraftEnd(e.target.value)} className="h-10 rounded-md border border-line bg-bg px-2.5 text-sm text-ink" /></label>
                <button type="button" onClick={() => draftStart && draftEnd && draftStart <= draftEnd && applyRange(draftStart, draftEnd)} className="h-10 rounded-full bg-accent px-4 text-sm font-medium text-accent-fg">Xem số</button>
                {allowCompare ? (
                  <>
                    <label className="flex h-10 items-center gap-2 rounded-full bg-inset px-3 text-sm"><input type="checkbox" checked={prevEqual} onChange={(e) => setPrevEqual(e.target.checked)} className="size-4 accent-accent" />So kỳ trước cùng độ dài</label>
                    {snap.week_choices.length ? (
                      <label className="flex h-10 items-center gap-2 rounded-full bg-inset px-3 text-sm">Tuần
                        <select value={weekN} onChange={(e) => { setWeekN(Number(e.target.value)); setMonthN(0); if (Number(e.target.value)) setTab("monthly"); }} className="h-8 bg-transparent text-sm">
                          <option value={0}>—</option>
                          {snap.week_choices.map((n) => <option key={n} value={n}>{n} tuần (T2–CN)</option>)}
                        </select>
                      </label>
                    ) : null}
                    <label className="flex h-10 items-center gap-2 rounded-full bg-inset px-3 text-sm">Tháng trước
                      <select value={monthN} onChange={(e) => { setMonthN(Number(e.target.value)); setWeekN(0); if (Number(e.target.value)) setTab("monthly"); }} className="h-8 bg-transparent text-sm">
                        <option value={0}>—</option>
                        {(snap.month_choices.length ? snap.month_choices : [1, 2, 3, 4, 5, 6, 7, 8, 9]).map((n) => <option key={n} value={n}>{n} tháng</option>)}
                      </select>
                    </label>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented items={SUBTABS} value={tab} onChange={setTab} />
            {prevRange && prevAccount && !prevAccount.complete ? (
              <span className="inline-flex items-center rounded-full bg-inset px-3 py-1 text-xs font-medium text-muted">Kỳ trước ({formatRangeVi(prevRange.start, prevRange.end)}) thiếu dữ liệu — không so</span>
            ) : null}
            {!cov.complete ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-bg px-3 py-1 text-xs font-medium text-warn">Kho có số {cov.present}/{cov.present + cov.missing} ngày trong khoảng · ngày thiếu để trống</span>
            ) : null}
          </div>
        </div>
      </div>

      {tab === "overview" ? (
        <Overview snap={snap} start={start} end={end} metrics={metrics} prevMetrics={prevRange ? prevMetrics : undefined} prevIncomplete={Boolean(prevRange && prevAccount && !prevAccount.complete)} hasRows={account.rows.length > 0} campaigns={campaignBlock?.rows || []} groups={groups} onOpenCampaigns={() => setTab("campaign")} onPickCampaign={(row) => { setCampaignId(row.id); setAdGroupId(null); setTab(row.pmax ? "search_term" : "ad_group"); }} />
      ) : null}

      {tab === "monthly" ? (
        <PeriodSection title={weeks.length ? "Từng tuần cạnh nhau" : monthN ? "Các tháng trước" : "Theo tháng"} cols={periodCols} blocks={periodBlocks} accountBlocks={periodAccountBlocks} groups={groups} layer={periodLayer} onLayerChange={setPeriodLayer} splitKnown={splitKnown} onWholeWarehouse={() => applyRange(warehouseStart, warehouseEnd)} onPickCampaign={(id) => { const pm = snap.campaigns.find((c) => c.id === id)?.pmax; setCampaignId(id); setAdGroupId(null); setTab(pm ? "search_term" : "ad_group"); }} />
      ) : null}

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
              <label className="flex h-10 items-center gap-2 rounded-full bg-inset px-3 text-sm"><input type="checkbox" checked={onlyConv} onChange={(e) => setOnlyConv(e.target.checked)} className="size-4 accent-accent" />Chỉ có conv</label>
            </div>
          )}
          {isDeepLayer(tableLayer) && deepLoading && !pmaxSelected ? <Skeleton rows={8} /> :
           deepError && isDeepLayer(tableLayer) ? <p className="rounded-md bg-warn-bg px-4 py-6 text-sm text-warn">{deepError}</p> :
           current ? <DataTable key={`${tableLayer}:${campaignId}:${adGroupId}`} layer={tableLayer} block={current} groups={groups} canDrill={tableLayer === "campaign" || tableLayer === "ad_group"} onDrill={drill} splitKnown={splitKnown} campaignNames={Object.fromEntries(snap.campaigns.map((c) => [c.id, c.name]))} query={tableQuery} onQueryChange={setTableQuery} scoped={scoped} totalAll={facets?.total_rows} /> :
           <p className="rounded-md bg-inset px-4 py-6 text-sm text-muted">Chưa kéo lớp này. Dùng nút &quot;Kéo nhóm / từ khoá&quot; phía trên (admin / trưởng phòng Ads / người tối ưu).</p>}
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

function deltaWord(now: number | undefined, prev: number | undefined): { word: string; dir: 0 | 1 | -1 } {
  if (prev == null || now == null) return { word: "—", dir: 0 };
  if (prev === 0 && now === 0) return { word: "—", dir: 0 };
  if (prev === 0) return { word: "tăng", dir: 1 };
  const d = (now - prev) / Math.abs(prev);
  if (Math.abs(d) < 0.005) return { word: "—", dir: 0 };
  return d > 0 ? { word: "tăng", dir: 1 } : { word: "giảm", dir: -1 };
}

function Overview({
  snap, start, end, metrics, prevMetrics, prevIncomplete, hasRows, campaigns, groups, onOpenCampaigns, onPickCampaign,
}: {
  snap: AnalyticsSnap; start: string; end: string; metrics: Record<string, number>; prevMetrics?: Record<string, number>;
  prevIncomplete: boolean; hasRows: boolean; campaigns: LayerRow[];
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
          <KpiCard key={k.id} def={k} metrics={metrics} prev={prevMetrics} prevIncomplete={prevIncomplete} values={series.map((d) => (d ? k.daily(d) : null))} big />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPIS.filter((k) => !k.primary).map((k) => (
          <KpiCard key={k.id} def={k} metrics={metrics} prev={prevMetrics} prevIncomplete={prevIncomplete} values={series.map((d) => (d ? k.daily(d) : null))} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <section className={cn(card, "p-4 lg:col-span-2")}>
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-medium tracking-tight">Loại chuyển đổi</h3>
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
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-inset"><div className="h-full rounded-full bg-accent" style={{ width: `${(share * 100).toFixed(1)}%` }} /></div>
                </li>
              );
            })}
          </ul>
        </section>
        <section className={cn(card, "p-4 lg:col-span-3")}>
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-medium tracking-tight">Chiến dịch chi nhiều nhất</h3>
            <button type="button" onClick={onOpenCampaigns} className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm font-medium text-accent hover:bg-inset">Xem tất cả ({campaigns.length}) <ChevronRight className="size-4" /></button>
          </div>
          {top.length === 0 ? <p className="mt-3 text-sm text-muted">Không có chiến dịch có số trong khoảng này.</p> : (
            <ul className="mt-2 divide-y divide-line">
              {top.map((row) => (
                <li key={row.id}>
                  <button type="button" onClick={() => onPickCampaign(row)} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 py-2.5 text-left hover:bg-inset/40">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium" title={row.name}>{row.name}</span>
                      {row.pmax ? <span className="shrink-0 rounded-full bg-inset px-2 py-0.5 text-[11px] font-medium text-muted">PMax</span> : null}
                    </span>
                    <span className="text-right text-sm font-medium tabular-nums">{dongShort(row.metrics.cost || 0)}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-inset"><span className="block h-full rounded-full bg-accent/70" style={{ width: `${maxCost ? ((row.metrics.cost || 0) / maxCost) * 100 : 0}%` }} /></span>
                    <span className="text-right text-xs text-muted tabular-nums">{convNum(row.metrics.conversions || 0)} conv · CPL {dongShort(row.metrics.cost_per_conversion || 0)}</span>
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

function KpiCard({ def, metrics, prev, values, big }: { def: KpiDef; metrics: Record<string, number>; prev?: Record<string, number>; prevIncomplete?: boolean; values: (number | null)[]; big?: boolean }) {
  const d = prev ? deltaWord(metrics[def.id], prev[def.id]) : null;
  return (
    <div className={cn(card, "flex min-w-0 flex-col gap-1 p-3 md:p-4", big && "ring-1 ring-accent/10")}>
      <p className="truncate text-xs font-medium uppercase tracking-wider text-subtle" title={def.hint || def.label}>{def.label}</p>
      <p className={cn("truncate font-display font-medium tracking-tight tabular-nums", big ? "text-2xl md:text-[1.75rem]" : "text-lg md:text-xl")}>{def.value(metrics)}</p>
      <Sparkline values={values} tone={def.tone} />
      {d ? (
        <p className="flex items-center gap-1 text-xs text-muted">{d.dir > 0 ? <ArrowUp className="size-3" /> : d.dir < 0 ? <ArrowDown className="size-3" /> : null}{d.word} vs kỳ trước</p>
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

const scrollBox = "relative max-h-[70vh] overflow-auto overscroll-contain rounded-lg border border-line bg-paper";
const thBase = "sticky top-0 z-10 whitespace-nowrap border-b border-line bg-paper px-3 py-2.5 text-xs font-medium text-muted";
const stickyCol = "sticky left-0 z-[5] bg-paper shadow-[1px_0_0_var(--color-line)]";
const cornerCell = "sticky left-0 top-0 z-20 bg-paper shadow-[1px_0_0_var(--color-line)]";

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
        <h3 className="font-display text-lg font-medium">{title}</h3>
        <p className="text-sm text-muted">Khoảng ngày đang chọn nằm trong 1 tháng. Chọn khoảng dài hơn để xem các tháng cạnh nhau.</p>
        <button type="button" onClick={onWholeWarehouse} className="h-10 rounded-full bg-accent px-4 text-sm font-medium text-accent-fg">Xem toàn kho theo tháng</button>
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
          <h3 className="font-display text-lg font-medium tracking-tight">{title}</h3>
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
          <p className="px-4 py-6 text-sm text-muted">Không có chiến dịch có số trong các kỳ này. Không đoán số.</p>
        ) : mode === "matrix" ? (
          <table id="analytics-campaign-matrix" className="min-w-full border-separate border-spacing-0 text-left text-sm">
            {header(`${kpiMeta.label} theo chiến dịch`)}
            <tbody>
              {shown.map((camp) => (
                <tr key={camp.id} className="group">
                  <td className={cn(stickyCol, "border-b border-line/60 px-3 py-1 group-hover:bg-inset")}>
                    <button type="button" onClick={() => onPickCampaign(camp.id)} className="flex min-h-10 w-full max-w-[11rem] items-center gap-2 text-left font-medium md:max-w-[22rem]" title={camp.name}>
                      <span className="truncate">{camp.name}</span>
                      {camp.pmax ? <span className="shrink-0 rounded-full bg-inset px-1.5 text-[11px] text-muted">PMax</span> : null}
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
                      {camp.pmax ? <span className="shrink-0 rounded-full bg-paper px-1.5 text-[11px] text-muted">PMax</span> : null}
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
        <button type="button" onClick={() => setShowAll((v) => !v)} className="self-start rounded-full bg-inset px-3.5 py-2 text-sm font-medium text-ink hover:bg-line">
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
      text: layer === "search_term" ? `Search terms: kho tối đa ${cap} ngày gần nhất; chưa kéo phần này trong khoảng đã chọn. Không đoán số.` : "Chưa kéo lớp này trong khoảng đã chọn. Không đoán số.",
      warn: true,
    };
  }
  const rangeText = ranges.map((r) => `${dmy(r.start)} → ${dmy(r.end)}`).join("; ");
  const name = layer === "ad_group" ? "Nhóm quảng cáo" : layer === "keyword" ? "Từ khoá" : "Search terms";
  const bits = [`${name} có số từ ${rangeText}`];
  if (!deep.complete) bits.push("ngoài khoảng này chưa kéo — tổng chỉ gồm ngày đã kéo, không điền 0");
  if (layer === "search_term") bits.push(`search term tối đa ${cap} ngày gần nhất`);
  return { text: bits.join(" · "), warn: !deep.complete };
}

type CampaignLite = { id: string; name: string; pmax?: boolean };

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
  const selectBox = "flex h-10 min-w-0 items-center gap-2 rounded-full bg-inset pl-3.5 pr-1.5 text-sm sm:max-w-[20rem]";
  const selectEl = "h-9 min-w-0 flex-1 cursor-pointer truncate rounded-full bg-transparent pr-1 text-base font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent sm:text-sm";
  const countSuffix = (n: number | null) => (n == null ? "" : ` (${n})`);
  return (
    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center" role="group" aria-label="Lọc theo chiến dịch / nhóm">
      <label className={selectBox}>
        <span className="shrink-0 text-xs font-medium text-muted">Chiến dịch</span>
        <select value={campaignId || ""} onChange={(e) => onCampaign(e.target.value || null)} className={selectEl} aria-label="Lọc theo chiến dịch">
          <option value="">Tất cả chiến dịch{facets ? ` (${facets.campaigns.length})` : ""}</option>
          {campOpts.map((c) => <option key={c.id} value={c.id}>{c.name}{countSuffix(c.rows)}</option>)}
        </select>
      </label>
      {showGroups ? (
        <label className={cn(selectBox, !groupOpts.length && "opacity-60")}>
          <span className="shrink-0 text-xs font-medium text-muted">Nhóm</span>
          <select
            value={adGroupId || ""}
            disabled={!groupOpts.length}
            onChange={(e) => {
              const id = e.target.value || null;
              const g = groupOpts.find((x) => x.id === id);
              onAdGroup(id, g?.name || "", g?.campaign_id || null);
            }}
            className={selectEl}
            aria-label="Lọc theo nhóm quảng cáo"
          >
            <option value="">{campaignId ? "Tất cả nhóm trong chiến dịch" : "Tất cả nhóm"}{groupOpts.length ? ` (${groupOpts.filter((g) => g.rows != null).length})` : ""}</option>
            {groupOpts.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name || g.id}
                {!campaignId && (nameCount.get(g.name) || 0) > 1 ? ` — ${snapName(g.campaign_id) || campOpts.find((c) => c.id === g.campaign_id)?.name || g.campaign_id}` : ""}
                {countSuffix(g.rows)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="flex items-center gap-2">
        <label className="flex h-10 items-center gap-2 rounded-full bg-inset px-3 text-sm"><input type="checkbox" checked={onlyConv} onChange={(e) => onOnlyConv(e.target.checked)} className="size-4 accent-accent" />Chỉ có conv</label>
        {canClear ? (
          <button type="button" onClick={onClear} className="inline-flex h-10 items-center gap-1 rounded-full px-3 text-sm font-medium text-accent hover:bg-inset"><X className="size-4" /> Xoá lọc</button>
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
};

function DataTable({
  layer, block, groups, canDrill, onDrill, campaignNames, splitKnown = true, query: queryProp, onQueryChange, scoped = false, totalAll,
}: {
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
}) {
  const [queryLocal, setQueryLocal] = useState("");
  const query = queryProp ?? queryLocal;
  const setQuery = onQueryChange ?? setQueryLocal;
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "cost", dir: -1 });
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState(0);
  const note = coverageNote(block, layer);
  const deep = "coverage" in block ? (block as DeepLayerBlock) : null;
  const isDeep = Boolean(deep);
  const showMatch = layer === "keyword" || layer === "search_term";
  const showConvSplit = deep ? deep.conv_split : splitKnown;

  const cols: ColDef[] = useMemo(
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

  const filtered = useMemo(() => {
    const q = fold(query.trim());
    let rows = block.rows;
    if (q) rows = rows.filter((r) => fold(`${r.name} ${r.campaign_name || campaignNames[r.campaign_id || ""] || ""} ${r.ad_group_name || ""}`).includes(q));
    const col = cols.find((c) => c.key === sort.key);
    return [...rows].sort((a, b) => {
      if (sort.key === "name") return a.name.localeCompare(b.name, "vi") * sort.dir;
      if (sort.key === "status") return String(a.status || "").localeCompare(String(b.status || "")) * sort.dir;
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
      <div className="space-y-2">
        {note ? <p className={cn("rounded-md px-3 py-2 text-sm", note.warn ? "bg-warn-bg text-warn" : "bg-inset text-muted")}>{note.text}</p> : null}
        <p className="rounded-md bg-inset px-4 py-6 text-sm text-muted">
          {scoped ? "Không có dòng khớp bộ lọc chiến dịch / nhóm trong khoảng ngày này." : block.complete ? "Không có dòng trong khoảng ngày này." : note?.text || "Thiếu dữ liệu — mốc chưa đủ ngày; API không trả hết cửa sổ. Không đoán số."}
        </p>
      </div>
    );
  }

  const TOP = 20;
  const PAGE = 50;
  const paginate = (showAll || Boolean(query)) && filtered.length > 100;
  const pages = paginate ? Math.ceil(filtered.length / PAGE) : 1;
  const safePage = Math.min(page, pages - 1);
  const visible = !showAll && !query ? filtered.slice(0, TOP) : paginate ? filtered.slice(safePage * PAGE, safePage * PAGE + PAGE) : filtered;
  const firstLabel = layer === "campaign" ? "Chiến dịch" : layer === "ad_group" ? "Nhóm quảng cáo" : layer === "keyword" ? "Từ khoá" : "Search term";

  function contextLine(row: LayerRow) {
    const camp = row.campaign_name || campaignNames[row.campaign_id || ""] || "";
    return [camp, row.ad_group_name || ""].filter(Boolean).join(" · ");
  }
  function toggleSort(key: string) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" || key === "status" ? 1 : -1 }));
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
          <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder={`Tìm ${firstLabel.toLowerCase()}…`} className="h-9 w-full rounded-full border border-line bg-bg pl-9 pr-3 text-sm text-ink placeholder:text-subtle" />
        </label>
        <span className="text-xs text-muted tabular-nums">
          {countLabel}
          {canDrill ? " · bấm tên để xuống tầng dưới" : ""}
        </span>
      </div>

      <div className={scrollBox}>
        <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr>
              <th className={cn(thBase, cornerCell, "min-w-[10rem] text-left md:min-w-[18rem]")}>
                <button type="button" onClick={() => toggleSort("name")} className="inline-flex items-center gap-1 hover:text-ink">{firstLabel} {sortIcon("name")}</button>
              </th>
              {layer !== "search_term" ? (
                <th className={cn(thBase, "text-left")}>
                  <button type="button" onClick={() => toggleSort("status")} className="inline-flex items-center gap-1 hover:text-ink">Trạng thái {sortIcon("status")}</button>
                </th>
              ) : null}
              {showMatch ? <th className={cn(thBase, "text-left")}>Khớp</th> : null}
              {cols.map((c) => (
                <th key={c.key} className={cn(thBase, "text-right")} aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                  <button type="button" onClick={() => toggleSort(c.key)} className={cn("inline-flex items-center gap-1 hover:text-ink", sort.key === c.key && "text-ink")}>{sortIcon(c.key)}{c.label}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} className="group">
                <td className={cn(stickyCol, "border-b border-line/60 px-3 py-1.5 group-hover:bg-inset")}>
                  {canDrill ? (
                    <button type="button" onClick={() => onDrill(row)} className="flex min-h-9 w-full max-w-[10rem] items-center gap-2 text-left font-medium text-ink hover:text-accent hover:underline md:max-w-[24rem]" title={row.name}>
                      <span className="truncate">{row.name}</span>
                      {row.pmax ? <span className="shrink-0 rounded-full bg-inset px-1.5 text-[11px] font-medium text-muted">PMax</span> : null}
                      <ChevronRight className="size-3.5 shrink-0 text-subtle" />
                    </button>
                  ) : (
                    <div className="flex min-h-9 max-w-[10rem] flex-col justify-center md:max-w-[24rem]" title={row.name}>
                      <span className="truncate font-medium">{row.name}</span>
                      {(layer === "search_term" || layer === "keyword") && contextLine(row) ? <span className="truncate text-xs text-subtle" title={contextLine(row)}>{contextLine(row)}</span> : null}
                    </div>
                  )}
                </td>
                {layer !== "search_term" ? <td className="border-b border-line/60 px-3 py-1.5"><StatusBadge status={row.status} /></td> : null}
                {showMatch ? <td className="whitespace-nowrap border-b border-line/60 px-3 py-1.5 text-muted">{row.match_type_label || row.match_type || "—"}</td> : null}
                {cols.map((c) => (
                  <td key={c.key} className={cn("whitespace-nowrap border-b border-line/60 px-3 py-1.5 text-right tabular-nums", c.strong && "font-medium")} style={c.heat ? heat(c.sortVal(row), colMax[c.key], c.heat, colMin[c.key]) : undefined}>
                    {c.cell(row)}
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
                {layer !== "search_term" ? <td className={stickyFoot} /> : null}
                {showMatch ? <td className={stickyFoot} /> : null}
                {cols.map((c) => (
                  <td key={c.key} className={cn(stickyFoot, "whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums")}>{c.total ? c.total(totals) : "—"}</td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!query && filtered.length > TOP ? (
          <button type="button" onClick={() => { setShowAll((v) => !v); setPage(0); }} className="rounded-full bg-inset px-3.5 py-2 text-sm font-medium text-ink hover:bg-line">
            {showAll ? `Chỉ hiện top ${TOP}` : `Xem tất cả ${filtered.length} dòng (đang hiện top ${TOP} theo sắp xếp)`}
          </button>
        ) : null}
        {paginate ? (
          <div className="ml-auto flex items-center gap-1 text-sm">
            <button type="button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} className="h-9 rounded-full px-3 hover:bg-inset disabled:opacity-40">← Trước</button>
            <span className="tabular-nums text-muted">Trang {safePage + 1}/{pages}</span>
            <button type="button" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)} className="h-9 rounded-full px-3 hover:bg-inset disabled:opacity-40">Sau →</button>
          </div>
        ) : null}
      </div>
      {totals && (query || visible.length < filtered.length) ? (
        <p className="text-xs text-subtle">Dòng tổng tính trên toàn bộ {deep ? "dòng trong ngày đã kéo" : "chiến dịch trong khoảng"}, không theo ô tìm / trang.</p>
      ) : null}
    </div>
  );
}
