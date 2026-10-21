import { createContext, Fragment, useContext, useEffect, useMemo, useState } from "react";
import { readConvGroupsFn, readGoogleTrendChildrenFn, readGoogleTrendTreeFn } from "@/lib/adsops/connect.functions";
import { CONV_GROUPS, CONV_GROUP_LABEL, type ConvActionRow, type ConvActionsRead, type ConvByMonth, type ConvGroup } from "@/lib/adsops/google-conv-groups";
import { GoogleConvMap } from "@/components/adsops/google-conv-map";
import { CHANNEL_LABEL, LOW_CLICKS, LOW_CONV, type ChannelGroup, type ChannelKey, type TreeRow, type TrendChildrenRead, type TrendMonth, type TrendTreeRead } from "@/lib/adsops/google-trend.types";
import { cn } from "@/lib/cn";

type K = "cpc" | "cpa" | "cvr";
const MET: Array<{ k: K; label: string; upBad: boolean; hint: string }> = [
  { k: "cpc", label: "CPC", upBad: true, hint: "Chi phí ÷ Click" },
  { k: "cpa", label: "Giá/chuyển đổi", upBad: true, hint: "Chi phí ÷ Chuyển đổi" },
  { k: "cvr", label: "Tỷ lệ chuyển đổi", upBad: false, hint: "Chuyển đổi ÷ Click" },
];
type SortKey = "worst" | "spend" | "cpc" | "cpa" | "cvr" | "name";
const SORTS: Array<[SortKey, string]> = [["worst", "Xấu đi nhiều nhất"], ["spend", "Chi phí tháng gần nhất"], ["cpc", "CPC tăng nhiều nhất"], ["cpa", "Giá/CĐ tăng nhiều nhất"], ["cvr", "Tỷ lệ CĐ giảm nhiều nhất"], ["name", "Tên"]];

const dong = (v: number) => `${Math.round(v).toLocaleString("vi-VN")}đ`;
const fmt = (k: K, v: number | null) => (v == null ? "-" : k === "cvr" ? `${(v * 100).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%` : dong(v));
const mLabel = (m: string) => `T${Number(m.slice(5))}/${m.slice(2, 4)}`;
const pctS = (d: number) => `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}%`;
const mom = (a: number | null, b: number | null) => (a == null || b == null || a === 0 ? null : (b - a) / a);

/** Bad-direction MoM for one metric at the last column (T vs T-1); null if not evaluable. */
function badDelta(ms: TrendMonth[], k: K, upBad: boolean) {
  const b = ms[ms.length - 2], c = ms[ms.length - 1];
  if (!b || !c || b.low_data || c.low_data) return null;
  const d = mom(b[k], c[k]);
  return d == null ? null : upBad ? d : -d;
}

type Cx = { acts: Map<string, ConvActionRow>; sel: Set<ConvGroup>; all: boolean; present: Set<ConvGroup>; ready: boolean };
const ConvCx = createContext<Cx>({ acts: new Map(), sel: new Set(CONV_GROUPS), all: true, present: new Set(), ready: false });
const actOf = (cx: Cx, id: string, c1: number) => cx.acts.get(id) || { group: "other" as ConvGroup, primary: c1 > 0, name: `#${id}` };
/** Primary conversions per group for one month (null = no breakdown data). */
function groupCounts(cx: Cx, conv: ConvByMonth | null | undefined, month: string): Map<ConvGroup, number> | null {
  if (!conv) return null;
  const out = new Map<ConvGroup, number>();
  for (const [id, [c1]] of Object.entries(conv[month] || {})) { const a = actOf(cx, id, c1); if (a.primary) out.set(a.group, (out.get(a.group) || 0) + c1); }
  return out;
}
/** CPA / CVR recomputed from selected primary groups only; cost & clicks unchanged. */
function viewMs(cx: Cx, ms: TrendMonth[], conv: ConvByMonth | null | undefined): TrendMonth[] {
  if (cx.all || !cx.ready) return ms;
  return ms.map((m) => {
    const g = groupCounts(cx, conv, m.month);
    if (!g || m.clicks == null) return { ...m, conversions: null, cpa: null, cvr: null, low_data: true };
    let c = 0; for (const [k, v] of g) if (cx.sel.has(k)) c += v;
    return { ...m, conversions: c, cpa: c > 0 && m.spend != null ? m.spend / c : null, cvr: m.clicks > 0 ? c / m.clicks : null, low_data: c < LOW_CONV || m.clicks < LOW_CLICKS };
  });
}
function lightFlag(cx: Cx, ms: TrendMonth[], conv: ConvByMonth | null | undefined, vtc: Record<string, number> | null | undefined): string | null {
  const m = ms[Math.min(2, ms.length - 1)];
  const g = groupCounts(cx, conv, m.month);
  if (!g || !cx.ready) return null;
  const tot = [...g.values()].reduce((s, v) => s + v, 0);
  if (tot <= 0) return null;
  const v = vtc?.[m.month];
  if ((g.get("other") || 0) / tot > 0.5) return `Chuyển đổi nhẹ: ${Math.round(((g.get("other") || 0) / tot) * 100)}% thuộc nhóm Khác (${mLabel(m.month)})`;
  if (v != null && v >= tot) return `Chuyển đổi nhẹ: nhiều view-through (${v.toLocaleString("vi-VN")} so với ${tot.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} chuyển đổi chính, ${mLabel(m.month)})`;
  return null;
}

function ConvRows({ ms, conv, span }: { ms: TrendMonth[]; conv: ConvByMonth | null | undefined; span: number }) {
  const cx = useContext(ConvCx);
  if (!conv) return <tr><td colSpan={span} className="bg-bg px-2 py-1 pl-12 text-[11px] text-muted">Không đọc được dữ liệu theo hành động chuyển đổi: -</td></tr>;
  const sec = new Map<string, Record<string, number>>();
  for (const m of ms) for (const [id, [c1, c2]] of Object.entries(conv[m.month] || {})) { const a = actOf(cx, id, c1); if (!a.primary && c2 > 0) (sec.get(a.name) || sec.set(a.name, {}).get(a.name)!)[m.month] = c2; }
  return (
    <tr><td colSpan={span} className="bg-bg px-2 py-2 pl-12">
      <table className="text-[11px]">
        <thead className="text-muted"><tr><th className="pr-3 text-left font-medium">Nhóm (chuyển đổi chính)</th>{ms.map((m) => <th key={m.month} className="px-2 text-right font-medium">{mLabel(m.month)}</th>)}</tr></thead>
        <tbody>
          {CONV_GROUPS.map((g) => (
            <tr key={g}>
              <td className={cn("pr-3", !cx.sel.has(g) && "text-subtle line-through")}>{CONV_GROUP_LABEL[g]}</td>
              {!cx.present.has(g) ? <td colSpan={ms.length} className="px-2 text-subtle">chưa cài theo dõi</td> : ms.map((m, i) => {
                const c = groupCounts(cx, conv, m.month)?.get(g) ?? (m.clicks == null ? null : 0);
                const p = i > 0 ? groupCounts(cx, conv, ms[i - 1].month)?.get(g) ?? (ms[i - 1].clicks == null ? null : 0) : null;
                const d = i > 0 ? mom(p ?? null, c) : null;
                return (
                  <td key={m.month} className="whitespace-nowrap px-2 text-right tabular-nums" title="Số chuyển đổi · Chi phí ÷ số chuyển đổi nhóm này (chi phí chung của dòng, không phân bổ)">
                    {c == null ? "-" : c.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}
                    <span className="text-muted"> · {c && m.spend != null ? dong(m.spend / c) : "-"}</span>
                    {d != null ? <span className={cn("ml-1", m.low_data ? "text-subtle" : d > 0 ? "text-ok" : d < 0 ? "text-danger" : "text-subtle")}>{pctS(d)}</span> : null}
                  </td>
                );
              })}
            </tr>
          ))}
          {sec.size ? <tr><td colSpan={ms.length + 1} className="pt-1 font-medium text-muted" title="Hành động phụ (secondary) không được tính vào Chuyển đổi / CPA; hiện riêng để tham khảo.">Phụ (không tính vào CPA)</td></tr> : null}
          {[...sec].map(([n, by]) => (
            <tr key={n} className="text-muted"><td className="max-w-[240px] truncate pr-3" title={n}>{n}</td>{ms.map((m) => <td key={m.month} className="px-2 text-right tabular-nums">{by[m.month] != null ? by[m.month].toLocaleString("vi-VN", { maximumFractionDigits: 1 }) : "-"}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </td></tr>
  );
}

function Cell({ ms, i, k, upBad, excluded }: { ms: TrendMonth[]; i: number; k: K; upBad: boolean; excluded: boolean }) {
  const m = ms[i];
  const d = i > 0 ? mom(ms[i - 1][k], m[k]) : null;
  const quiet = excluded || m.low_data || (i > 0 && ms[i - 1].low_data);
  const bad = d != null && (upBad ? d > 0 : d < 0);
  return (
    <td className={cn("whitespace-nowrap px-2 py-1 text-right tabular-nums", i === 0 && "border-l border-line")}>
      <span className={m.low_data && m.clicks != null ? "text-muted" : ""} title={m.low_data && m.clicks != null ? `Ít dữ liệu (dưới ${LOW_CONV} chuyển đổi hoặc dưới ${LOW_CLICKS} click)` : undefined}>{fmt(k, m[k])}</span>
      {d != null ? <span className={cn("block text-[10px]", quiet || Math.abs(d) < 0.005 ? "text-subtle" : bad ? "text-danger" : "text-ok")}>{pctS(d)}</span> : null}
    </td>
  );
}

function Ctx({ ms }: { ms: TrendMonth[] }) {
  const c = ms[ms.length - 1];
  const all = ms.map((m) => `${mLabel(m.month)}: ${m.clicks == null ? "-" : m.clicks.toLocaleString("vi-VN")} click · ${m.conversions == null ? "-" : m.conversions.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} CĐ · ${m.spend == null ? "-" : dong(m.spend)}`).join("\n");
  return (
    <td className="whitespace-nowrap border-l border-line px-2 py-1 text-right text-[11px] text-muted tabular-nums" title={all}>
      {c.clicks == null ? "-" : c.clicks.toLocaleString("vi-VN")} click · {c.conversions == null ? "-" : c.conversions.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} CĐ
      <span className="block">{c.spend == null ? "-" : dong(c.spend)}</span>
    </td>
  );
}

function Row({ name, sub, ms: raw, depth, excluded, lowAll, toggle, open, tone, conv, vtc }: { name: string; sub?: string; ms: TrendMonth[]; depth: number; excluded: string | null; lowAll?: boolean; toggle?: () => void; open?: boolean; tone?: boolean; conv?: ConvByMonth | null; vtc?: Record<string, number> | null }) {
  const cx = useContext(ConvCx);
  const [cOpen, setCOpen] = useState(false);
  const ms = viewMs(cx, raw, conv);
  const light = excluded ? null : lightFlag(cx, raw, conv, vtc);
  const span = 2 + MET.length * ms.length;
  return (
    <>
    <tr className={cn("border-t border-line", tone && "bg-accent-soft/40 font-medium", excluded && "opacity-60")}>
      <td className="sticky left-0 z-10 bg-surface px-2 py-1" style={{ paddingLeft: 8 + depth * 18 }}>
        <div className="flex items-start gap-1">
          {toggle ? <button type="button" onClick={toggle} className="w-4 shrink-0 text-muted" aria-label={open ? "Thu gọn" : "Mở rộng"}>{open ? "▾" : "▸"}</button> : <span className="w-4 shrink-0" />}
          <div className="min-w-0">
            <span className="block max-w-[260px] truncate text-ink" title={name}>{name}</span>
            <span className="flex flex-wrap gap-1 text-[10px]">
              {sub ? <span className="text-subtle">{sub}</span> : null}
              {excluded ? <span className="rounded bg-warn-bg px-1 text-warn" title="Không có dữ liệu đủ 3 tháng: loại khỏi so sánh xu hướng và chẩn đoán.">{excluded}</span> : null}
              {!excluded && lowAll ? <span className="rounded bg-line px-1 text-muted">ít dữ liệu</span> : null}
              {light ? <span className="rounded bg-warn-bg px-1 text-warn" title={light}>chuyển đổi nhẹ</span> : null}
              {conv !== undefined && cx.ready ? <button type="button" onClick={() => setCOpen(!cOpen)} className="rounded border border-line px-1 text-accent" title="Chuyển đổi theo nhóm (Gọi điện, Zalo, Messenger, Form, Mua hàng, Khác)">{cOpen ? "▾" : "▸"} Loại CĐ</button> : null}
            </span>
          </div>
        </div>
      </td>
      {MET.map((x) => ms.map((_, i) => <Cell key={`${x.k}${i}`} ms={ms} i={i} k={x.k} upBad={x.upBad} excluded={!!excluded} />))}
      <Ctx ms={ms} />
    </tr>
    {cOpen ? <ConvRows ms={raw} conv={conv} span={span} /> : null}
    </>
  );
}

function sortRows(rs: TreeRow[], key: SortKey, partial: boolean, cx: Cx): TreeRow[] {
  const ms = (r: TreeRow) => viewMs(cx, partial ? [...r.months, r.current] : r.months, r.conv);
  const v = (r: TreeRow): number => {
    if (key === "spend") return ms(r)[ms(r).length - 1].spend ?? -Infinity;
    if (key === "worst") { if (r.excluded_label) return -Infinity; const xs = MET.map((x) => badDelta(viewMs(cx, r.months, r.conv), x.k, x.upBad)).filter((v): v is number => v != null); return xs.length ? Math.max(...xs) : -Infinity; }
    const m = MET.find((x) => x.k === key)!;
    return badDelta(ms(r), m.k, m.upBad) ?? -Infinity;
  };
  return [...rs].sort((a, b) => (a.excluded_label ? 1 : 0) - (b.excluded_label ? 1 : 0) || (key === "name" ? a.name.localeCompare(b.name, "vi") : v(b) - v(a)));
}

function Children({ clientId, camp, partial, sort, cx }: { clientId: string; camp: TreeRow; partial: boolean; sort: SortKey; cx: Cx }) {
  const [d, setD] = useState<TrendChildrenRead | null>(null);
  const pmax = camp.channel === "pmax";
  useEffect(() => {
    let live = true;
    readGoogleTrendChildrenFn({ data: { clientId, campaignId: camp.id, pmax } }).then((r) => live && setD(r)).catch((e: unknown) => live && setD({ kind: pmax ? "asset_group" : "ad_group", rows: [], error: e instanceof Error ? e.message : String(e) }));
    return () => { live = false; };
  }, [clientId, camp.id, pmax]);
  const span = 2 + MET.length * (partial ? 4 : 3);
  if (!d) return <tr><td colSpan={span} className="px-2 py-1 pl-12 text-xs text-muted">Đang tải {pmax ? "nhóm tài sản" : "nhóm quảng cáo"}…</td></tr>;
  if (d.error) return <tr><td colSpan={span} className="px-2 py-1 pl-12 text-xs text-danger">{d.error}</td></tr>;
  if (!d.rows.length) return <tr><td colSpan={span} className="px-2 py-1 pl-12 text-xs text-muted">Không có {pmax ? "nhóm tài sản" : "nhóm quảng cáo"} có dữ liệu.</td></tr>;
  return <>{d.conv_error ? <tr><td colSpan={span} className="px-2 py-1 pl-12 text-[11px] text-warn">Loại chuyển đổi: {d.conv_error}</td></tr> : null}{sortRows(d.rows, sort, partial, cx).map((r) => <Row key={r.id} conv={d.conv_error ? undefined : r.conv ?? null} name={r.name} sub={pmax ? "Nhóm tài sản" : "Nhóm quảng cáo"} ms={partial ? [...r.months, r.current] : r.months} depth={2} excluded={r.excluded_label} lowAll={r.months.every((m) => m.low_data)} />)}</>;
}

function summary(g: ChannelGroup): string {
  const b = g.like[1], c = g.like[2];
  const name = CHANNEL_LABEL[g.channel];
  if (!g.like_count) return `${name}: chưa có chiến dịch chạy đủ 3 tháng để so sánh.`;
  if (b.low_data || c.low_data) return `Cùng nhóm chiến dịch cũ (${name}, ${g.like_count} CD): ít dữ liệu, không đánh giá.`;
  const parts = MET.map((x) => { const d = mom(b[x.k], c[x.k]); return d == null ? `${x.label} -` : `${x.label} ${pctS(d)}`; });
  return `Cùng nhóm chiến dịch cũ (${name}, ${g.like_count}/${g.total_count} CD): ${parts.join(", ")} (${mLabel(c.month)} so với ${mLabel(b.month)}).`;
}

/** Staff-only trend table: Loại chiến dịch → Chiến dịch → Nhóm QC / Nhóm tài sản. Types are never aggregated together. */
export function GoogleTrendTree({ clientId, partial }: { clientId: string; partial: boolean }) {
  const [d, setD] = useState<TrendTreeRead | null>(null);
  const [err, setErr] = useState("");
  const [off, setOff] = useState<Set<ChannelKey>>(new Set());
  const [openT, setOpenT] = useState<Set<string>>(new Set());
  const [openC, setOpenC] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortKey>("worst");
  const [acts, setActs] = useState<ConvActionsRead | null>(null);
  const [sel, setSel] = useState<Set<ConvGroup>>(new Set(CONV_GROUPS));
  useEffect(() => {
    let live = true;
    setActs(null);
    readConvGroupsFn({ data: { clientId } }).then((r) => live && setActs(r)).catch((e: unknown) => live && setActs({ actions: [], can_edit: false, fetched_at: null, error: e instanceof Error ? e.message : String(e) }));
    return () => { live = false; };
  }, [clientId]);
  const cx = useMemo<Cx>(() => {
    const list = acts?.actions || [];
    return { acts: new Map(list.map((a) => [a.id, a])), sel, all: sel.size === CONV_GROUPS.length, present: new Set(list.filter((a) => a.primary).map((a) => a.group)), ready: !!acts && !acts.error };
  }, [acts, sel]);
  useEffect(() => {
    let live = true;
    setD(null); setErr("");
    readGoogleTrendTreeFn({ data: { clientId } }).then((r) => { if (live) { setD(r); setOpenT(new Set(r.groups.slice(0, 1).map((g) => g.channel))); } }).catch((e: unknown) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [clientId]);
  const groups = useMemo(() => {
    if (!d) return [];
    const gs = d.groups.filter((g) => !off.has(g.channel));
    if (sort === "name") return [...gs].sort((a, b) => CHANNEL_LABEL[a.channel].localeCompare(CHANNEL_LABEL[b.channel]));
    if (sort === "spend") return [...gs].sort((a, b) => (b.like[2].spend ?? -1) - (a.like[2].spend ?? -1));
    return gs;
  }, [d, off, sort]);
  const flip = <T,>(s: Set<T>, v: T) => { const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); return n; };

  if (err) return <p className="mt-4 text-sm text-danger">{err}</p>;
  if (!d) return <p className="mt-4 text-sm text-muted">Đang tải xu hướng theo loại chiến dịch…</p>;
  if (d.error) return <p className="mt-4 text-sm text-danger">{d.error}</p>;
  const cols = partial ? [...d.months, d.current_month] : d.months;
  return (
    <ConvCx.Provider value={cx}>
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-sm font-semibold text-ink" title="So sánh cùng loại: không bao giờ cộng gộp Search với PMax/Shopping/YouTube… để đánh giá. Chiến dịch không có dữ liệu đủ 3 tháng bị loại khỏi xu hướng.">Theo loại chiến dịch</p>
      <ul className="mt-1 flex flex-col gap-0.5 text-xs text-ink">
        {d.groups.map((g) => <li key={g.channel}>{summary(g)}</li>)}
      </ul>

      <div className="mt-2 text-xs text-muted">
        <span className="font-medium text-ink" title="Tỷ trọng chi phí theo loại chiến dịch (tất cả chiến dịch). Thay đổi tỷ trọng làm CPC/CPA cấp tài khoản thay đổi dù từng loại không đổi.">Cơ cấu chi phí: </span>
        {d.mix.filter((m) => partial || m.month !== d.current_month).map((m) => (
          <span key={m.month} className="mr-3 inline-block">
            {mLabel(m.month)}{m.month === d.current_month ? " (chưa trọn)" : ""}: {m.total == null ? "-" : m.shares.map((s) => `${CHANNEL_LABEL[s.channel]} ${(s.share * 100).toFixed(0)}%`).join(" · ")}
          </span>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {d.groups.map((g) => (
          <button key={g.channel} type="button" onClick={() => setOff(flip(off, g.channel))}
            className={cn("rounded-full border px-2.5 py-0.5 text-xs", off.has(g.channel) ? "border-line text-subtle line-through" : "border-accent bg-accent-soft text-accent")}>
            {CHANNEL_LABEL[g.channel]} ({g.total_count})
          </button>
        ))}
        <label className="ml-auto inline-flex items-center gap-1 text-xs text-muted">Sắp xếp
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded border border-line bg-surface px-1 py-0.5 text-xs">
            {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-medium text-ink" title="Tính lại Giá/chuyển đổi và Tỷ lệ chuyển đổi chỉ với các nhóm được chọn (chỉ hành động chuyển đổi chính). Chi phí và click giữ nguyên.">Chỉ tính chuyển đổi:</span>
        {!acts ? <span className="text-muted">Đang tải hành động chuyển đổi…</span> : acts.error ? <span className="text-danger">{acts.error}</span> : CONV_GROUPS.map((g) => (
          <button key={g} type="button" disabled={!cx.present.has(g)} onClick={() => { const n = flip(sel, g); if (n.size) setSel(n); }}
            title={cx.present.has(g) ? undefined : "Tài khoản chưa có hành động chuyển đổi chính thuộc nhóm này"}
            className={cn("rounded-full border px-2 py-0.5", !cx.present.has(g) ? "border-line text-subtle" : sel.has(g) ? "border-accent bg-accent-soft text-accent" : "border-line text-muted line-through")}>
            {CONV_GROUP_LABEL[g]}{cx.present.has(g) ? "" : " (chưa cài theo dõi)"}
          </button>
        ))}
        {!cx.all ? <button type="button" onClick={() => setSel(new Set(CONV_GROUPS))} className="text-accent underline">Tất cả</button> : null}
        {d.conv_error ? <span className="text-warn">Loại chuyển đổi: {d.conv_error}</span> : null}
      </div>

      <div className="mt-2 max-h-[640px] overflow-auto rounded-lg border border-line">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-20 bg-surface text-muted">
            <tr>
              <th rowSpan={2} className="sticky left-0 z-30 bg-surface px-2 py-1 text-left font-medium">Loại / Chiến dịch / Nhóm</th>
              {MET.map((x) => <th key={x.k} colSpan={cols.length} className="border-l border-line px-2 py-1 font-medium" title={x.hint}>{x.label}</th>)}
              <th rowSpan={2} className="border-l border-line px-2 py-1 text-right font-medium" title="Click · Chuyển đổi · Chi phí của cột tháng cuối. Rê chuột để xem từng tháng.">Bối cảnh ({mLabel(cols[cols.length - 1])})</th>
            </tr>
            <tr>
              {MET.map((x) => cols.map((m, i) => <th key={x.k + m} className={cn("px-2 py-0.5 text-right font-normal", i === 0 && "border-l border-line")}>{mLabel(m)}{m === d.current_month ? "*" : ""}</th>))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const gms = partial ? [...g.like, g.like_current] : g.like;
              const open = openT.has(g.channel);
              return (
                <Fragment key={g.channel}>
                  <Row tone conv={d.conv_error ? undefined : g.conv ?? null} vtc={g.vtc} name={CHANNEL_LABEL[g.channel]} sub={`Cùng nhóm cũ: ${g.like_count}/${g.total_count} chiến dịch`} ms={gms} depth={0} excluded={g.like_count ? null : "Chưa đủ 3 tháng"} lowAll={g.like.every((m) => m.low_data)} open={open} toggle={() => setOpenT(flip(openT, g.channel))} />
                  {open && g.diagnoses.length ? (
                    <tr><td colSpan={2 + MET.length * cols.length} className="bg-warn-bg/30 px-2 py-1 pl-8 text-[11px] text-ink">
                      {g.diagnoses.map((x) => <p key={x.kind}><b>{x.title}:</b> {x.detail}</p>)}
                    </td></tr>
                  ) : null}
                  {open ? sortRows(g.campaigns, sort, partial, cx).map((c) => {
                    const co = openC.has(c.id);
                    return (
                      <Fragment key={c.id}>
                        <Row conv={d.conv_error ? undefined : c.conv ?? null} vtc={c.vtc} name={c.name} sub={c.status === "PAUSED" ? "Tạm dừng" : c.status === "REMOVED" ? "Đã xoá" : undefined} ms={partial ? [...c.months, c.current] : c.months} depth={1} excluded={c.excluded_label} lowAll={c.months.every((m) => m.low_data)} open={co} toggle={() => setOpenC(flip(openC, c.id))} />
                        {co ? <Children clientId={clientId} camp={c} partial={partial} sort={sort} cx={cx} /> : null}
                      </Fragment>
                    );
                  }) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {acts?.can_edit ? <GoogleConvMap clientId={clientId} read={acts} onChange={setActs} /> : null}
      {partial ? <p className="mt-1 text-[11px] text-subtle">* Tháng hiện tại chưa trọn tháng: CPC, giá/chuyển đổi, tỷ lệ là tỷ lệ nên so được; click/chi phí thấp hơn là bình thường.</p> : null}
    </div>
    </ConvCx.Provider>
  );
}
