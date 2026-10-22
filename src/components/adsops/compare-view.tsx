import { useCallback, useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  computeCompareFn, listCompareGroupsFn, readCompareFn, saveCompareGroupFn, suggestCompareGroupsFn,
  type CompareGroup, type ComparePeriod, type CompareRead, type GroupSuggestion, type MetricKey, type Metrics,
} from "@/lib/adsops/compare.functions";
import { METRICS, METRIC_LABEL, PERIOD_LABEL, LOWER_BETTER, tone } from "@/lib/adsops/compare.types";
import { CHANNEL_LABEL, type ChannelKey } from "@/lib/adsops/google-trend.types";
import { CONV_GROUPS, type ConvGroup } from "@/lib/adsops/google-conv-groups";
import { GoogleAdsLink } from "@/components/adsops/google-ads-link-ui";
import { cn } from "@/lib/cn";
import { Card, EmptyState, ErrorState, TableSkeleton } from "@/components/adsops/ui";

const CONV_SHORT: Record<ConvGroup, string> = { call: "Gọi", zalo: "Zalo", messenger: "Chat FB", form: "Form", purchase: "Mua hàng", other: "Khác" };
const COLORS = ["#0f766e", "#2563eb", "#d97706", "#db2777", "#7c3aed", "#059669", "#dc2626", "#0891b2", "#65a30d", "#9333ea"];
const KEY = "adsops.compare.prefs";
type Acc = { client_id: string; label: string; customer_id_dashed: string | null; platform: string };

function fmt(k: MetricKey, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "-";
  if (k === "spend" || k === "cpc" || k === "cpa") return `${Math.round(v).toLocaleString("vi-VN")}đ`;
  if (k === "cr") return `${(v * 100).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%`;
  return v.toLocaleString("vi-VN", { maximumFractionDigits: k === "conversions" ? 1 : 0 });
}
const mLabel = (m: string) => `T${Number(m.slice(5))}/${m.slice(2, 4)}`;
const pad = (n: number) => String(n).padStart(2, "0");
const ymdLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysBack = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return ymdLocal(d); };
const yesterday = () => daysBack(1);
const thisMonth = () => ymdLocal(new Date()).slice(0, 7);
const addMonths = (m: string, k: number) => { const [y, mo] = m.split("-").map(Number); const d = new Date(y, mo - 1 + k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const dmy = (s: string) => s.split("-").reverse().join("/");
const MAIN_PERIODS: ComparePeriod[] = ["this_month", "last_month", "last3"];
/** Period state lives in the URL: ?cmp_p=months&cmp_from=2026-07&cmp_to=2026-09 (or days with YYYY-MM-DD). */
function readUrlPeriod(): { p: ComparePeriod; from: string; to: string } | null {
  try {
    const u = new URL(window.location.href);
    const p = u.searchParams.get("cmp_p") as ComparePeriod | null;
    if (!p || !(p in PERIOD_LABEL)) return null;
    return { p, from: u.searchParams.get("cmp_from") || "", to: u.searchParams.get("cmp_to") || "" };
  } catch { return null; }
}
function writeUrlPeriod(p: ComparePeriod, from: string, to: string) {
  try {
    const u = new URL(window.location.href);
    u.searchParams.set("cmp_p", p);
    if (p === "months" || p === "days") { u.searchParams.set("cmp_from", from); u.searchParams.set("cmp_to", to); }
    else { u.searchParams.delete("cmp_from"); u.searchParams.delete("cmp_to"); }
    window.history.replaceState(window.history.state, "", u.toString());
  } catch { /* ignore */ }
}

/** Staff-only "So sánh tài khoản": accounts in a group side by side against the group median. Never shown to clients. */
export function CompareView({ onOpenAccount, isAdmin }: { onOpenAccount?: (clientId: string) => void; isAdmin?: boolean }) {
  const [groups, setGroups] = useState<CompareGroup[] | null>(null);
  const [accounts, setAccounts] = useState<Acc[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [canSave, setCanSave] = useState(false);
  const [viewAs, setViewAs] = useState(false);
  // "Tự chọn tài khoản": ad-hoc selection (any staff role; server limits it to the user's scope).
  const [mode, setMode] = useState<"group" | "custom">("group");
  const [picked, setPicked] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const prefsLoaded = useState(() => ({ had: false }))[0];
  const [err, setErr] = useState("");
  const [gid, setGid] = useState(0);
  const [period, setPeriod] = useState<ComparePeriod>("last_month");
  const [mFrom, setMFrom] = useState(() => addMonths(thisMonth(), -3));
  const [mTo, setMTo] = useState(() => addMonths(thisMonth(), -1));
  const [dFrom, setDFrom] = useState(() => daysBack(30));
  const [dTo, setDTo] = useState(() => yesterday());
  const [channels, setChannels] = useState<string[]>([]);
  const [convs, setConvs] = useState<ConvGroup[]>([]);
  const [data, setData] = useState<CompareRead | null>(null);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<{ k: MetricKey | "name"; dir: 1 | -1 }>({ k: "spend", dir: -1 });
  const [chart, setChart] = useState<MetricKey | null>(null);
  const [manage, setManage] = useState(false);
  const [msg, setMsg] = useState("");
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    try { const p = JSON.parse(sessionStorage.getItem(KEY) || "{}"); if (p.mode === "group" || p.mode === "custom") { setMode(p.mode); prefsLoaded.had = true; } if (Array.isArray(p.picked)) setPicked(p.picked.filter((x: unknown) => typeof x === "string").slice(0, 60)); if (p.gid) setGid(p.gid); if (p.period) setPeriod(p.period); if (Array.isArray(p.channels)) setChannels(p.channels); if (Array.isArray(p.convs)) setConvs(p.convs); } catch { /* ignore */ }
    const u = readUrlPeriod();
    if (u) {
      setPeriod(u.p);
      if (u.p === "months" && /^\d{4}-\d{2}$/.test(u.from) && /^\d{4}-\d{2}$/.test(u.to)) { setMFrom(u.from); setMTo(u.to); }
      if (u.p === "days" && /^\d{4}-\d{2}-\d{2}$/.test(u.from) && /^\d{4}-\d{2}-\d{2}$/.test(u.to)) { setDFrom(u.from); setDTo(u.to); }
    }
  }, []);
  const rangeFrom = period === "months" ? mFrom : period === "days" ? dFrom : "";
  const rangeTo = period === "months" ? mTo : period === "days" ? dTo : "";
  useEffect(() => { writeUrlPeriod(period, rangeFrom, rangeTo); }, [period, rangeFrom, rangeTo]);
  const rangeErr = period === "months"
    ? (mFrom > mTo ? "Tháng bắt đầu phải trước tháng kết thúc." : (Number(mTo.slice(0, 4)) - Number(mFrom.slice(0, 4))) * 12 + Number(mTo.slice(5)) - Number(mFrom.slice(5)) + 1 > 12 ? "Tối đa 12 tháng." : "")
    : period === "days"
      ? (dFrom > dTo ? "Ngày bắt đầu phải trước ngày kết thúc." : (Date.parse(dTo) - Date.parse(dFrom)) / 86_400_000 + 1 > 366 ? "Tối đa khoảng 1 năm (366 ngày)." : dTo > yesterday() ? "Ngày kết thúc tối đa là hôm qua." : "")
      : "";
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify({ gid, period, channels, convs, mode, picked })); } catch { /* ignore */ } }, [gid, period, channels, convs, mode, picked]);

  const loadGroups = useCallback(async () => {
    try {
      const r = await listCompareGroupsFn();
      setGroups(r.groups); setAccounts(r.accounts); setCanManage(r.can_manage); setCanSave(r.can_save_personal); setViewAs(r.view_as); setErr("");
      setGid((g) => (r.groups.some((x) => x.id === g) ? g : r.groups.find((x) => x.members.length)?.id || r.groups[0]?.id || 0));
      // No group (shared or mine) with any account this user can see → start in Tự chọn instead of an empty table.
      if (!prefsLoaded.had && !r.groups.some((x) => x.members.length)) setMode("custom");
      const vis = new Set(r.accounts.map((a) => a.client_id));
      setPicked((p) => p.filter((id) => vis.has(id)));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void loadGroups(); }, [loadGroups, epoch]);

  useEffect(() => {
    const custom = mode === "custom";
    if (custom ? !picked.length : !gid) { setData(null); return; }
    if (rangeErr) return;
    let live = true;
    setLoading(true);
    const pr = { period, from: rangeFrom, to: rangeTo, channels, convGroups: convs };
    readCompareFn({ data: custom ? { groupId: 0, ...pr, clientIds: picked } : { groupId: gid, ...pr } })
      .then((r) => { if (live) { setData(r); setErr(""); } })
      .catch((e: unknown) => { if (live) setErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [gid, period, rangeFrom, rangeTo, rangeErr, channels, convs, epoch, mode, picked]);

  const rows = useMemo(() => {
    const rs = [...(data?.rows || [])];
    rs.sort((a, b) => {
      if (sort.k === "name") return a.label.localeCompare(b.label, "vi") * sort.dir;
      const x = a.m[sort.k], y = b.m[sort.k];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x - y) * sort.dir;
    });
    return rs;
  }, [data, sort]);
  const clickHead = (k: MetricKey | "name") => {
    setSort((s) => (s.k === k ? { k, dir: (s.dir * -1) as 1 | -1 } : { k, dir: k === "name" ? 1 : LOWER_BETTER.has(k as MetricKey) ? 1 : -1 }));
    if (k !== "name") setChart(k as MetricKey);
  };
  const toggle = <T extends string>(list: T[], v: T, set: (x: T[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const group = groups?.find((g) => g.id === gid) || null;

  async function compute() {
    if (!gid) return;
    setMsg("Đang tính…");
    try {
      const r = await computeCompareFn({ data: { groupId: gid } });
      setMsg(`Đã tính ${r.done}/${r.total} tài khoản${r.failed ? `, lỗi ${r.failed}${r.errors.length ? `: ${r.errors.join("; ")}` : ""}` : ""}${r.remaining ? `, còn ${r.remaining} (bấm lại)` : ""}.`);
      setEpoch((n) => n + 1);
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  }

  const th = "sticky top-0 z-10 cursor-pointer select-none whitespace-nowrap border-b border-line bg-row-hover px-2 py-2 text-right text-xs font-medium text-muted hover:text-ink";
  const arrow = (k: MetricKey | "name") => (sort.k === k ? (sort.dir === 1 ? <ArrowUp className="ml-0.5 inline size-3" /> : <ArrowDown className="ml-0.5 inline size-3" />) : null);
  const missing = (data?.rows || []).filter((r) => !r.has_data).length;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-semibold text-ink">So sánh tài khoản</h2>
        <span className="rounded-sm bg-inset px-1.5 py-0.5 text-[11px] text-muted" title="Chỉ nhân sự thấy; không có trong báo cáo khách hàng.">Nội bộ</span>
        <span className="text-xs text-muted">Google Ads · số liệu tính hằng đêm (chỉ đọc)</span>
        {canManage ? <button type="button" onClick={() => setManage((x) => !x)} className="ml-auto inline-flex h-8 items-center rounded-md border border-line bg-paper px-3 text-sm font-medium text-ink hover:bg-inset">{manage ? "Đóng quản lý nhóm" : "Quản lý nhóm"}</button> : null}
      </div>
      {err ? <ErrorState title="Không tải được" message={err} onRetry={() => setEpoch((n) => n + 1)} /> : null}
      {manage && canManage && groups ? <GroupManager groups={groups.filter((g) => !g.personal)} accounts={accounts} onChanged={(id) => { if (id) setGid(id); setEpoch((n) => n + 1); }} /> : null}

      {groups && !groups.length && mode === "group" ? (
        <Card><EmptyState title="Chưa có nhóm so sánh" description={canManage ? "Bấm “Quản lý nhóm” để tạo nhóm (ví dụ Nha khoa, Du lịch) hoặc dùng “Gợi ý nhóm”." : "Nhờ Admin / Trưởng phòng tạo nhóm so sánh."} /></Card>
      ) : null}

      {groups ? (
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <div className="flex gap-1 rounded-md border border-line bg-paper p-1" role="group" aria-label="Chế độ so sánh">
              {([["group", "Nhóm"], ["custom", "Tự chọn tài khoản"]] as const).map(([m, l]) => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => { setMode(m); if (m === "custom" && !picked.length) setPickerOpen(true); }} className={cn("h-7 rounded px-2.5 font-medium", mode === m ? "bg-accent text-white" : "text-muted hover:text-ink")}>{l}</button>
              ))}
            </div>
            {mode === "group" && groups.length ? (
              <label className="inline-flex items-center gap-1.5">Nhóm
                <select value={gid} onChange={(e) => setGid(Number(e.target.value))} className="h-8 rounded-md border border-line bg-paper px-2">
                  {groups.some((g) => !g.personal) ? <optgroup label="Nhóm chung">{groups.filter((g) => !g.personal).map((g) => <option key={g.id} value={g.id}>{g.name} ({g.members.length})</option>)}</optgroup> : null}
                  {groups.some((g) => g.personal) ? <optgroup label="Nhóm của tôi">{groups.filter((g) => g.personal).map((g) => <option key={g.id} value={g.id}>{g.name} ({g.members.length})</option>)}</optgroup> : null}
                </select>
              </label>
            ) : null}
            {mode === "group" && group?.personal && canSave ? <PersonalGroupActions g={group} onChanged={(id) => { if (id !== undefined) setGid(id); setEpoch((n) => n + 1); }} /> : null}
            {mode === "custom" ? <button type="button" onClick={() => setPickerOpen((x) => !x)} className="inline-flex h-8 items-center rounded-md border border-line bg-paper px-3 font-medium text-ink hover:bg-inset">{picked.length ? `Đã chọn ${picked.length} tài khoản` : "Chọn tài khoản"} ▾</button> : null}
            <div className="flex gap-1 rounded-md border border-line bg-paper p-1">
              {MAIN_PERIODS.map((p) => (
                <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)} className={cn("h-7 rounded px-2.5 font-medium", period === p ? "bg-accent-soft text-accent" : "text-muted hover:text-ink")}>{PERIOD_LABEL[p]}</button>
              ))}
              <button type="button" aria-pressed={period === "months" || period === "days"} onClick={() => { if (period !== "months" && period !== "days") setPeriod("months"); }} className={cn("h-7 rounded px-2.5 font-medium", period === "months" || period === "days" ? "bg-accent-soft text-accent" : "text-muted hover:text-ink")}>Tuỳ chọn</button>
            </div>
            {data?.months.length && period !== "days" ? <span className="text-xs text-muted">{data.months.map(mLabel).join(", ")}{period === "this_month" ? " (đến hôm qua)" : ""}</span> : null}
            {mode === "group" && data?.can_compute && missing ? <button type="button" onClick={() => void compute()} className="ml-auto inline-flex h-8 items-center rounded-md border border-line bg-paper px-3 text-xs font-medium text-ink hover:bg-inset" title="Admin: tính ngay số liệu cho tài khoản trong nhóm (chỉ đọc Google Ads)">Tính ngay ({missing} chưa có số)</button> : null}
          </div>
          {period === "months" || period === "days" ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <div className="flex gap-1 rounded-md border border-line bg-paper p-1 text-xs" role="group" aria-label="Kiểu khoảng thời gian">
                <button type="button" aria-pressed={period === "months"} onClick={() => setPeriod("months")} className={cn("h-6 rounded px-2 font-medium", period === "months" ? "bg-accent text-white" : "text-muted hover:text-ink")}>Theo tháng</button>
                <button type="button" aria-pressed={period === "days"} onClick={() => setPeriod("days")} className={cn("h-6 rounded px-2 font-medium", period === "days" ? "bg-accent text-white" : "text-muted hover:text-ink")}>Theo ngày</button>
              </div>
              {period === "months" ? (
                <>
                  <label className="inline-flex items-center gap-1">Từ <input type="month" value={mFrom} max={thisMonth()} onChange={(e) => e.target.value && setMFrom(e.target.value)} className="h-8 rounded-md border border-line bg-paper px-2" /></label>
                  <label className="inline-flex items-center gap-1">đến <input type="month" value={mTo} max={thisMonth()} onChange={(e) => e.target.value && setMTo(e.target.value)} className="h-8 rounded-md border border-line bg-paper px-2" /></label>
                  <span className="text-xs text-muted">{mLabel(mFrom)}–{mLabel(mTo)} · cộng số đã tính sẵn theo tháng</span>
                </>
              ) : (
                <>
                  {[7, 14, 30].map((n) => (
                    <button key={n} type="button" onClick={() => { setDFrom(daysBack(n)); setDTo(yesterday()); }} aria-pressed={dFrom === daysBack(n) && dTo === yesterday()}
                      className={cn("h-7 rounded-md border px-2 text-xs font-medium", dFrom === daysBack(n) && dTo === yesterday() ? "border-accent-border bg-accent-soft text-accent" : "border-line bg-paper text-muted hover:text-ink")}>{n} ngày</button>
                  ))}
                  <label className="inline-flex items-center gap-1">Từ <input type="date" value={dFrom} max={yesterday()} onChange={(e) => e.target.value && setDFrom(e.target.value)} className="h-8 rounded-md border border-line bg-paper px-2" /></label>
                  <label className="inline-flex items-center gap-1">đến <input type="date" value={dTo} max={yesterday()} onChange={(e) => e.target.value && setDTo(e.target.value)} className="h-8 rounded-md border border-line bg-paper px-2" /></label>
                  <span className="text-xs text-muted">{dmy(dFrom)}–{dmy(dTo)} · tải trực tiếp (chỉ đọc), tối đa ~1 năm</span>
                </>
              )}
              {rangeErr ? <span className="text-xs text-danger">{rangeErr}</span> : null}
            </div>
          ) : null}
          {data?.period_note && data.period === period ? <p className="text-xs text-muted">{data.period_note}</p> : null}
          {loading && period === "days" ? <p className="text-xs text-accent">Đang tải số liệu trực tiếp từ Google Ads…</p> : null}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted">Loại chiến dịch:</span>
            <Chip on={!channels.length} onClick={() => setChannels([])}>Tất cả</Chip>
            {(data?.channels || []).map((c) => <Chip key={c} on={channels.includes(c)} onClick={() => toggle(channels, c, setChannels)}>{CHANNEL_LABEL[c as ChannelKey] || c}</Chip>)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted">Nhóm chuyển đổi:</span>
            <Chip on={!convs.length} onClick={() => setConvs([])}>Tất cả (chính)</Chip>
            {CONV_GROUPS.map((g) => <Chip key={g} on={convs.includes(g)} onClick={() => toggle(convs, g, setConvs)}>{CONV_SHORT[g]}</Chip>)}
          </div>
          {mode === "custom" && pickerOpen ? (
            <AccountPicker accounts={accounts.filter((a) => a.platform === "google")} picked={picked} onChange={setPicked} canSave={canSave} viewAs={viewAs}
              onSaved={(id) => { setMode("group"); setGid(id); setPickerOpen(false); setEpoch((n) => n + 1); }} />
          ) : null}
          {msg ? <p className="text-xs text-muted [overflow-wrap:anywhere]">{msg}</p> : null}
          {data?.conv_note ? <p className="text-xs text-warn">{data.conv_note}</p> : null}
          {mode === "group" && group?.hidden_count ? <p className="text-xs text-muted">Nhóm có thêm {group.hidden_count} tài khoản bạn không được xem.</p> : null}
        </Card>
      ) : null}

      {mode === "custom" && !picked.length && groups ? (
        <Card><EmptyState title="Chưa chọn tài khoản" description="Chọn từ 2 tài khoản trở lên trong phạm vi của bạn để so sánh."
          action={<button type="button" onClick={() => setPickerOpen(true)} className="inline-flex h-8 items-center rounded-md bg-brand px-3 text-sm font-medium text-accent-fg">Chọn tài khoản để so sánh</button>} /></Card>
      ) : null}
      {(mode === "custom" ? picked.length > 0 : gid) && loading && !data ? <Card className="p-4"><TableSkeleton rows={4} cols={7} /></Card> : null}
      {data && (mode === "custom" ? data.custom : data.group) ? (
        <>
          <div className={cn("relative max-h-[70vh] overflow-auto rounded-lg border border-line bg-paper", loading && "opacity-60")}>
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className={cn(th, "sticky left-0 z-20 text-left")} onClick={() => clickHead("name")}>Tài khoản{arrow("name")}</th>
                  {METRICS.map((k) => <th key={k} className={cn(th, chart === k && "text-accent")} onClick={() => clickHead(k)} title={`Sắp xếp; xem xu hướng 3 tháng của ${METRIC_LABEL[k]}`}>{METRIC_LABEL[k]}{arrow(k)}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.client_id} className="hover:bg-row-hover/50">
                    <td className="sticky left-0 z-[5] min-w-[220px] max-w-[320px] border-b border-r border-line/60 bg-paper px-3 py-2 align-top">
                      {onOpenAccount ? (
                        <button type="button" onClick={() => onOpenAccount(r.client_id)} className="cursor-pointer text-left font-medium text-ink hover:text-accent hover:underline [overflow-wrap:anywhere]" title="Mở chi tiết tài khoản">{r.label}</button>
                      ) : <span className="font-medium text-ink">{r.label}</span>}
                      <span className="block text-xs text-subtle">{r.customer_id_dashed}</span>
                      {r.low_data ? <span className="mt-0.5 inline-flex h-5 items-center rounded-sm bg-warn-bg px-1.5 text-[11px] text-warn" title={`< ${data.thresholds.conv} chuyển đổi hoặc < ${data.thresholds.clicks} click trong kỳ`}>ít dữ liệu</span> : null}
                      {!r.has_data ? <span className="mt-0.5 block text-[11px] text-muted" title={r.error || ""}>{r.error ? (data.period === "days" ? "Không tải được số liệu" : "Lỗi tính số liệu") : data.period === "days" || r.computed_at ? "Không có số trong kỳ" : "Chưa có số (tính đêm nay)"}</span> : null}
                      {r.has_data && r.note ? <span className="mt-0.5 block text-[11px] text-warn" title="Các tháng này chưa có số đã tính: tổng chỉ gồm các tháng có số.">{r.note}</span> : null}
                      <GoogleAdsLink clientId={r.client_id} cid={r.customer_id_dashed} isAdmin={isAdmin} className="mt-1 block" />
                    </td>
                    {METRICS.map((k) => {
                      const t = r.low_data ? null : tone(k, r.m[k], data.median[k]);
                      return <td key={k} className={cn("whitespace-nowrap border-b border-line/60 px-2 py-2 text-right tabular-nums", t === "better" && "bg-ok-bg text-ok", t === "worse" && "bg-danger-bg text-danger", r.m[k] == null && "text-subtle")}>{fmt(k, r.m[k])}</td>;
                    })}
                  </tr>
                ))}
                <LevelRow label="Mặt bằng nhóm · trung vị" m={data.median} />
                <LevelRow label="Mặt bằng nhóm · bình quân theo chi tiêu" m={data.weighted} hint="CPC, CPA, CR: bình quân có trọng số theo chi tiêu. Chi tiêu, click, chuyển đổi: trung bình mỗi tài khoản." />
                {!rows.length ? <tr><td colSpan={METRICS.length + 1}><EmptyState title={mode === "custom" ? "Chưa có tài khoản Google nào được chọn." : "Nhóm chưa có tài khoản Google nào bạn được xem."} /></td></tr> : null}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            Màu so với trung vị nhóm: xanh = tốt hơn, đỏ = kém hơn quá 10% (CPC, chi phí/chuyển đổi: thấp là tốt; CR: cao là tốt). Tài khoản “ít dữ liệu” không tô màu. “-” = chưa có số liệu (không phải 0). Bấm tiêu đề cột để sắp xếp và xem xu hướng 3 tháng.
          </p>
          {chart ? <TrendChart data={data} k={chart} onClose={() => setChart(null)} /> : null}
        </>
      ) : null}
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={on} onClick={onClick} className={cn("h-6 rounded-full border px-2.5", on ? "border-accent-border bg-accent-soft text-accent" : "border-line bg-paper text-muted hover:text-ink")}>{children}</button>;
}
function LevelRow({ label, m, hint }: { label: string; m: Metrics; hint?: string }) {
  return (
    <tr className="bg-inset/60 font-medium">
      <td className="sticky left-0 z-[5] border-b border-r border-line/60 bg-inset px-3 py-2 text-xs text-ink" title={hint}>{label}</td>
      {METRICS.map((k) => <td key={k} className="whitespace-nowrap border-b border-line/60 px-2 py-2 text-right tabular-nums text-ink">{fmt(k, m[k])}</td>)}
    </tr>
  );
}

function TrendChart({ data, k, onClose }: { data: CompareRead; k: MetricKey; onClose: () => void }) {
  const series = data.trend_months.map((mo, i) => {
    const pt: Record<string, string | number | null> = { m: mLabel(mo) };
    for (const r of data.rows) pt[r.client_id] = r.trend[i]?.m[k] ?? null;
    return pt;
  });
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-sm font-semibold text-ink">{METRIC_LABEL[k]} · 3 tháng đủ gần nhất</p>
        <span className="text-xs text-muted">(theo bộ lọc loại chiến dịch / nhóm chuyển đổi)</span>
        <button type="button" onClick={onClose} className="ml-auto text-xs text-muted hover:text-ink">Đóng</button>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="m" fontSize={11} />
            <YAxis fontSize={11} width={70} tickFormatter={(v: number) => fmt(k, v)} />
            <Tooltip formatter={(v: unknown) => fmt(k, typeof v === "number" ? v : null)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {data.rows.map((r, i) => <Line key={r.client_id} type="monotone" dataKey={r.client_id} name={r.label} stroke={COLORS[i % COLORS.length]} connectNulls={false} dot />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

/** Admin / Trưởng phòng: create, rename, delete groups; add / remove accounts; "Gợi ý nhóm". */
function GroupManager({ groups, accounts, onChanged }: { groups: CompareGroup[]; accounts: Acc[]; onChanged: (id?: number) => void }) {
  const [name, setName] = useState("");
  const [sel, setSel] = useState<number>(groups[0]?.id || 0);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [sugg, setSugg] = useState<GroupSuggestion[] | null>(null);
  useEffect(() => { if (!groups.some((g) => g.id === sel)) setSel(groups[0]?.id || 0); }, [groups, sel]);
  const g = groups.find((x) => x.id === sel) || null;
  const byId = new Map(accounts.map((a) => [a.client_id, a]));
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg("");
    try { const r = await fn(); setMsg(ok); onChanged((r as { id?: number } | undefined)?.id); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  const shown = accounts.filter((a) => a.platform === "google" && !(g?.members.includes(a.client_id)) && (!q.trim() || `${a.label} ${a.customer_id_dashed || ""}`.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 30);
  return (
    <Card className="flex flex-col gap-3 p-4 text-sm">
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void run(() => saveCompareGroupFn({ data: { op: "create", name } }).then((r) => { setName(""); setSel(r.id); return r; }), "Đã tạo nhóm."); }}>
        <span className="font-medium text-ink">Tạo nhóm mới</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Ví dụ: Nha khoa" className="h-8 w-56 rounded-md border border-line bg-paper px-2" />
        <button type="submit" disabled={busy || !name.trim()} className="h-8 rounded-md bg-brand px-3 font-medium text-accent-fg disabled:opacity-50">Tạo</button>
        <button type="button" disabled={busy} onClick={() => void suggestCompareGroupsFn().then((r) => setSugg(r.suggestions)).catch((e: unknown) => setMsg(e instanceof Error ? e.message : String(e)))} className="ml-auto h-8 rounded-md border border-line bg-paper px-3 font-medium text-ink hover:bg-inset">Gợi ý nhóm</button>
      </form>
      {sugg ? (
        <div className="rounded-md border border-line bg-inset/50 p-3">
          <p className="mb-2 text-xs text-muted">Gợi ý theo tên khách hàng / công ty dùng chung. Chỉ là gợi ý — kiểm tra rồi bấm “Tạo nhóm này”.</p>
          {!sugg.length ? <p className="text-xs text-muted">Không có gợi ý mới.</p> : (
            <ul className="flex flex-col gap-1.5">
              {sugg.map((s) => (
                <li key={s.key} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{s.name}</span>
                  <span className="text-xs text-muted">{s.members.map((id) => byId.get(id)?.label || id).join(" · ")}</span>
                  <button type="button" disabled={busy} onClick={() => void run(() => saveCompareGroupFn({ data: { op: "create", name: s.name, clientIds: s.members } }).then((r) => { setSugg((x) => (x || []).filter((y) => y.key !== s.key)); setSel(r.id); return r; }), `Đã tạo nhóm “${s.name}”.`)} className="h-6 rounded-md border border-accent-border bg-accent-soft px-2 text-xs font-medium text-accent">Tạo nhóm này</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {groups.length ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">Sửa nhóm</span>
            <select value={sel} onChange={(e) => setSel(Number(e.target.value))} className="h-8 rounded-md border border-line bg-paper px-2">
              {groups.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            {g ? (
              <>
                <button type="button" disabled={busy} onClick={() => { const n = window.prompt("Tên mới của nhóm", g.name); if (n && n.trim()) void run(() => saveCompareGroupFn({ data: { op: "rename", id: g.id, name: n } }), "Đã đổi tên."); }} className="h-8 rounded-md border border-line bg-paper px-3 hover:bg-inset">Đổi tên</button>
                <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Xoá nhóm “${g.name}”? Tài khoản không bị ảnh hưởng.`)) void run(() => saveCompareGroupFn({ data: { op: "delete", id: g.id } }), "Đã xoá nhóm."); }} className="h-8 rounded-md border border-line bg-paper px-3 text-danger hover:bg-inset">Xoá nhóm</button>
              </>
            ) : null}
          </div>
          {g ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {g.members.map((id) => (
                  <span key={id} className="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-paper pl-2.5 pr-1 text-xs">
                    {byId.get(id)?.label || id}
                    <button type="button" disabled={busy} onClick={() => void run(() => saveCompareGroupFn({ data: { op: "remove", id: g.id, clientIds: [id] } }), "Đã bỏ khỏi nhóm.")} className="rounded-full px-1 text-muted hover:text-danger" aria-label="Bỏ khỏi nhóm">×</button>
                  </span>
                ))}
                {!g.members.length ? <span className="text-xs text-muted">Nhóm chưa có tài khoản.</span> : null}
              </div>
              <div className="flex flex-col gap-1">
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tài khoản Google để thêm…" className="h-8 w-full max-w-md rounded-md border border-line bg-paper px-2" />
                {q.trim() ? (
                  <div className="flex flex-wrap gap-1.5">
                    {shown.map((a) => <button key={a.client_id} type="button" disabled={busy} onClick={() => void run(() => saveCompareGroupFn({ data: { op: "add", id: g.id, clientIds: [a.client_id] } }), "Đã thêm vào nhóm.")} className="h-7 rounded-full border border-line bg-paper px-2.5 text-xs hover:border-accent-border hover:text-accent">+ {a.label}</button>)}
                    {!shown.length ? <span className="text-xs text-muted">Không tìm thấy.</span> : null}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {msg ? <p className="text-xs text-muted [overflow-wrap:anywhere]">{msg}</p> : null}
    </Card>
  );
}

/** Searchable multi-select of the user's own accounts + "Lưu vào Nhóm của tôi". */
function AccountPicker({ accounts, picked, onChange, canSave, viewAs, onSaved }: { accounts: Acc[]; picked: string[]; onChange: (ids: string[]) => void; canSave: boolean; viewAs: boolean; onSaved: (id: number) => void }) {
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const set = new Set(picked);
  const f = q.trim().toLowerCase();
  const list = accounts.filter((a) => !f || `${a.label} ${a.customer_id_dashed || ""}`.toLowerCase().includes(f));
  const flip = (id: string) => onChange(set.has(id) ? picked.filter((x) => x !== id) : [...picked, id].slice(0, 60));
  const byId = new Map(accounts.map((a) => [a.client_id, a]));
  async function save() {
    setBusy(true); setMsg("");
    try { const r = await saveCompareGroupFn({ data: { op: "create", personal: true, name, clientIds: picked } }); setName(""); onSaved(r.id); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-inset/40 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tài khoản (tên hoặc mã)…" className="h-8 w-72 rounded-md border border-line bg-paper px-2" />
        <span className="text-xs text-muted">{accounts.length} tài khoản trong phạm vi của bạn</span>
        {picked.length ? <button type="button" onClick={() => onChange([])} className="text-xs text-muted hover:text-danger">Bỏ chọn tất cả</button> : null}
      </div>
      {picked.length ? (
        <div className="flex flex-wrap gap-1.5">
          {picked.map((id) => <span key={id} className="inline-flex h-6 items-center gap-1 rounded-full border border-accent-border bg-accent-soft pl-2 pr-1 text-xs text-accent">{byId.get(id)?.label || id}<button type="button" onClick={() => flip(id)} aria-label="Bỏ chọn" className="px-1 hover:text-danger">×</button></span>)}
        </div>
      ) : null}
      <div className="max-h-56 overflow-auto rounded-md border border-line bg-paper">
        {list.slice(0, 200).map((a) => (
          <label key={a.client_id} className="flex cursor-pointer items-center gap-2 border-b border-line/50 px-2 py-1.5 hover:bg-row-hover">
            <input type="checkbox" checked={set.has(a.client_id)} onChange={() => flip(a.client_id)} className="accent-[var(--color-accent)]" />
            <span className="text-ink">{a.label}</span><span className="text-xs text-subtle">{a.customer_id_dashed}</span>
          </label>
        ))}
        {!list.length ? <p className="px-2 py-2 text-xs text-muted">Không tìm thấy.</p> : null}
      </div>
      {picked.length >= 2 ? (
        canSave ? (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void save(); }}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Tên nhóm, ví dụ Khách nha khoa của tôi" className="h-8 w-64 rounded-md border border-line bg-paper px-2" />
            <button type="submit" disabled={busy || !name.trim()} className="h-8 rounded-md border border-line bg-paper px-3 font-medium text-ink hover:bg-inset disabled:opacity-50">Lưu vào “Nhóm của tôi”</button>
            <span className="text-xs text-muted">Chỉ bạn thấy nhóm này.</span>
          </form>
        ) : <p className="text-xs text-muted">{viewAs ? "Đang Xem như: được chọn để xem, không lưu nhóm." : "Không lưu được nhóm (chỉ xem)."}</p>
      ) : null}
      {msg ? <p className="text-xs text-danger [overflow-wrap:anywhere]">{msg}</p> : null}
    </div>
  );
}

/** Rename / delete a personal group ("Nhóm của tôi"); owner only, never in Xem như (server checks). */
function PersonalGroupActions({ g, onChanged }: { g: CompareGroup; onChanged: (id?: number) => void }) {
  const [msg, setMsg] = useState("");
  const run = async (fn: () => Promise<unknown>, next?: number) => { try { await fn(); setMsg(""); onChanged(next); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <button type="button" onClick={() => { const n = window.prompt("Tên mới của nhóm", g.name); if (n && n.trim()) void run(() => saveCompareGroupFn({ data: { op: "rename", id: g.id, name: n } })); }} className="h-7 rounded-md border border-line bg-paper px-2 hover:bg-inset">Đổi tên</button>
      <button type="button" onClick={() => { if (window.confirm(`Xoá nhóm của tôi “${g.name}”?`)) void run(() => saveCompareGroupFn({ data: { op: "delete", id: g.id } }), 0); }} className="h-7 rounded-md border border-line bg-paper px-2 text-danger hover:bg-inset">Xoá</button>
      {msg ? <span className="text-danger">{msg}</span> : null}
    </span>
  );
}
