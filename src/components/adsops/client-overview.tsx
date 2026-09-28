import { useMemo, useState, type ReactNode } from "react";
import { Info, X } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyticsSnap } from "@/lib/adsops/analytics";
import { metricText, statusText, t, type Lang, type MetricId } from "@/lib/adsops/client-i18n";
import {
  buildOverview,
  commentary,
  fmtDay,
  fmtMoney,
  fmtMoneyShort,
  fmtNum,
  fmtPct,
  fmtRange,
  lastDataDay,
  presetRange,
  type DayPoint,
  type PresetId,
} from "@/lib/adsops/client-overview";
import { cn } from "@/lib/cn";

const PRESETS: { id: PresetId; key: Parameters<typeof t>[1] }[] = [
  { id: "7", key: "preset_7" },
  { id: "14", key: "preset_14" },
  { id: "30", key: "preset_30" },
  { id: "this_month", key: "preset_this_month" },
  { id: "last_month", key: "preset_last_month" },
  { id: "all", key: "preset_all" },
];

const CONV_COLORS: Record<string, string> = {
  conv_call: "#21545c",
  conv_zalo: "#2f7fbf",
  conv_form: "#b7791f",
  conv_facebook_chat: "#6b46c1",
  conv_other: "#8a8278",
};

type TrendMetric = "cost" | "clicks" | "impressions" | "conversions" | "ctr" | "cpc" | "cost_per_conversion";
const TREND_METRICS: TrendMetric[] = ["cost", "clicks", "conversions", "impressions", "ctr", "cpc", "cost_per_conversion"];

/** Info icon: tap/click toggles a plain-language explanation (works on touch). */
export function InfoTip({ lang, id, className }: { lang: Lang; id: MetricId; className?: string }) {
  const [open, setOpen] = useState(false);
  const m = metricText(lang, id);
  return (
    <span className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-label={`${t(lang, "info")}: ${m.label}`}
        aria-expanded={open}
        title={m.help}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex size-6 items-center justify-center rounded-full text-subtle hover:bg-inset hover:text-ink"
      >
        <Info className="size-3.5" />
      </button>
      {open ? (
        <span
          role="tooltip"
          className="fixed inset-x-3 bottom-3 z-50 rounded-md border border-line bg-paper p-4 text-left text-sm font-normal normal-case leading-relaxed tracking-normal text-ink shadow-sheet sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-7 sm:w-72 sm:-translate-x-1/2 sm:p-3 sm:text-xs"
        >
          <span className="mb-1 flex items-start justify-between gap-2">
            <b className="text-sm font-semibold">{m.label}</b>
            <button
              type="button"
              aria-label="close"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
              className="-mr-1 -mt-1 rounded p-1 text-subtle hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          </span>
          {m.help}
        </span>
      ) : null}
    </span>
  );
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-xl bg-paper p-4 shadow-sheet md:p-5", className)}>{children}</section>;
}

function Kpi({
  lang,
  id,
  value,
  sub,
  strong,
  label,
}: {
  lang: Lang;
  id: MetricId;
  value: string;
  sub?: string;
  strong?: boolean;
  label?: string;
}) {
  return (
    <div className={cn("rounded-lg px-3 py-3 md:px-4", strong ? "bg-accent text-accent-fg" : "bg-bg")}>
      <div className={cn("flex items-center gap-0.5 text-xs font-medium", strong ? "text-accent-fg/80" : "text-muted")}>
        <span className="truncate">{label || metricText(lang, id).label}</span>
        <InfoTip lang={lang} id={id} className={strong ? "[&>button]:text-accent-fg/80 [&>button:hover]:bg-white/10" : ""} />
      </div>
      <p className="mt-0.5 font-display text-[1.3rem] font-medium leading-tight tabular-nums tracking-tight [overflow-wrap:anywhere] sm:text-2xl md:text-[1.7rem]">
        {value}
      </p>
      {sub ? <p className={cn("text-xs", strong ? "text-accent-fg/80" : "text-subtle")}>{sub}</p> : null}
    </div>
  );
}

function trendValue(lang: Lang, m: TrendMetric, v: number | null, currency: string) {
  if (m === "cost" || m === "cpc" || m === "cost_per_conversion") return fmtMoney(lang, v, currency);
  if (m === "ctr") return fmtPct(lang, v);
  return fmtNum(lang, v);
}

function shortDay(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

export function ClientOverview({
  snap,
  lang,
  freshness,
}: {
  snap: AnalyticsSnap;
  lang: Lang;
  /** Pre-formatted "Số liệu Google Ads cập nhật đến HH:mm…" line (or ""). */
  freshness: string;
}) {
  const currency = snap.currency || "VND";
  const end0 = lastDataDay(snap);
  const init = presetRange(snap, "30") || { start: end0, end: end0 };
  const [preset, setPreset] = useState<PresetId>("30");
  const [range, setRange] = useState(init);
  const [draft, setDraft] = useState(init);
  const [metric, setMetric] = useState<TrendMetric>("cost");

  const ov = useMemo(() => buildOverview(snap, range.start, range.end), [snap, range.start, range.end]);
  const lines = useMemo(() => commentary(lang, ov, currency), [lang, ov, currency]);
  const tt = ov.totals;
  const rangeText = fmtRange(range.start, range.end);
  const haveText =
    snap.warehouse_start && end0 ? fmtRange(snap.warehouse_start, end0) : end0 ? fmtDay(end0) : "—";

  function pick(id: PresetId) {
    setPreset(id);
    const r = presetRange(snap, id);
    if (r) {
      setRange(r);
      setDraft(r);
    }
  }

  const convTypes = (["conv_call", "conv_zalo", "conv_form", "conv_facebook_chat", "conv_other"] as const).filter(
    (k) => k === "conv_call" || k === "conv_zalo" || k === "conv_form" || tt[k] > 0,
  );

  const chartData = ov.series.map((d: DayPoint) => ({ ...d, label: shortDay(d.date) }));
  const noAccountData = !(snap.daily?.account || []).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Date range */}
      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-widest text-subtle">{t(lang, "range")}</p>
            <p className="text-sm text-muted">
              {t(lang, "showing")}: <b className="font-semibold text-ink tabular-nums">{rangeText}</b>
              {ov.hasData ? (
                <span className="text-subtle">
                  {" "}
                  · {ov.daysWithData}/{ov.dayCount} {t(lang, "days_with_data")}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => pick(p.id)}
                className={cn(
                  "h-10 shrink-0 rounded-full px-3.5 text-sm font-medium transition-colors",
                  preset === p.id ? "bg-accent text-accent-fg" : "bg-inset text-ink hover:bg-line",
                )}
              >
                {t(lang, p.key)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPreset("custom")}
              className={cn(
                "h-10 shrink-0 rounded-full px-3.5 text-sm font-medium transition-colors",
                preset === "custom" ? "bg-accent text-accent-fg" : "bg-inset text-ink hover:bg-line",
              )}
            >
              {t(lang, "preset_custom")}
            </button>
          </div>
          {preset === "custom" ? (
            <form
              className="grid grid-cols-2 gap-2 sm:flex sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.start && draft.end && draft.start <= draft.end) setRange({ ...draft });
              }}
            >
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                {t(lang, "from")}
                <input
                  type="date"
                  value={draft.start}
                  max={draft.end || undefined}
                  onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))}
                  className="h-11 rounded-md border border-line bg-bg px-3 text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                {t(lang, "to")}
                <input
                  type="date"
                  value={draft.end}
                  min={draft.start || undefined}
                  onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))}
                  className="h-11 rounded-md border border-line bg-bg px-3 text-sm text-ink"
                />
              </label>
              <button
                type="submit"
                className="col-span-2 h-11 rounded-full bg-accent px-5 text-sm font-medium text-accent-fg sm:col-span-1"
              >
                {t(lang, "apply")}
              </button>
            </form>
          ) : null}
          {freshness ? <p className="text-xs font-medium text-muted">{freshness}</p> : null}
        </div>
      </Card>

      {!ov.hasData ? (
        <Card className="py-10 text-center">
          <p className="mx-auto max-w-xl text-sm text-muted">
            {noAccountData
              ? t(lang, "empty_account", { range: rangeText })
              : t(lang, "empty_range", { range: rangeText, have: haveText })}
          </p>
        </Card>
      ) : (
        <>
          {/* KPIs */}
          <Card>
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-subtle">{t(lang, "kpis")}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              <Kpi lang={lang} id="cost" value={fmtMoney(lang, tt.cost, currency)} strong />
              <Kpi
                lang={lang}
                id="conversions"
                label={lang === "en" ? "Conversions" : "Chuyển đổi"}
                sub={lang === "en" ? "recorded by Google Ads" : "Google Ads ghi nhận"}
                value={fmtNum(lang, tt.conversions)}
                strong
              />
              <Kpi
                lang={lang}
                id="cost_per_conversion"
                value={tt.cost_per_conversion == null ? "—" : fmtMoney(lang, tt.cost_per_conversion, currency)}
              />
              <Kpi lang={lang} id="clicks" value={fmtNum(lang, tt.clicks)} />
              <Kpi lang={lang} id="impressions" value={fmtNum(lang, tt.impressions)} />
              <Kpi lang={lang} id="ctr" value={fmtPct(lang, tt.ctr)} />
              <Kpi lang={lang} id="cpc" value={fmtMoney(lang, tt.cpc, currency)} />
            </div>
            <div className="mt-4">
              <p className="mb-2 flex items-center gap-1 text-xs font-medium text-muted">{t(lang, "conv_split")}</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {convTypes.map((k) => {
                  const v = tt[k];
                  const share = tt.conversions > 0 ? v / tt.conversions : null;
                  return (
                    <div key={k} className="rounded-lg bg-bg px-3 py-2.5">
                      <div className="flex items-center gap-1 text-xs font-medium text-muted">
                        <span className="inline-block size-2 rounded-full" style={{ background: CONV_COLORS[k] }} />
                        <span className="truncate">{metricText(lang, k).label}</span>
                        <InfoTip lang={lang} id={k} />
                      </div>
                      <p className="font-display text-xl font-medium tabular-nums">{fmtNum(lang, v)}</p>
                      <p className="text-xs text-subtle tabular-nums">{share == null ? "—" : fmtPct(lang, share)}</p>
                    </div>
                  );
                })}
              </div>
              {tt.conversions > 0 ? (
                <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-inset">
                  {convTypes.map((k) =>
                    tt[k] > 0 ? (
                      <span key={k} style={{ width: `${(tt[k] / tt.conversions) * 100}%`, background: CONV_COLORS[k] }} />
                    ) : null,
                  )}
                </div>
              ) : null}
              <p className="mt-2 text-xs text-subtle">{t(lang, "conv_disclaimer")}</p>
            </div>
          </Card>

          {/* Commentary */}
          <Card>
            <p className="mb-2 text-xs font-medium uppercase tracking-widest text-subtle">{t(lang, "commentary")}</p>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-ink">
              {lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-subtle">{t(lang, "commentary_note")}</p>
          </Card>

          {/* Trend */}
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-widest text-subtle">{t(lang, "trend")}</p>
            </div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {TREND_METRICS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMetric(m)}
                  className={cn(
                    "h-9 shrink-0 rounded-full px-3 text-xs font-medium transition-colors",
                    metric === m ? "bg-ink text-paper" : "bg-inset text-ink hover:bg-line",
                  )}
                >
                  {metricText(lang, m).label}
                </button>
              ))}
            </div>
            <div className="h-56 md:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#d7d0c4" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b645b" }} tickLine={false} axisLine={false} minTickGap={18} />
                  <YAxis
                    width={56}
                    tick={{ fontSize: 11, fill: "#6b645b" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) =>
                      metric === "cost" || metric === "cpc" || metric === "cost_per_conversion"
                        ? fmtMoneyShort(lang, v, currency)
                        : metric === "ctr"
                          ? fmtPct(lang, v)
                          : fmtNum(lang, v)
                    }
                  />
                  <Tooltip
                    formatter={(v) => [trendValue(lang, metric, v == null ? null : Number(v), currency), metricText(lang, metric).label]}
                    labelFormatter={(_, p) => {
                      const d = p?.[0]?.payload as DayPoint | undefined;
                      return d ? fmtDay(d.date) : "";
                    }}
                    contentStyle={{ borderRadius: 12, border: "1px solid #d7d0c4", background: "#faf7f1", fontSize: 12 }}
                  />
                  {metric === "cost" || metric === "clicks" || metric === "impressions" || metric === "conversions" ? (
                    <Bar dataKey={metric} fill="#21545c" radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                  ) : (
                    <Line
                      dataKey={metric}
                      stroke="#21545c"
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {tt.conversions > 0 ? (
              <>
                <p className="mb-2 mt-5 text-xs font-medium text-muted">{t(lang, "trend_conv")}</p>
                <div className="h-44 md:h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke="#d7d0c4" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b645b" }} tickLine={false} axisLine={false} minTickGap={18} />
                      <YAxis width={56} allowDecimals={false} tick={{ fontSize: 11, fill: "#6b645b" }} tickLine={false} axisLine={false} />
                      <Tooltip
                        formatter={(v, name) => [fmtNum(lang, v == null ? null : Number(v)), metricText(lang, name as MetricId).label]}
                        labelFormatter={(_, p) => {
                          const d = p?.[0]?.payload as DayPoint | undefined;
                          return d ? fmtDay(d.date) : "";
                        }}
                        contentStyle={{ borderRadius: 12, border: "1px solid #d7d0c4", background: "#faf7f1", fontSize: 12 }}
                      />
                      {convTypes.map((k) => (
                        <Bar key={k} dataKey={k} stackId="c" fill={CONV_COLORS[k]} maxBarSize={28} isAnimationActive={false} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : null}
          </Card>

          {/* Campaigns */}
          <Card>
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-subtle">
              {t(lang, "campaigns")} · {ov.campaigns.length}
            </p>
            <ul className="divide-y divide-line">
              {ov.campaigns.map((c) => {
                const code = String(c.status).toUpperCase();
                return (
                  <li key={c.id} className="flex flex-col gap-1.5 py-3 md:flex-row md:items-center md:justify-between md:gap-4">
                    <div className="min-w-0">
                      <p className="font-medium text-ink [overflow-wrap:anywhere]">{c.name}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 font-medium",
                            code === "ENABLED" ? "bg-ok-bg text-ok" : code === "PAUSED" ? "bg-warn-bg text-warn" : "bg-inset text-muted",
                          )}
                        >
                          {statusText(lang, c.status)}
                        </span>
                        {c.type ? <span>{c.type === "PERFORMANCE_MAX" ? "Performance Max" : c.type.charAt(0) + c.type.slice(1).toLowerCase()}</span> : null}
                      </p>
                    </div>
                    {c.cost > 0 || c.clicks > 0 ? (
                      <dl className="grid grid-cols-4 gap-2 text-right text-xs tabular-nums md:w-[26rem] md:shrink-0">
                        <div>
                          <dt className="text-subtle">{metricText(lang, "cost").label}</dt>
                          <dd className="font-medium text-ink">{fmtMoneyShort(lang, c.cost, currency)}</dd>
                          <dd className="text-subtle">{fmtPct(lang, c.share)}</dd>
                        </div>
                        <div>
                          <dt className="text-subtle">{metricText(lang, "clicks").label}</dt>
                          <dd className="font-medium text-ink">{fmtNum(lang, c.clicks)}</dd>
                        </div>
                        <div>
                          <dt className="text-subtle">{lang === "en" ? "Conv." : "Chuyển đổi"}</dt>
                          <dd className="font-medium text-ink">{fmtNum(lang, c.conversions)}</dd>
                        </div>
                        <div>
                          <dt className="text-subtle">{lang === "en" ? "Cost/conv." : "CP/chuyển đổi"}</dt>
                          <dd className="font-medium text-ink">
                            {c.cost_per_conversion == null ? "—" : fmtMoneyShort(lang, c.cost_per_conversion, currency)}
                          </dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="text-xs text-subtle">{t(lang, "no_spend_in_range")}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
