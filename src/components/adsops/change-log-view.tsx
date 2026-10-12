import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, RefreshCw } from "lucide-react";
import { diagnoseChangeLogFn, pullChangeLogFn, readChangeLogFn } from "@/lib/adsops/change-log.functions";
import {
  ACTION_LABEL_VI,
  CATEGORY_LABEL_VI,
  LEVEL_LABEL_VI,
  MATCH_LABEL_VI,
  DRILL_LABEL_VI,
  categoryOf,
  type ChangeAccountSummary,
  type ChangeDrill,
  type DrillBucket,
  type ChangeCategory,
  type ChangeLogRead,
  type ChangeRow,
} from "@/lib/adsops/change-log.types";
import { addDays, formatRangeVi, moneyPlain, num, statusVi } from "@/lib/adsops/format";
import { formatSaigon } from "@/lib/adsops/permissions.types";
import { cn } from "@/lib/cn";
import { InactiveBadge, InactiveToggle, useActiveFilter } from "@/components/adsops/account-activity";


type ShellClient = { client_id: string; display_name: string; customer_id_dashed?: string; alias?: string | null; adapter?: string };

const NOTE = "Google chỉ cho đọc lại 30 ngày gần nhất; AdsOps lưu lại từ ngày bắt đầu kéo.";

const card = "rounded-xl bg-paper shadow-sheet";
const scrollBox = "relative max-h-[70vh] overflow-auto overscroll-contain rounded-xl border border-line bg-paper shadow-sm";
const th = "sticky top-0 z-10 whitespace-nowrap border-b border-line bg-inset px-3 py-2.5 text-left text-[13px] font-medium text-muted";
const td = "border-b border-line/60 px-3 py-2.5 align-top";
/** Account name: wraps (long tokens too) up to 3 lines; full name on hover. */
const nameCol = "min-w-[220px] max-w-[320px]";
const nameText = "line-clamp-3 [overflow-wrap:anywhere]";

function todaySaigon(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Saigon", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const CLIENT_TYPE_VI: Record<string, string> = {
  GOOGLE_ADS_WEB_CLIENT: "Web",
  GOOGLE_ADS_API: "API",
  GOOGLE_ADS_SCRIPTS: "Script",
  GOOGLE_ADS_AUTOMATED_RULE: "Quy tắc tự động",
  GOOGLE_ADS_RECOMMENDATIONS: "Đề xuất Google",
  GOOGLE_ADS_RECOMMENDATIONS_SUBSCRIPTION: "Tự áp dụng đề xuất",
  GOOGLE_ADS_MOBILE_APP: "App di động",
  GOOGLE_ADS_BULK_UPLOAD: "Tải lên hàng loạt",
  INTERNAL_TOOL: "Google nội bộ",
  SEARCH_ADS_360_SYNC: "SA360",
  SEARCH_ADS_360_POST: "SA360",
  OTHER: "Khác",
};

const PRESETS = [
  { id: "y", label: "Hôm qua", days: 0 },
  { id: "7", label: "7 ngày", days: 7 },
  { id: "14", label: "14 ngày", days: 14 },
  { id: "30", label: "30 ngày", days: 30 },
] as const;

function cidOf(c: ShellClient): string {
  const fromLabel = (c.customer_id_dashed || "").split("·")[0].replace(/\D/g, "");
  if (fromLabel.length === 10) return fromLabel;
  const m = /^tkqc_(\d{10})$/.exec(c.client_id);
  return m ? m[1] : "";
}

function bid(micros: number | null): string {
  return micros == null ? "" : `${moneyPlain(micros / 1_000_000)} đ`;
}

function beforeAfter(r: ChangeRow): string {
  const parts: string[] = [];
  if (r.old_status || r.new_status) parts.push(`${r.old_status ? statusVi(r.old_status) : "—"} → ${r.new_status ? statusVi(r.new_status) : "—"}`);
  if (r.old_bid_micros != null || r.new_bid_micros != null) parts.push(`Giá thầu ${bid(r.old_bid_micros) || "—"} → ${bid(r.new_bid_micros) || "—"}`);
  return parts.join(" · ");
}

type SortKey = "at" | "account" | "user" | "action" | "keyword" | "match" | "level" | "campaign" | "adgroup";

function Seg<T extends string>({ items, value, onChange }: { items: readonly { id: T; label: string }[]; value: T | null; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg border border-line bg-inset p-1 [scrollbar-width:none]" role="group">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          aria-pressed={value === it.id}
          onClick={() => onChange(it.id)}
          className={cn("h-8 shrink-0 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors", value === it.id ? "bg-paper text-ink shadow-sm" : "text-muted hover:text-ink")}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function CoverageBadge({ a }: { a: ChangeAccountSummary }) {
  if (a.coverage === "not_pulled") {
    return <span className="inline-flex rounded-full bg-warn-bg px-2 py-0.5 text-xs font-medium text-warn">Chưa kéo nhật ký</span>;
  }
  if (a.counts && a.counts.optimization_total === 0) {
    return (
      <span className="inline-flex rounded-full bg-danger-bg px-2 py-0.5 text-xs font-semibold text-danger">
        Không có thao tác tối ưu từ khoá{a.coverage === "partial" ? " (đã kéo một phần)" : ""}
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-ok-bg px-2 py-0.5 text-xs font-medium text-ok">
      Có tối ưu{a.coverage === "partial" ? " (đã kéo một phần)" : ""}
    </span>
  );
}

export function ChangeLogView({ clients, clientId, canPull, canDiagnose = false }: { clients: ShellClient[]; clientId: string; canPull: boolean; canDiagnose?: boolean }) {
  const today = todaySaigon();
  const [preset, setPreset] = useState<string | null>("y");
  const [start, setStart] = useState(addDays(today, -1));
  const [end, setEnd] = useState(addDays(today, -1));
  const [scope, setScope] = useState<"current" | "all">("current");
  const [user, setUser] = useState("");
  const [category, setCategory] = useState<ChangeCategory | "">("");
  const [data, setData] = useState<ChangeLogRead | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<Array<{ client_id: string; ok: boolean; text: string }>>([]);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "at", dir: -1 });
  /** Summary cell clicked: rows are limited server-side to that account + bucket. */
  const [drill, setDrill] = useState<ChangeDrill | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);

  // A drill belongs to the account list it was clicked in.
  useEffect(() => {
    setDrill(null);
  }, [clientId, scope]);

  function toggleDrill(next: ChangeDrill) {
    setDrill((cur) => (cur && cur.client_id === next.client_id && cur.bucket === next.bucket ? null : next));
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const labelOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients) m.set(c.client_id, c.alias ? `${c.alias} — ${c.display_name}` : c.display_name);
    return m;
  }, [clients]);
  // customer_id_dashed can be labelled "836-391-8650 · MCC 385-976-8247": read the CID before "·".
  const titleOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients) m.set(c.client_id, [labelOf.get(c.client_id), c.customer_id_dashed].filter(Boolean).join(" · "));
    return m;
  }, [clients, labelOf]);
  const allLiveClients = useMemo(
    () => clients.filter((c) => (c.adapter || "live") === "live" && cidOf(c).length === 10),
    [clients],
  );
  // "Kéo tất cả" covers active accounts unless inactive ones are shown (per-account pull still works).
  const liveClients = useActiveFilter(allLiveClients, (c) => c.client_id).shown || allLiveClients;

  function applyPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPreset(id);
    if (p.days === 0) {
      setStart(addDays(today, -1));
      setEnd(addDays(today, -1));
    } else {
      setStart(addDays(today, -(p.days - 1)));
      setEnd(today);
    }
  }

  useEffect(() => {
    if (!clientId && scope === "current") return;
    if (!start || !end || end < start) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    readChangeLogFn({ data: { clientIds: scope === "current" ? [clientId] : null, start, end, drill } })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setData(null);
          setError(err instanceof Error && err.message ? err.message : "Không đọc được nhật ký.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, scope, start, end, epoch, drill]);

  async function pullOne(id: string): Promise<{ ok: boolean; text: string }> {
    try {
      const r = await pullChangeLogFn({ data: { clientId: id } });
      if (!r.ok) return { ok: false, text: r.error_vi || "Lỗi" };
      const shared = r.shared_rows ? `, ${num(r.shared_rows)} dòng DS phủ định chung` : "";
      return {
        ok: true,
        text: `Đọc được ${num(r.read_count)} thay đổi, lưu ${num(r.keyword_rows)} dòng từ khoá${shared}${r.note_vi ? ` · ${r.note_vi}` : ""}`,
      };
    } catch (err) {
      return { ok: false, text: err instanceof Error && err.message ? err.message : "Lỗi" };
    }
  }

  async function pullCurrent() {
    if (!clientId || busy) return;
    setBusy(true);
    setResults([]);
    setProgress(`Đang kéo nhật ký 30 ngày: ${labelOf.get(clientId) || clientId}…`);
    const r = await pullOne(clientId);
    setResults([{ client_id: clientId, ...r }]);
    setProgress("");
    setBusy(false);
    setEpoch((n) => n + 1);
  }

  async function pullAll() {
    if (busy || !liveClients.length) return;
    setBusy(true);
    setResults([]);
    const out: Array<{ client_id: string; ok: boolean; text: string }> = [];
    for (let i = 0; i < liveClients.length; i++) {
      const c = liveClients[i];
      setProgress(`Đang kéo ${i + 1}/${liveClients.length}: ${labelOf.get(c.client_id) || c.client_id}…`);
      // Sequential, one account per call; an error on one account does not stop the rest.
      const r = await pullOne(c.client_id);
      out.push({ client_id: c.client_id, ...r });
      setResults([...out]);
    }
    setProgress(`Xong ${out.filter((r) => r.ok).length}/${out.length} tài khoản.`);
    setBusy(false);
    setEpoch((n) => n + 1);
  }

  const rows = useMemo(() => {
    // While drilling, rows are exactly the summary cell (server filter); user / type filters pause.
    const drilling = Boolean(drill && data?.drill);
    const list = (data?.rows || []).filter(
      (r) => drilling || ((!user || r.user_email === user) && (!category || categoryOf(r.action) === category)),
    );
    const val = (r: ChangeRow): string => {
      switch (sort.key) {
        case "at":
          return r.at;
        case "account":
          return labelOf.get(r.client_id) || r.client_id;
        case "user":
          return r.user_email || "";
        case "action":
          return ACTION_LABEL_VI[r.action] || r.action;
        case "keyword":
          return r.keyword_text || r.shared_set_name || "";
        case "match":
          return r.match_type || "";
        case "level":
          return LEVEL_LABEL_VI[r.level] || r.level;
        case "campaign":
          return r.campaign_name || "";
        case "adgroup":
          return r.ad_group_name || "";
      }
    };
    return [...list].sort((a, b) => {
      const c = sort.key === "at" ? val(a).localeCompare(val(b)) : val(a).localeCompare(val(b), "vi");
      return (c || b.at.localeCompare(a.at)) * (c ? sort.dir : 1);
    });
  }, [data, user, category, sort, labelOf, drill]);

  function toggle(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "at" ? -1 : 1 }));
  }
  const icon = (key: SortKey) => (sort.key === key ? sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null);
  const head = (key: SortKey, label: string) => (
    <th className={cn(th, key === "account" && nameCol)} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => toggle(key)} className={cn("inline-flex items-center gap-1 hover:text-ink", sort.key === key && "text-ink")}>
        {label} {icon(key)}
      </button>
    </th>
  );

  const act = useActiveFilter(data?.accounts || null, (a) => a.client_id, drill?.client_id);
  const accounts = act.shown || [];
  const drillLoaded = Boolean(drill && data?.drill && data.drill.client_id === drill.client_id && data.drill.bucket === drill.bucket);
  const noOpt = accounts.filter((a) => a.counts && a.counts.optimization_total === 0).length;
  const notPulled = accounts.filter((a) => a.coverage === "not_pulled").length;

  return (
    <div className="flex flex-col gap-4">
      <section className={cn(card, "flex flex-col gap-3 px-4 py-4 md:px-5")}>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold tracking-tight">Nhật ký tối ưu</h2>
            <p className="mt-0.5 text-sm text-muted">
              Từ khoá thêm / tạm dừng / xoá / đổi giá thầu và phủ định — ai làm, ở chiến dịch / nhóm nào. Chỉ đọc, không sửa Google Ads.
            </p>
            <p className="mt-1 text-xs text-subtle">{NOTE}</p>
            {canDiagnose && clientId ? <DiagnosePanel clientId={clientId} /> : null}
          </div>
          {canPull ? (
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !clientId}
                onClick={() => void pullCurrent()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-sm font-medium text-accent-fg shadow-sm hover:opacity-95 disabled:opacity-60"
              >
                <RefreshCw className={cn("size-4", busy && "animate-spin")} /> Kéo nhật ký 30 ngày
              </button>
              <button
                type="button"
                disabled={busy || !liveClients.length}
                onClick={() => void pullAll()}
                className="h-9 rounded-lg border border-line bg-paper px-3.5 text-sm font-medium text-ink hover:bg-inset disabled:opacity-60"
              >
                Kéo tất cả tài khoản ({liveClients.length})
              </button>
            </div>
          ) : null}
        </div>
        {progress ? <p className="text-sm text-muted">{progress}</p> : null}
        {results.length ? (
          <ul className="max-h-48 overflow-auto rounded-lg border border-line bg-inset px-3 py-2 text-xs">
            {results.map((r) => (
              <li key={r.client_id} className="flex gap-2 py-0.5">
                <span className={cn("shrink-0 font-semibold", r.ok ? "text-ok" : "text-danger")}>{r.ok ? "OK" : "Lỗi"}</span>
                <span className="min-w-0 max-w-[22rem] text-ink [overflow-wrap:anywhere]" title={titleOf.get(r.client_id)}>{labelOf.get(r.client_id) || r.client_id}</span>
                <span className="truncate text-muted">{r.text}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Seg items={PRESETS.map((p) => ({ id: p.id, label: p.label }))} value={preset} onChange={applyPreset} />
          <label className="flex h-10 items-center gap-1.5 rounded-lg border border-line bg-paper px-2.5 text-sm">
            <span className="text-xs text-muted">Từ</span>
            <input type="date" value={start} max={end} onChange={(e) => { setPreset(null); setStart(e.target.value); }} className="bg-transparent text-ink outline-none" />
          </label>
          <label className="flex h-10 items-center gap-1.5 rounded-lg border border-line bg-paper px-2.5 text-sm">
            <span className="text-xs text-muted">Đến</span>
            <input type="date" value={end} min={start} max={today} onChange={(e) => { setPreset(null); setEnd(e.target.value); }} className="bg-transparent text-ink outline-none" />
          </label>
          <Seg
            items={[
              { id: "current", label: "Tài khoản đang chọn" },
              { id: "all", label: `Tất cả tài khoản (${clients.length})` },
            ] as const}
            value={scope}
            onChange={setScope}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-10 items-center gap-2 rounded-lg border border-line bg-paper pl-3 pr-1 text-sm">
            <span className="text-xs text-muted">Người thay đổi</span>
            <select value={user} disabled={Boolean(drill)} title={drill ? "Đang lọc theo ô tóm tắt — bấm “Xem tất cả” để dùng lại" : undefined} onChange={(e) => setUser(e.target.value)} className="h-9 max-w-[16rem] truncate bg-transparent text-ink outline-none disabled:opacity-50">
              <option value="">Tất cả</option>
              {(data?.users || []).map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </label>
          <label className="flex h-10 items-center gap-2 rounded-lg border border-line bg-paper pl-3 pr-1 text-sm">
            <span className="text-xs text-muted">Loại</span>
            <select value={category} disabled={Boolean(drill)} title={drill ? "Đang lọc theo ô tóm tắt — bấm “Xem tất cả” để dùng lại" : undefined} onChange={(e) => setCategory(e.target.value as ChangeCategory | "")} className="h-9 bg-transparent text-ink outline-none disabled:opacity-50">
              <option value="">Tất cả</option>
              {(Object.keys(CATEGORY_LABEL_VI) as ChangeCategory[]).map((k) => (
                <option key={k} value={k}>{CATEGORY_LABEL_VI[k]}</option>
              ))}
            </select>
          </label>
          <span className="text-xs text-muted">{formatRangeVi(start, end)} · giờ Việt Nam (Asia/Saigon)</span>
        </div>
      </section>

      {error ? <section className={cn(card, "px-5 py-6 text-sm text-danger")}>{error}</section> : null}

      <section className={cn(card, "flex flex-col gap-3 px-4 py-4 md:px-5")}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-lg font-semibold tracking-tight">Tóm tắt theo tài khoản</h3>
          <InactiveToggle show={act.show} onChange={act.setShow} count={act.inactiveCount} />
          {accounts.length ? (
            <span className="text-xs text-muted">
              {noOpt ? <b className="text-danger">{noOpt} tài khoản không có thao tác tối ưu từ khoá</b> : "Mọi tài khoản đã kéo đều có thao tác"}
              {notPulled ? ` · ${notPulled} tài khoản chưa kéo nhật ký` : ""}
            </span>
          ) : null}
        </div>
        {loading && !data ? (
          <p className="py-6 text-center text-sm text-muted">Đang đọc nhật ký…</p>
        ) : (
          <div className="overflow-auto rounded-lg border border-line">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className={cn(th, nameCol)}>Tài khoản</th>
                  <th className={cn(th, "text-right")}>Từ khoá thêm</th>
                  <th className={cn(th, "text-right")}>Phủ định thêm</th>
                  <th className={cn(th, "text-right")}>Tạm dừng / Xoá</th>
                  <th className={cn(th, "text-right")}>Đổi giá thầu</th>
                  <th className={cn(th, "text-right")}>DS phủ định chung</th>
                  <th className={th}>Tình trạng</th>
                  <th className={th}>Kéo gần nhất</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const c = a.counts;
                  const cell = (n: number | undefined, bucket: DrillBucket) => {
                    if (!c) return "—";
                    if (!n) return num(0);
                    const active = drill?.client_id === a.client_id && drill.bucket === bucket;
                    return (
                      <button
                        type="button"
                        aria-pressed={active}
                        title={active ? "Bấm lần nữa để bỏ lọc" : `Xem ${num(n)} dòng ${DRILL_LABEL_VI[bucket].toLowerCase()}`}
                        onClick={() => toggleDrill({ client_id: a.client_id, bucket })}
                        className={cn(
                          "cursor-pointer rounded px-1.5 py-0.5 font-medium text-accent underline decoration-accent/40 underline-offset-2 transition-colors hover:bg-accent-soft hover:decoration-accent",
                          active && "bg-accent text-accent-fg no-underline hover:bg-accent",
                        )}
                      >
                        {num(n)}
                      </button>
                    );
                  };
                  return (
                    <tr key={a.client_id}>
                      <td className={cn(td, nameCol)}>
                        <span className={cn(nameText, "font-medium text-ink")} title={[a.label, a.customer_id_dashed].filter(Boolean).join(" · ")}>{a.label}</span>
                        <span className="block text-xs text-subtle tabular-nums [overflow-wrap:anywhere]">{a.customer_id_dashed}</span>
                        <InactiveBadge activity={act.map?.[a.client_id]} />
                      </td>
                      <td className={cn(td, "text-right tabular-nums")}>{cell(c?.add_keyword, "add_keyword")}</td>
                      <td className={cn(td, "text-right tabular-nums")}>{cell(c?.add_negative, "add_negative")}</td>
                      <td className={cn(td, "text-right tabular-nums")}>{cell(c?.pause_remove, "pause_remove")}</td>
                      <td className={cn(td, "text-right tabular-nums")}>{cell(c?.bid_change, "bid_change")}</td>
                      <td className={cn(td, "text-right tabular-nums")}>{cell(c?.shared, "shared")}</td>
                      <td className={td}>
                        <CoverageBadge a={a} />
                        {a.coverage === "partial" && a.covered_through ? (
                          <span className="mt-0.5 block text-xs text-subtle">đã kéo đến {formatSaigon(a.covered_through)}</span>
                        ) : null}
                      </td>
                      <td className={cn(td, "whitespace-nowrap text-xs text-muted")}>
                        {a.last_pull_at ? formatSaigon(a.last_pull_at) : "—"}
                        {a.last_pull_ok === false ? <span className="block max-w-[16rem] truncate text-danger" title={a.last_error_vi || ""}>Lỗi: {a.last_error_vi}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section ref={detailRef} className="flex scroll-mt-28 flex-col gap-2">
        {drill ? (
          <div className="flex flex-wrap items-center gap-2 px-1">
            <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-accent-soft px-3 py-1 text-sm text-accent">
              Đang lọc: <b className="font-semibold">{DRILL_LABEL_VI[drill.bucket]}</b> · {labelOf.get(drill.client_id) || drill.client_id} ·{" "}
              <span className="tabular-nums">{drillLoaded ? `${num(rows.length)} dòng` : "…"}</span>
            </span>
            <button
              type="button"
              onClick={() => setDrill(null)}
              className="h-8 rounded-lg border border-line bg-paper px-3 text-sm font-medium text-ink hover:bg-inset"
            >
              Xem tất cả
            </button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h3 className="font-display text-lg font-semibold tracking-tight">Chi tiết thay đổi</h3>
          <span className="text-xs text-muted tabular-nums">
            {num(rows.length)} dòng{data?.truncated ? " · chỉ hiện 3.000 thay đổi mới nhất (tóm tắt vẫn đếm đủ)" : ""}
          </span>
        </div>
        <div className={scrollBox}>
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {head("at", "Thời gian")}
                {head("account", "Tài khoản")}
                {head("user", "Người thay đổi")}
                {head("action", "Hành động")}
                {head("keyword", "Từ khoá")}
                {head("match", "Khớp")}
                {head("level", "Cấp")}
                {head("campaign", "Chiến dịch")}
                {head("adgroup", "Nhóm")}
                <th className={th}>Trước → Sau</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className={cn(td, "whitespace-nowrap tabular-nums text-muted")}>{formatSaigon(r.at)}</td>
                  <td className={cn(td, nameCol)}><span className={nameText} title={titleOf.get(r.client_id) || r.client_id}>{labelOf.get(r.client_id) || r.client_id}</span></td>
                  <td className={td}>
                    <span className="block max-w-[14rem] truncate" title={r.user_email || ""}>
                      {r.user_email || (r.source === "change_status" ? "Google không ghi người" : "—")}
                    </span>
                    {r.client_type ? <span className="text-xs text-subtle">{CLIENT_TYPE_VI[r.client_type] || r.client_type}</span> : null}
                  </td>
                  <td className={cn(td, "whitespace-nowrap font-medium")}>{ACTION_LABEL_VI[r.action] || r.action}</td>
                  <td className={td}>
                    <span className="block max-w-[16rem] truncate font-medium text-ink" title={r.keyword_text || r.shared_set_name || ""}>
                      {r.keyword_text || (r.shared_set_name ? `DS: ${r.shared_set_name}` : "—")}
                    </span>
                  </td>
                  <td className={cn(td, "whitespace-nowrap text-muted")}>{r.match_type ? MATCH_LABEL_VI[r.match_type] || r.match_type : "—"}</td>
                  <td className={cn(td, "whitespace-nowrap text-muted")}>{LEVEL_LABEL_VI[r.level] || r.level}</td>
                  <td className={td}><span className="block max-w-[14rem] truncate text-muted" title={r.campaign_name || ""}>{r.campaign_name || "—"}</span></td>
                  <td className={td}><span className="block max-w-[14rem] truncate text-muted" title={r.ad_group_name || ""}>{r.ad_group_name || "—"}</span></td>
                  <td className={cn(td, "whitespace-nowrap text-muted tabular-nums")}>{beforeAfter(r) || "—"}</td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-sm text-muted">
                    {loading
                      ? "Đang đọc…"
                      : accounts.length && accounts.every((a) => a.coverage === "not_pulled")
                        ? "Chưa kéo nhật ký cho khoảng ngày này. Bấm “Kéo nhật ký 30 ngày”."
                        : "Không có thay đổi từ khoá trong khoảng ngày đã kéo."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Admin-only read-only diagnostic for the selected account (Neon rows + raw GAQL counts). */
function DiagnosePanel({ clientId }: { clientId: string }) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string>("");
  async function run() {
    setBusy(true);
    try {
      const r = await diagnoseChangeLogFn({ data: { clientId } });
      setOut(r.json);
    } catch (err) {
      setOut(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2">
      <button type="button" disabled={busy} onClick={() => void run()} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-ink hover:bg-inset disabled:opacity-60">
        <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> Chẩn đoán (admin)
      </button>
      {out ? (
        <pre className="mt-2 max-h-[50vh] max-w-[min(100%,1100px)] overflow-auto rounded-lg border border-line bg-inset p-3 text-[11px] leading-snug">{out}</pre>
      ) : null}
    </div>
  );
}
