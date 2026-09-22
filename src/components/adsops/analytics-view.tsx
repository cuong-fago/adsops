import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import {
  type AnalyticsSnap,
  type LayerBlock,
  type LayerRow,
  defaultRange,
  layerRows,
  monthsOverlapping,
  previousEqualRange,
  previousMonths,
  previousWeeks,
  warehouseDates,
  windowCoverage,
} from "@/lib/adsops/analytics";
import { addDays, formatRangeVi, moneyPlain, num, pct, statusVi } from "@/lib/adsops/format";
import { cn } from "@/lib/cn";
import { BudgetBanner } from "@/components/adsops/budget-banner";

const LAYERS = [
  { id: "campaign", label: "Chiến dịch" },
  { id: "ad_group", label: "Nhóm" },
  { id: "keyword", label: "Từ khoá" },
  { id: "search_term", label: "Search terms" },
] as const;

type LayerId = (typeof LAYERS)[number]["id"];

function convNum(value: number) {
  return num(value, Math.abs(value - Math.round(value)) < 1e-6 ? 0 : 2);
}

function dong(value: number) {
  return `${moneyPlain(value)}đ`;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-28 flex-col gap-1 text-xs font-medium text-muted">
      {label}
      {children}
    </label>
  );
}

const controlClass = "h-11 w-full rounded-md border border-line bg-bg px-3 text-sm text-ink";

function invalidLabel(metrics: Record<string, number>) {
  const n = metrics.invalid_clicks || 0;
  const rate = metrics.invalid_click_rate || 0;
  const pct1 = `${(rate * 100).toLocaleString("vi-VN", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })}%`;
  return `${num(n, 0)} · ${pct1}`;
}

function formatRangeShort(start: string, end: string) {
  const a = start.split("-");
  const b = end.split("-");
  if (a.length !== 3 || b.length !== 3) return `${start} → ${end}`;
  return `${a[2]}/${a[1]}–${b[2]}/${b[1]}`;
}

export function AnalyticsView({ snap }: { snap: AnalyticsSnap }) {
  const range0 = defaultRange(snap);
  const warehouseEnd = snap.warehouse_end || snap.data_through;
  const [draftStart, setDraftStart] = useState(range0.start);
  const [draftEnd, setDraftEnd] = useState(range0.end);
  const [start, setStart] = useState(range0.start);
  const [end, setEnd] = useState(range0.end);
  const [layer, setLayer] = useState<LayerId>("campaign");
  const [periodLayer, setPeriodLayer] = useState<"account" | "campaign">("campaign");
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [adGroupId, setAdGroupId] = useState<string | null>(null);
  const [onlyConv, setOnlyConv] = useState(false);
  const [weekN, setWeekN] = useState(0);
  const [monthN, setMonthN] = useState(0);
  const [prevEqual, setPrevEqual] = useState(true);

  const groups = snap.conversion_groups.groups;

  function applyRange(nextStart: string, nextEnd: string) {
    setDraftStart(nextStart);
    setDraftEnd(nextEnd);
    setStart(nextStart);
    setEnd(nextEnd);
    setWeekN(0);
    setMonthN(0);
  }

  function presetDays(n: number) {
    applyRange(addDays(warehouseEnd, -(n - 1)), warehouseEnd);
    setWeekN(0);
    setMonthN(0);
  }

  const daySpan =
    Math.round(
      (new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 86400000,
    ) + 1;
  const presetDay = daySpan === 7 || daySpan === 14 || daySpan === 30 ? daySpan : 0;

  const account = useMemo(
    () => layerRows(snap, { layer: "account", start, end }),
    [snap, start, end],
  );
  const current = useMemo(
    () =>
      layerRows(snap, {
        layer,
        start,
        end,
        campaignId,
        adGroupId,
        onlyWithConv: onlyConv,
      }),
    [snap, layer, start, end, campaignId, adGroupId, onlyConv],
  );

  const prevRange = prevEqual ? previousEqualRange(start, end) : null;
  const prevAccount = useMemo(
    () => (prevRange ? layerRows(snap, { layer: "account", start: prevRange.start, end: prevRange.end }) : null),
    [snap, prevRange?.start, prevRange?.end],
  );

  const weeks = weekN ? previousWeeks(end, weekN) : [];
  const prevMonths = monthN ? previousMonths(end, monthN) : [];
  const inMonths = monthsOverlapping(start, end);
  const dates = warehouseDates(snap);

  const sideBySide =
    weeks.length > 0
      ? weeks.map((w, i) => ({
          id: `w${i}`,
          label: formatRangeShort(w.start, w.end),
          sub: "T2–CN",
          start: w.start,
          end: w.end,
          complete: windowCoverage(dates, w.start, w.end).complete,
        }))
      : monthN > 0
        ? prevMonths.map((m, i) => ({
            id: `pm${i}`,
            label: m.label,
            sub: formatRangeShort(m.start, m.end),
            start: m.start,
            end: m.end,
            complete: windowCoverage(dates, m.start, m.end).complete,
          }))
        : inMonths.length >= 2
          ? inMonths.map((m, i) => ({
              id: `im${i}`,
              label: m.label,
              sub: formatRangeShort(m.start, m.end),
              start: m.start,
              end: m.end,
              complete: windowCoverage(dates, m.calendar_start, m.calendar_end).complete,
            }))
          : [];

  const sideBlocks = sideBySide.map((col) => {
    const block = layerRows(snap, { layer: periodLayer, start: col.start, end: col.end });
    return { ...block, complete: col.complete };
  });
  const sideAccountBlocks =
    periodLayer === "account"
      ? sideBlocks
      : sideBySide.map((col) => {
          const block = layerRows(snap, { layer: "account", start: col.start, end: col.end });
          return { ...block, complete: col.complete };
        });

  const accountRow = account.rows[0];
  const metrics = accountRow?.metrics || {};
  const prevMetrics = prevAccount?.rows[0]?.metrics;
  const campaignName = snap.campaigns.find((c) => c.id === campaignId)?.name;
  const adGroupName = snap.ad_groups?.find((g) => g.id === adGroupId)?.name;
  const canDrill = layer === "campaign" || layer === "ad_group";

  function drill(row: LayerRow) {
    if (layer === "campaign") {
      setCampaignId(row.id);
      setAdGroupId(null);
      setLayer(row.pmax ? "search_term" : "ad_group");
    } else if (layer === "ad_group") {
      setAdGroupId(row.id);
      setLayer("keyword");
    }
  }

  function goLayer(next: LayerId) {
    setLayer(next);
    if (next === "campaign") {
      setCampaignId(null);
      setAdGroupId(null);
    }
  }

  const missing =
    !account.complete ||
    sideBlocks.some((block) => !block.complete) ||
    Boolean(prevAccount && !prevAccount.complete);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {snap.budget_pace && <BudgetBanner pace={snap.budget_pace} currency={snap.currency} />}

      <section className="rounded-xl bg-paper p-4 shadow-sheet md:p-5">
        <p className="text-xs font-medium tracking-wide text-subtle">
          Phân tích · máy tính trước · không apply
        </p>
        <h2 className="mt-1 font-display text-xl font-medium tracking-tight text-pretty">
          Lọc ngày → tài khoản / chiến dịch / nhóm / từ khoá → loại conv → ST/KW
        </h2>
        <p className="mt-1 max-w-3xl text-pretty text-sm text-muted">
          Cột Gọi / Zalo / Facebook chat / Form map từ action của khách đang xem — không hard-code
          tên khách. Secondary (page view) không lên màn. CPA Google ≠ Qualified Lead. Bìa 5 KPI
          Daily/Weekly giữ nguyên ở Báo cáo.
        </p>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {[7, 14, 30].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => presetDays(n)}
              className={cn(
                "h-11 rounded-full px-3.5 text-sm font-medium transition-colors duration-150",
                presetDay === n && weekN === 0 && monthN === 0
                  ? "bg-accent text-accent-fg"
                  : "bg-inset text-ink hover:bg-line",
              )}
            >
              {n} ngày
            </button>
          ))}
          {snap.week_choices.map((n) => (
            <button
              key={`w${n}`}
              type="button"
              onClick={() => {
                setWeekN(n);
                setMonthN(0);
              }}
              className={cn(
                "h-11 rounded-full px-3.5 text-sm font-medium transition-colors duration-150",
                weekN === n ? "bg-accent text-accent-fg" : "bg-inset text-ink hover:bg-line",
              )}
            >
              {n} tuần (T2–CN)
            </button>
          ))}
          <label
            className={cn(
              "inline-flex h-11 items-center gap-2 rounded-full px-3.5 text-sm font-medium",
              monthN > 0 ? "bg-accent text-accent-fg" : "bg-inset",
            )}
          >
            Tháng
            <select
              value={monthN}
              onChange={(e) => {
                setMonthN(Number(e.target.value));
                setWeekN(0);
              }}
              className="h-8 bg-transparent text-sm"
            >
              <option value={0}>—</option>
              {(snap.month_choices.length ? snap.month_choices : [1, 2, 3, 4, 5, 6, 7, 8, 9]).map(
                (n) => (
                  <option key={n} value={n}>
                    {n} tháng trước
                  </option>
                ),
              )}
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
          <Field label="Từ">
            <input
              type="date"
              value={draftStart}
              onChange={(e) => setDraftStart(e.target.value)}
              className={controlClass}
            />
          </Field>
          <Field label="Đến">
            <input
              type="date"
              value={draftEnd}
              onChange={(e) => setDraftEnd(e.target.value)}
              className={controlClass}
            />
          </Field>
          <label className="flex h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={prevEqual}
              onChange={(e) => setPrevEqual(e.target.checked)}
              className="size-4 accent-accent"
            />
            So kỳ trước cùng độ dài
          </label>
          <button
            type="button"
            onClick={() => applyRange(draftStart, draftEnd)}
            className="h-11 rounded-full bg-accent px-4 text-sm font-medium text-accent-fg"
          >
            Kéo số phân tích
          </button>
        </div>
        <p className="mt-3 text-xs text-muted">
          Số {start} → {end} · timezone {snap.timezone} · kho tối đa{" "}
          {snap.analytics_lookback_days || 270} ngày
          {snap.warehouse_start ? ` (${snap.warehouse_start} → ${warehouseEnd})` : ""}.
          {prevRange ? ` So ${prevRange.start} → ${prevRange.end}.` : ""} Không apply. CPA Google ≠
          Qualified Lead.
        </p>
      </section>

      {missing ? (
        <section className="rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn shadow-sheet">
          <p className="font-medium">Thiếu dữ liệu</p>
          <p className="mt-0.5">
            {account.missing_label || "Thiếu dữ liệu"} — mốc chưa đủ ngày; API không trả hết cửa sổ.
            Không đoán số.
          </p>
        </section>
      ) : null}

      {sideBySide.length > 0 ? (
        <PeriodTable
          title={weeks.length ? "Từng tuần cạnh nhau" : "Từng tháng cạnh nhau"}
          cols={sideBySide}
          blocks={sideBlocks}
          accountBlocks={sideAccountBlocks}
          groups={groups}
          layer={periodLayer}
          onLayerChange={setPeriodLayer}
          onPickCampaign={(id) => {
            setCampaignId(id);
            setAdGroupId(null);
            setLayer("ad_group");
          }}
        />
      ) : null}

      <section className="rounded-xl bg-paper p-4 shadow-sheet md:p-5">
        <h3 className="font-display text-lg font-medium tracking-tight">Tài khoản</h3>
        {account.rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Thiếu dữ liệu — không đoán số.</p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              <Kpi label="Chi tiêu" value={dong(metrics.cost || 0)} />
              <Kpi label="Hiển thị" value={num(metrics.impressions || 0)} />
              <Kpi label="Click" value={num(metrics.clicks || 0)} />
              <Kpi label="Click không hợp lệ" value={invalidLabel(metrics)} />
              <Kpi label="CTR" value={pct(metrics.ctr || 0)} />
              <Kpi label="CPC (mọi click)" value={dong(metrics.cpc || 0)} />
              <Kpi label="Chuyển đổi (primary)" value={convNum(metrics.conversions || 0)} />
              <Kpi label="Platform CPL" value={dong(metrics.cost_per_conversion || 0)} />
            </div>
            {prevEqual && prevRange ? (
              <p className="mt-3 text-xs text-muted">
                Vs kỳ trước ({formatRangeVi(prevRange.start, prevRange.end)}
                {prevAccount && !prevAccount.complete ? " · thiếu dữ liệu" : ""}):{" "}
                {prevAccount && prevAccount.complete && prevMetrics
                  ? `chi tiêu ${deltaWord(metrics.cost, prevMetrics.cost)} · click ${deltaWord(metrics.clicks, prevMetrics.clicks)} · conv ${deltaWord(metrics.conversions, prevMetrics.conversions)} · click lệch ${deltaWord(metrics.invalid_clicks, prevMetrics.invalid_clicks)}`
                  : "chi tiêu — · click — · conv — · click lệch —"}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {groups.map((g) => (
                <span
                  key={g.id}
                  className="inline-flex h-10 items-center rounded-full bg-inset px-3 text-sm"
                >
                  {g.label}: {convNum(Number(metrics[g.metric] || 0))}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs text-subtle">
              Chuyển đổi Google ≠ Qualified Lead. All conversions không gộp vào đây. CPC / CTR / CR /
              chi phí/chuyển đổi trên mọi click. Conv = 0 → chi/conv = 0.
            </p>
          </>
        )}
      </section>

      <section className="rounded-xl bg-paper p-4 shadow-sheet md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h3 className="font-display text-lg font-medium tracking-tight">
            {layer === "campaign"
              ? "Chiến dịch"
              : layer === "ad_group"
                ? "Nhóm quảng cáo"
                : layer === "keyword"
                  ? "Từ khoá"
                  : "Search terms"}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {LAYERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => goLayer(item.id)}
                className={cn(
                  "h-11 rounded-full px-3.5 text-sm font-medium transition-colors duration-150",
                  layer === item.id ? "bg-accent text-accent-fg" : "bg-inset text-ink hover:bg-line",
                )}
              >
                {item.label}
              </button>
            ))}
            <label className="flex h-11 items-center gap-2 rounded-full bg-inset px-3 text-sm">
              <input
                type="checkbox"
                checked={onlyConv}
                onChange={(e) => setOnlyConv(e.target.checked)}
                className="size-4 accent-accent"
              />
              Chỉ có conv
            </label>
          </div>
        </div>
        <nav className="mt-3 flex flex-wrap items-center gap-1.5 text-sm text-muted">
          <button type="button" className="hover:text-ink hover:underline" onClick={() => goLayer("campaign")}>
            {snap.display_name}
          </button>
          {campaignName ? (
            <>
              <ChevronRight className="size-3.5" />
              <button
                type="button"
                className="hover:text-ink hover:underline"
                onClick={() => {
                  setLayer("ad_group");
                  setAdGroupId(null);
                }}
              >
                {campaignName}
              </button>
            </>
          ) : null}
          {adGroupName ? (
            <>
              <ChevronRight className="size-3.5" />
              <span className="text-ink">{adGroupName}</span>
            </>
          ) : null}
        </nav>
        <div className="mt-4">
          <WorkTable
            snap={snap}
            layer={layer}
            block={current}
            groups={groups}
            canDrill={canDrill}
            onDrill={drill}
          />
        </div>
      </section>
    </div>
  );
}

function deltaWord(now: number | undefined, prev: number | undefined) {
  if (prev == null || now == null) return "—";
  if (prev === 0 && now === 0) return "—";
  if (prev === 0) return "tăng";
  const d = (now - prev) / Math.abs(prev);
  if (Math.abs(d) < 0.005) return "—";
  return d > 0 ? "tăng" : "giảm";
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-inset px-3 py-3">
      <p className="text-xs font-medium tracking-wide text-subtle">{label}</p>
      <p className="mt-1 font-display text-lg font-medium tracking-tight tabular-nums">{value}</p>
    </div>
  );
}

const PERIOD_KPIS = [
  { id: "cost", label: "Chi tiêu", fmt: (m: Record<string, number>) => dong(m.cost || 0) },
  { id: "clicks", label: "Click", fmt: (m: Record<string, number>) => num(m.clicks || 0) },
  { id: "conversions", label: "Conv", fmt: (m: Record<string, number>) => convNum(m.conversions || 0) },
  {
    id: "cost_per_conversion",
    label: "CPL",
    fmt: (m: Record<string, number>) => dong(m.cost_per_conversion || 0),
  },
] as const;

type PeriodKpi = (typeof PERIOD_KPIS)[number]["id"];

function metricDefs(groups: { id: string; label: string; metric: string }[]) {
  return [
    { label: "Chi tiêu", cell: (m: Record<string, number>) => dong(m.cost || 0), strong: true },
    { label: "Click", cell: (m: Record<string, number>) => num(m.clicks || 0) },
    { label: "Click lệch", cell: (m: Record<string, number>) => invalidLabel(m) },
    { label: "Conv", cell: (m: Record<string, number>) => convNum(m.conversions || 0) },
    { label: "CPC", cell: (m: Record<string, number>) => dong(m.cpc || 0) },
    { label: "CPL", cell: (m: Record<string, number>) => dong(m.cost_per_conversion || 0) },
    ...groups.map((g) => ({
      label: g.label,
      cell: (m: Record<string, number>) => convNum(Number(m[g.metric] || 0)),
      strong: false,
    })),
  ];
}

function entityUnion(blocks: LayerBlock[]) {
  const map = new Map<
    string,
    { id: string; name: string; cost: number; status?: string; pmax?: boolean }
  >();
  for (const block of blocks) {
    for (const row of block.rows) {
      const prev = map.get(row.id);
      map.set(row.id, {
        id: row.id,
        name: row.name,
        status: row.status,
        pmax: row.pmax,
        cost: (prev?.cost || 0) + (row.metrics.cost || 0),
      });
    }
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost);
}

function PeriodTable({
  title,
  cols,
  blocks,
  accountBlocks,
  groups,
  layer,
  onLayerChange,
  onPickCampaign,
}: {
  title: string;
  cols: { id: string; label: string; sub: string }[];
  blocks: LayerBlock[];
  accountBlocks: LayerBlock[];
  groups: { id: string; label: string; metric: string }[];
  layer: "account" | "campaign";
  onLayerChange: (next: "account" | "campaign") => void;
  onPickCampaign: (id: string) => void;
}) {
  const [kpi, setKpi] = useState<PeriodKpi>("cost");
  const rows = metricDefs(groups);
  const campaigns = layer === "campaign" ? entityUnion(blocks) : [];
  const colCount = cols.length + 1;
  const kpiMeta = PERIOD_KPIS.find((item) => item.id === kpi) || PERIOD_KPIS[0];

  return (
    <section id="analytics-period" className="rounded-xl bg-paper p-4 shadow-sheet md:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="font-display text-lg font-medium tracking-tight">{title}</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {layer === "campaign"
              ? "Tầng chiến dịch — mỗi khối một chiến dịch, cột là tháng. Dòng cuối = tổng tài khoản. Bấm tên chiến dịch để xuống nhóm."
              : "Tầng tài khoản — tổng mọi chiến dịch. Đổi sang Chiến dịch để so từng chiến dịch cạnh nhau."}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: "account", label: "Tài khoản" },
              { id: "campaign", label: "Chiến dịch" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onLayerChange(item.id)}
              className={cn(
                "h-11 rounded-full px-3.5 text-sm font-medium transition-colors duration-150",
                layer === item.id ? "bg-accent text-accent-fg" : "bg-inset text-ink hover:bg-line",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {layer === "campaign" ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="pr-1 text-xs font-medium text-muted">Chỉ số</span>
          {PERIOD_KPIS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setKpi(item.id)}
              className={cn(
                "h-11 rounded-full px-3.5 text-sm font-medium transition-colors duration-150",
                kpi === item.id ? "bg-accent text-accent-fg" : "bg-inset text-ink hover:bg-line",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="mt-3 -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        {layer === "campaign" && campaigns.length > 0 ? (
          <table id="analytics-campaign-matrix" className="mb-5 min-w-full border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 bg-paper pb-2 pr-4 text-xs font-medium text-muted">
                  {kpiMeta.label} theo chiến dịch
                </th>
                {cols.map((col, i) => (
                  <th key={`sum-${col.id}`} className="pb-2 pr-4 text-right text-xs font-medium">
                    <span className="text-ink">{col.label}</span>
                    {!blocks[i]?.complete ? (
                      <span className="mt-0.5 block font-medium text-warn">Thiếu dữ liệu</span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.map((camp) => (
                <tr key={`sum-${camp.id}`} className="border-t border-line">
                  <td className="sticky left-0 bg-paper py-1 pr-4">
                    <button
                      type="button"
                      onClick={() => onPickCampaign(camp.id)}
                      className="flex min-h-11 w-full items-center text-left font-medium"
                    >
                      {camp.name}
                    </button>
                  </td>
                  {cols.map((col, i) => {
                    const m = blocks[i]?.rows.find((r) => r.id === camp.id)?.metrics;
                    return (
                      <td key={col.id} className="py-2.5 pr-4 text-right tabular-nums">
                        {m ? kpiMeta.fmt(m) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t border-line-strong">
                <td className="sticky left-0 bg-paper py-2.5 pr-4 font-medium">Tài khoản</td>
                {cols.map((col, i) => {
                  const m = accountBlocks[i]?.rows[0]?.metrics;
                  return (
                    <td key={col.id} className="py-2.5 pr-4 text-right font-medium tabular-nums">
                      {m ? kpiMeta.fmt(m) : "—"}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        ) : null}
        {layer === "campaign" && campaigns.length > 0 ? (
          <p className="mb-2 text-xs font-medium tracking-wide text-subtle">Đủ chỉ số từng chiến dịch</p>
        ) : null}
        <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 bg-paper pb-2 pr-4 text-xs font-medium text-muted">
                {layer === "campaign" ? "Chiến dịch / chỉ số" : "Chỉ số"}
              </th>
              {cols.map((col, i) => (
                <th key={col.id} className="pb-2 pr-4 text-right text-xs font-medium">
                  <span className="text-ink">{col.label}</span>
                  <span className="mt-0.5 block font-normal text-subtle">{col.sub}</span>
                  {!blocks[i]?.complete ? (
                    <span className="mt-0.5 block font-medium text-warn">Thiếu dữ liệu</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          {layer === "account" ? (
            <tbody>
              {rows.map((row) => (
                <MetricRow key={row.label} row={row} cols={cols} pick={(i) => blocks[i]?.rows[0]?.metrics} />
              ))}
            </tbody>
          ) : (
            <>
              {campaigns.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={colCount} className="py-6 text-sm text-muted">
                      Không có chiến dịch có số trong các kỳ này. Không đoán số.
                    </td>
                  </tr>
                </tbody>
              ) : (
                campaigns.map((camp) => (
                  <tbody key={camp.id} className="border-t border-line">
                    <tr className="border-t border-line">
                      <td className="sticky left-0 bg-inset py-1 pr-4">
                        <button
                          type="button"
                          onClick={() => onPickCampaign(camp.id)}
                          className="flex min-h-11 w-full items-center gap-2 text-left font-medium text-ink"
                        >
                          <span>{camp.name}</span>
                          {camp.pmax ? (
                            <span className="rounded-full bg-paper px-2 py-0.5 text-xs font-medium text-muted">
                              PMax
                            </span>
                          ) : null}
                        </button>
                      </td>
                      {cols.map((col) => (
                        <td key={col.id} className="bg-inset py-1 pr-4" />
                      ))}
                    </tr>
                    {rows.map((row) => (
                      <MetricRow
                        key={`${camp.id}-${row.label}`}
                        row={row}
                        cols={cols}
                        indent
                        pick={(i) => blocks[i]?.rows.find((r) => r.id === camp.id)?.metrics}
                      />
                    ))}
                  </tbody>
                ))
              )}
              <tbody>
                <tr>
                  <td className="sticky left-0 bg-paper pt-3 pr-4 font-medium">Tài khoản (tổng)</td>
                  {cols.map((col) => (
                    <td key={col.id} className="pt-3 pr-4" />
                  ))}
                </tr>
                {rows.map((row) => (
                  <MetricRow
                    key={`acct-${row.label}`}
                    row={row}
                    cols={cols}
                    indent
                    pick={(i) => accountBlocks[i]?.rows[0]?.metrics}
                  />
                ))}
              </tbody>
            </>
          )}
        </table>
      </div>
    </section>
  );
}

function MetricRow({
  row,
  cols,
  pick,
  indent,
}: {
  row: { label: string; cell: (m: Record<string, number>) => string; strong?: boolean };
  cols: { id: string }[];
  pick: (index: number) => Record<string, number> | undefined;
  indent?: boolean;
}) {
  return (
    <tr className="border-t border-line">
      <td
        className={cn(
          "sticky left-0 bg-paper py-2.5 pr-4",
          indent ? "pl-4 text-muted" : "text-muted",
          row.strong && "font-medium text-ink",
        )}
      >
        {row.label}
      </td>
      {cols.map((col, i) => {
        const m = pick(i);
        return (
          <td
            key={col.id}
            className={cn("py-2.5 pr-4 text-right tabular-nums", row.strong && "font-medium")}
          >
            {m ? row.cell(m) : "—"}
          </td>
        );
      })}
    </tr>
  );
}

function WorkTable({
  snap,
  layer,
  block,
  groups,
  canDrill,
  onDrill,
}: {
  snap: AnalyticsSnap;
  layer: string;
  block: LayerBlock;
  groups: { id: string; label: string; metric: string }[];
  canDrill: boolean;
  onDrill: (row: LayerRow) => void;
}) {
  if (block.pmax_note && block.rows.length === 0) {
    return (
      <p className="rounded-md bg-inset px-4 py-6 text-sm text-muted">
        PMax: {block.pmax_note || "không có search term / keyword chuẩn"}
      </p>
    );
  }
  if (block.rows.length === 0) {
    return (
      <p className="rounded-md bg-inset px-4 py-6 text-sm text-muted">
        {block.complete
          ? "Không có dòng trong cửa sổ ngày."
          : "Thiếu dữ liệu — mốc chưa đủ ngày; API không trả hết cửa sổ. Không đoán số."}
      </p>
    );
  }
  const showMatch = layer === "keyword" || layer === "search_term";
  return (
    <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
        <thead>
          <tr className="text-xs font-medium text-muted">
            <th className="sticky left-0 bg-paper pb-2 pr-4">Dòng</th>
            <th className="pb-2 pr-4">Trạng thái</th>
            {showMatch ? <th className="pb-2 pr-4">Khớp</th> : null}
            <th className="pb-2 pr-4 text-right">Chi tiêu</th>
            <th className="pb-2 pr-4 text-right">Click</th>
            <th className="pb-2 pr-4 text-right">Click lệch</th>
            <th className="pb-2 pr-4 text-right">Conv</th>
            <th className="pb-2 pr-4 text-right">CPC</th>
            <th className="pb-2 pr-4 text-right">CPL</th>
            {groups.map((g) => (
              <th key={g.id} className="pb-2 pr-4 text-right">
                {g.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr
              key={row.id}
              className={cn("border-t border-line", canDrill && "cursor-pointer hover:bg-inset/60")}
              onClick={() => canDrill && onDrill(row)}
            >
              <td className="sticky left-0 bg-paper py-2.5 pr-4 font-medium">
                {row.name}
                {row.pmax ? (
                  <span className="ml-2 rounded-full bg-inset px-2 py-0.5 text-xs font-medium text-muted">
                    PMax
                  </span>
                ) : null}
              </td>
              <td className="py-2.5 pr-4">
                <StatusPill status={row.status} />
              </td>
              {showMatch ? (
                <td className="py-2.5 pr-4 text-muted">{row.match_type_label || row.match_type || "—"}</td>
              ) : null}
              <td className="py-2.5 pr-4 text-right tabular-nums">{dong(row.metrics.cost || 0)}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{num(row.metrics.clicks || 0)}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{invalidLabel(row.metrics)}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{convNum(row.metrics.conversions || 0)}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{dong(row.metrics.cpc || 0)}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">
                {dong(row.metrics.cost_per_conversion || 0)}
              </td>
              {groups.map((g) => (
                <td key={g.id} className="py-2.5 pr-4 text-right tabular-nums">
                  {convNum(Number(row.metrics[g.metric] || 0))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {canDrill ? (
        <p className="mt-2 text-xs text-subtle">
          Bấm dòng để xuống tầng dưới. Campaign tạm dừng / kết thúc vẫn hiện nếu có số trong kỳ. PMax:
          một dòng, không bịa nhóm Search.
        </p>
      ) : null}
    </div>
  );
}

function StatusPill({ status }: { status?: string }) {
  const label = statusVi(status);
  const code = String(status || "").toUpperCase();
  const live = code === "ENABLED" || code === "ACTIVE";
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        live ? "bg-ok-bg text-ok" : "bg-inset text-muted",
      )}
    >
      {label}
    </span>
  );
}
