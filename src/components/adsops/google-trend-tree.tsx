import { Fragment, useEffect, useMemo, useState } from "react";
import { readGoogleTrendChildrenFn, readGoogleTrendTreeFn } from "@/lib/adsops/connect.functions";
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

function Row({ name, sub, ms, depth, excluded, lowAll, toggle, open, tone }: { name: string; sub?: string; ms: TrendMonth[]; depth: number; excluded: string | null; lowAll?: boolean; toggle?: () => void; open?: boolean; tone?: boolean }) {
  return (
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
            </span>
          </div>
        </div>
      </td>
      {MET.map((x) => ms.map((_, i) => <Cell key={`${x.k}${i}`} ms={ms} i={i} k={x.k} upBad={x.upBad} excluded={!!excluded} />))}
      <Ctx ms={ms} />
    </tr>
  );
}

function sortRows(rs: TreeRow[], key: SortKey, partial: boolean): TreeRow[] {
  const ms = (r: TreeRow) => (partial ? [...r.months, r.current] : r.months);
  const v = (r: TreeRow): number => {
    if (key === "spend") return ms(r)[ms(r).length - 1].spend ?? -Infinity;
    if (key === "worst") return r.worst ?? -Infinity;
    const m = MET.find((x) => x.k === key)!;
    return badDelta(ms(r), m.k, m.upBad) ?? -Infinity;
  };
  return [...rs].sort((a, b) => (a.excluded_label ? 1 : 0) - (b.excluded_label ? 1 : 0) || (key === "name" ? a.name.localeCompare(b.name, "vi") : v(b) - v(a)));
}

function Children({ clientId, camp, partial, sort }: { clientId: string; camp: TreeRow; partial: boolean; sort: SortKey }) {
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
  return <>{sortRows(d.rows, sort, partial).map((r) => <Row key={r.id} name={r.name} sub={pmax ? "Nhóm tài sản" : "Nhóm quảng cáo"} ms={partial ? [...r.months, r.current] : r.months} depth={2} excluded={r.excluded_label} lowAll={r.months.every((m) => m.low_data)} />)}</>;
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
                  <Row tone name={CHANNEL_LABEL[g.channel]} sub={`Cùng nhóm cũ: ${g.like_count}/${g.total_count} chiến dịch`} ms={gms} depth={0} excluded={g.like_count ? null : "Chưa đủ 3 tháng"} lowAll={g.like.every((m) => m.low_data)} open={open} toggle={() => setOpenT(flip(openT, g.channel))} />
                  {open && g.diagnoses.length ? (
                    <tr><td colSpan={2 + MET.length * cols.length} className="bg-warn-bg/30 px-2 py-1 pl-8 text-[11px] text-ink">
                      {g.diagnoses.map((x) => <p key={x.kind}><b>{x.title}:</b> {x.detail}</p>)}
                    </td></tr>
                  ) : null}
                  {open ? sortRows(g.campaigns, sort, partial).map((c) => {
                    const co = openC.has(c.id);
                    return (
                      <Fragment key={c.id}>
                        <Row name={c.name} sub={c.status === "PAUSED" ? "Tạm dừng" : c.status === "REMOVED" ? "Đã xoá" : undefined} ms={partial ? [...c.months, c.current] : c.months} depth={1} excluded={c.excluded_label} lowAll={c.months.every((m) => m.low_data)} open={co} toggle={() => setOpenC(flip(openC, c.id))} />
                        {co ? <Children clientId={clientId} camp={c} partial={partial} sort={sort} /> : null}
                      </Fragment>
                    );
                  }) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {partial ? <p className="mt-1 text-[11px] text-subtle">* Tháng hiện tại chưa trọn tháng: CPC, giá/chuyển đổi, tỷ lệ là tỷ lệ nên so được; click/chi phí thấp hơn là bình thường.</p> : null}
    </div>
  );
}
