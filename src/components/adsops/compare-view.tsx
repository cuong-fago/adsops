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

/** Staff-only "So sánh tài khoản": accounts in a group side by side against the group median. Never shown to clients. */
export function CompareView({ onOpenAccount, isAdmin }: { onOpenAccount?: (clientId: string) => void; isAdmin?: boolean }) {
  const [groups, setGroups] = useState<CompareGroup[] | null>(null);
  const [accounts, setAccounts] = useState<Acc[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [err, setErr] = useState("");
  const [gid, setGid] = useState(0);
  const [period, setPeriod] = useState<ComparePeriod>("last_month");
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
    try { const p = JSON.parse(sessionStorage.getItem(KEY) || "{}"); if (p.gid) setGid(p.gid); if (p.period) setPeriod(p.period); if (Array.isArray(p.channels)) setChannels(p.channels); if (Array.isArray(p.convs)) setConvs(p.convs); } catch { /* ignore */ }
  }, []);
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify({ gid, period, channels, convs })); } catch { /* ignore */ } }, [gid, period, channels, convs]);

  const loadGroups = useCallback(async () => {
    try {
      const r = await listCompareGroupsFn();
      setGroups(r.groups); setAccounts(r.accounts); setCanManage(r.can_manage); setErr("");
      setGid((g) => (r.groups.some((x) => x.id === g) ? g : r.groups[0]?.id || 0));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void loadGroups(); }, [loadGroups, epoch]);

  useEffect(() => {
    if (!gid) { setData(null); return; }
    let live = true;
    setLoading(true);
    readCompareFn({ data: { groupId: gid, period, channels, convGroups: convs } })
      .then((r) => { if (live) { setData(r); setErr(""); } })
      .catch((e: unknown) => { if (live) setErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [gid, period, channels, convs, epoch]);

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
      {manage && canManage && groups ? <GroupManager groups={groups} accounts={accounts} onChanged={(id) => { if (id) setGid(id); setEpoch((n) => n + 1); }} /> : null}

      {groups && !groups.length ? (
        <Card><EmptyState title="Chưa có nhóm so sánh" description={canManage ? "Bấm “Quản lý nhóm” để tạo nhóm (ví dụ Nha khoa, Du lịch) hoặc dùng “Gợi ý nhóm”." : "Nhờ Admin / Trưởng phòng tạo nhóm so sánh."} /></Card>
      ) : null}

      {groups && groups.length ? (
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="inline-flex items-center gap-1.5">Nhóm
              <select value={gid} onChange={(e) => setGid(Number(e.target.value))} className="h-8 rounded-md border border-line bg-paper px-2">
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.members.length})</option>)}
              </select>
            </label>
            <div className="flex gap-1 rounded-md border border-line bg-paper p-1">
              {(Object.keys(PERIOD_LABEL) as ComparePeriod[]).map((p) => (
                <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)} className={cn("h-7 rounded px-2.5 font-medium", period === p ? "bg-accent-soft text-accent" : "text-muted hover:text-ink")}>{PERIOD_LABEL[p]}</button>
              ))}
            </div>
            {data?.months.length ? <span className="text-xs text-muted">{data.months.map(mLabel).join(", ")}{period === "this_month" ? " (đến hôm qua)" : ""}</span> : null}
            {data?.can_compute && missing ? <button type="button" onClick={() => void compute()} className="ml-auto inline-flex h-8 items-center rounded-md border border-line bg-paper px-3 text-xs font-medium text-ink hover:bg-inset" title="Admin: tính ngay số liệu cho tài khoản trong nhóm (chỉ đọc Google Ads)">Tính ngay ({missing} chưa có số)</button> : null}
          </div>
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
          {msg ? <p className="text-xs text-muted [overflow-wrap:anywhere]">{msg}</p> : null}
          {data?.conv_note ? <p className="text-xs text-warn">{data.conv_note}</p> : null}
          {group?.hidden_count ? <p className="text-xs text-muted">Nhóm có thêm {group.hidden_count} tài khoản bạn không được xem.</p> : null}
        </Card>
      ) : null}

      {gid && loading && !data ? <Card className="p-4"><TableSkeleton rows={4} cols={7} /></Card> : null}
      {data && data.group ? (
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
                      {!r.has_data ? <span className="mt-0.5 block text-[11px] text-muted" title={r.error || ""}>{r.error ? "Lỗi tính số liệu" : r.computed_at ? "Không có số trong kỳ" : "Chưa có số (tính đêm nay)"}</span> : null}
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
                {!rows.length ? <tr><td colSpan={METRICS.length + 1}><EmptyState title="Nhóm chưa có tài khoản Google nào bạn được xem." /></td></tr> : null}
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
