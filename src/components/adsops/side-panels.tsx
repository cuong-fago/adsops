import { Download, Upload } from "lucide-react";
import { useState, type DragEvent } from "react";
import { FinalWorkbook } from "@/components/adsops/final-workbook";
import { Tab12CopyDesk } from "@/components/adsops/tab12-copy";
import { money, num, pct } from "@/lib/adsops/format";
import { pullClientKpis, saveYamlAndProbe, type InstallAndProbeResult, type PullKpisResult } from "@/lib/adsops/connect.functions";
import { cn } from "@/lib/cn";

type AnyRec = Record<string, unknown>;

function asObj(v: unknown): AnyRec {
  return v && typeof v === "object" ? (v as AnyRec) : {};
}

function asArr(v: unknown): AnyRec[] {
  return Array.isArray(v) ? (v as AnyRec[]) : [];
}

function txt(v: unknown) {
  if (v == null || v === "") return "";
  if (typeof v === "boolean") return v ? "Có" : "Không";
  return String(v);
}

function formatProbed(iso: unknown) {
  const raw = String(iso || "");
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return raw;
  return `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}`;
}

function friendlyConnectError(raw: string) {
  if (/ENOENT|spawn python/i.test(raw)) {
    return "Không gọi được bộ Python cũ. Đã chuyển sang gọi Google Ads trực tiếp — bấm lại Lưu trên máy rồi thử gọi.";
  }
  return raw;
}

const ACCOUNT_STATUS_VI: Record<string, string> = {
  ENABLED: "Đang chạy",
  PAUSED: "Tạm dừng",
  CANCELED: "Đã hủy",
  CANCELLED: "Đã hủy",
  REMOVED: "Đã xóa",
  UNKNOWN: "Chưa rõ",
  UNSPECIFIED: "Chưa rõ",
};

const FIELD_ORDER = [
  "target",
  "reason",
  "evidence",
  "source_tab",
  "do_now",
  "risk_if_skipped",
] as const;

const FIELD_LABELS: Record<string, string> = {
  target: "Đối tượng",
  reason: "Lý do",
  evidence: "Bằng chứng",
  source_tab: "Tab nguồn",
  do_now: "Làm ngay?",
  risk_if_skipped: "Rủi ro nếu bỏ qua",
};

const COMPARE_WINDOW_LABELS: Record<string, string> = {
  "1": "Hôm qua — 1 ngày hoàn chỉnh",
  "7": "7 ngày hoàn chỉnh",
  "14": "14 ngày hoàn chỉnh",
  "30": "30 ngày hoàn chỉnh",
  "90": "90 ngày hoàn chỉnh",
};

function fieldsOf(item: AnyRec) {
  const nested = asObj(item.fields);
  const labels = { ...FIELD_LABELS, ...asObj(item.field_labels) };
  return FIELD_ORDER.map((key) => ({
    key,
    label: String(labels[key] || FIELD_LABELS[key]),
    value: nested[key] ?? item[key],
  }));
}

function tone(status: string) {
  const s = status.toUpperCase();
  if (
    s.includes("HARD") ||
    s === "STALE" ||
    s === "FAIL" ||
    s.includes("CONFLICT")
  )
    return "bg-danger-bg text-danger";
  if (
    s === "CONNECTED" ||
    s === "PASS" ||
    s === "READY" ||
    s === "CLEAR" ||
    s === "OK" ||
    s.includes("VERIFIED")
  )
    return "bg-ok-bg text-ok";
  if (
    s.includes("HOLD") ||
    s === "CONDITIONAL" ||
    s === "MISSING_CREDENTIALS" ||
    s === "CLOUD_PROJECT_TEST" ||
    s === "API_VERSION_SUNSET" ||
    s === "ACCOUNT_NOT_FOUND" ||
    s.includes("TOKEN") ||
    s.includes("PERMISSION")
  )
    return "bg-warn-bg text-warn";
  return "bg-inset text-muted";
}

function StatusChip({ value, label }: { value: string; label?: string }) {
  if (!value) return null;
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", tone(value))}>
      {label || value}
    </span>
  );
}

function FileLink({ href, label }: { href?: string; label: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-accent-fg"
    >
      <Download className="size-4" />
      {label}
    </a>
  );
}

function LiveEmpty({
  connect,
  noun,
  guard,
}: {
  connect: AnyRec | null;
  noun: string;
  guard?: AnyRec | null;
}) {
  if (guard && (guard.final_blocked || String(guard.overall) === "HARD_STOP") && !guard.final_generated) {
    return (
      <section className="rounded-xl bg-paper p-5 shadow-sheet">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-xl font-medium tracking-tight">{noun}</h2>
          <StatusChip value={String(guard.overall || "HARD_STOP")} />
        </div>
        <p className="mt-3 rounded-md bg-danger-bg px-4 py-3 text-sm text-danger">
          Không sinh FINAL. {txt(guard.coverage_note) || txt(guard.final_block_reason) || txt(guard.verdict)}
        </p>
        <p className="mt-3 text-sm text-muted">Chỉ đề xuất — không tự apply Google Ads. Mở tab Guard để xem từng cổng.</p>
      </section>
    );
  }
  if (connect && String(connect.adapter) === "live") {
    const pulled = Boolean(connect.pulled_kpis);
    return (
      <section className="rounded-xl bg-paper p-5 shadow-sheet">
        <h2 className="font-display text-xl font-medium tracking-tight">{noun}</h2>
        <p className="mt-2 text-sm text-ink">{txt(connect.title_vi || connect.status)}</p>
        <p className="mt-1 text-sm text-muted">{txt(connect.detail_vi)}</p>
        <p className="mt-3 text-sm text-muted">
          {pulled
            ? "Đã có 5 KPI trên tab Báo cáo. Chưa kéo search term, chưa sinh FINAL."
            : "Chưa kéo ST / FINAL. 5 KPI chỉ kéo khi phiếu ĐÃ NỐI."}
        </p>
      </section>
    );
  }
  return <Empty>{`Chưa có ${noun.toLowerCase()} cho khách này.`}</Empty>;
}

function CompareBox({
  compare,
  kpis,
  currency,
}: {
  compare: AnyRec;
  kpis: { id: string; label: string }[];
  currency: string;
}) {
  const howto = asArr(compare.compare_howto).map((line) => String(line));
  const windows = asObj(compare.windows);
  const ranges = asObj(compare.window_ranges);
  const keys = ["1", "7", "14", "30"].filter((key) => asObj(windows[key]).days);
  return (
    <section className="rounded-xl bg-paper p-5 shadow-sheet">
      <h2 className="font-display text-xl font-medium tracking-tight">Đối chiếu Google Ads</h2>
      <p className="mt-1 text-sm text-muted">
        Cùng tài khoản, cùng cửa sổ ngày, cùng 5 số bìa. Hôm nay không nằm trong số.
      </p>
      {howto.length ? (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink">
          {howto.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      ) : null}
      {keys.map((key) => {
        const w = asObj(windows[key]);
        const rng = asObj(ranges[key]);
        return (
          <div key={key} className="mt-4">
            <p className="text-xs font-medium text-muted">
              {COMPARE_WINDOW_LABELS[key] || `${key} ngày`}
              {rng.start ? ` · ${txt(rng.start)} → ${txt(rng.end)}` : ""}
            </p>
            <KpiGrid kpis={kpis.length ? kpis : fallbackKpis} values={w} currency={currency} />
          </div>
        );
      })}
    </section>
  );
}

export function ReportPanel({
  data,
  live,
  clientId,
  onPulled,
  viewer,
}: {
  data: AnyRec | null;
  live?: boolean;
  clientId?: string;
  viewer?: boolean;
  onPulled?: (pack: {
    report?: AnyRec | null;
    compare?: AnyRec | null;
    connect?: AnyRec | null;
    hub?: AnyRec | null;
  }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  if (!data) return <Empty>Chưa có bìa báo cáo cho khách này.</Empty>;
  const kpis = asArr(data.kpis) as { id: string; label: string }[];
  const cadences = asObj(data.cadences);
  const daily = asObj(cadences.daily);
  const weekly = asObj(cadences.weekly);
  const primary = asObj(daily.primary);
  const weekPrimary = asObj(weekly.primary);
  const cpa = asObj(data.cpa_note);
  const currency = String(data.currency || "VND");
  const compare = asObj(data.compare);
  const hasCompare = Boolean(compare.windows);

  async function refreshKpis() {
    if (!clientId) return;
    setBusy(true);
    setFormError("");
    try {
      const result = (await pullClientKpis({ data: { clientId } })) as PullKpisResult;
      if (result.error_vi) setFormError(result.error_vi);
      if (result.ok) {
        onPulled?.({
          report: (result.report as AnyRec) || null,
          compare: (result.compare as AnyRec) || null,
          connect: (result.connect as AnyRec) || null,
          hub: (result.hub as AnyRec) || null,
        });
      }
    } catch {
      setFormError("Không kéo được 5 KPI. Không dán token vào chat.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {hasCompare ? (
        <CompareBox compare={compare} kpis={kpis.length ? kpis : fallbackKpis} currency={currency} />
      ) : null}
      <section className="rounded-xl bg-paper p-5 shadow-sheet">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-medium tracking-tight">Bìa 5 KPI</h2>
            <p className="mt-1 text-sm text-muted">{txt(data.banner)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!viewer && live && clientId ? (
              <button
                type="button"
                onClick={() => void refreshKpis()}
                disabled={busy}
                className="inline-flex h-11 items-center rounded-full bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-60"
              >
                {busy ? "Đang kéo 5 KPI…" : "Kéo lại 5 KPI"}
              </button>
            ) : null}
            {!viewer ? (
              <>
                <FileLink href={txt(daily.xlsx_href) || undefined} label="Tải Daily" />
                <FileLink href={txt(weekly.xlsx_href) || undefined} label="Tải Weekly" />
              </>
            ) : null}
          </div>
        </div>
        <p className="mt-2 text-sm text-muted">{txt(data.conversion_note)}</p>
        {formError ? <p className="mt-2 text-sm text-danger">{formError}</p> : null}
        <p className="mt-3 text-xs font-medium text-muted">{txt(daily.period_label) || "Hàng ngày"}</p>
        <KpiGrid kpis={kpis} values={primary} currency={currency} />
        <ul className="mt-5 space-y-2 text-sm text-ink">
          {asArr(daily.narrative)
            .map((line) => String(line))
            .slice(0, 5)
            .map((line) => (
              <li key={line}>{line}</li>
            ))}
        </ul>
        {cpa.google_7d != null && (
          <p className="mt-4 rounded-md bg-inset px-3 py-2 text-sm text-muted">
            Chi/conv Google {money(Number(cpa.google_7d), currency)} — không phải Qualified Lead.
            {cpa.sale_7d != null
              ? ` Chi/lead sale xác nhận ${money(Number(cpa.sale_7d), currency)}. Không trộn.`
              : ""}
          </p>
        )}
      </section>
      <section className="rounded-xl bg-paper p-5 shadow-sheet">
        <h3 className="font-display text-lg font-medium tracking-tight">Tuần — cùng 5 KPI</h3>
        <p className="mt-1 text-sm text-muted">{txt(weekly.period_label)}</p>
        <KpiGrid kpis={kpis} values={weekPrimary} currency={currency} />
      </section>
    </div>
  );
}

function KpiGrid({
  kpis,
  values,
  currency,
}: {
  kpis: { id: string; label: string }[];
  values: AnyRec;
  currency: string;
}) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
      {kpis.map((k) => {
        const raw = values[k.id];
        const empty = raw == null || raw === "";
        let shown = "—";
        if (!empty) {
          if (k.id === "cost" || k.id === "cpc") shown = money(Number(raw), currency);
          else if (k.id === "conversions") shown = num(Number(raw), 2);
          else shown = num(Number(raw), 0);
        }
        return (
          <div key={k.id} className="rounded-md bg-inset px-3 py-3">
            <div className="text-xs text-muted">{k.label}</div>
            <div className="mt-1 text-lg font-medium tabular-nums">{shown}</div>
          </div>
        );
      })}
    </div>
  );
}

export function AlertsPanel({ data }: { data: AnyRec | null }) {
  if (!data) return <Empty>Chưa có cảnh báo Guard.</Empty>;
  const alerts = asArr(data.alerts);
  const journal = asArr(data.journal);
  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl bg-paper p-5 shadow-sheet">
        <h2 className="font-display text-xl font-medium tracking-tight">Cảnh báo Guard</h2>
        <p className="mt-1 text-sm text-muted">
          {txt(data.overall_label)}. Stale / conv = 0 / coverage — không gồm ngân sách 1 ngày.
        </p>
        {alerts.length === 0 ? (
          <p className="mt-4 rounded-md bg-ok-bg px-4 py-3 text-sm text-ok">
            Không có phiếu Guard trên khách này.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {alerts.map((a, i) => (
              <li key={txt(a.code) || i} className="rounded-md bg-danger-bg px-4 py-3">
                <p className="font-medium">{txt(a.title)}</p>
                <p className="mt-1 text-sm">{txt(a.message)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-xl bg-paper p-5 shadow-sheet">
        <h3 className="font-display text-lg font-medium tracking-tight">Nhật ký xuất</h3>
        <p className="mt-1 text-sm text-muted">Chỉ file của khách đang chọn. Chọn A không thấy số B.</p>
        <ul className="mt-3 divide-y divide-line text-sm">
          {journal.map((row, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-2 py-2">
              <span>
                {txt(row.artifact)} · {txt(row.filename)}
              </span>
              <span className="text-muted">{txt(row.exported_at)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function GuardPanel({ data }: { data: AnyRec | null }) {
  if (!data) return <Empty>Chưa có Measurement Guard.</Empty>;
  const checks = asArr(data.checks);
  const cpa = asObj(data.cpa);
  const currency = String(data.currency || cpa.currency || "VND");
  const blocked = Boolean(data.large_actions_blocked);
  const classified = Number(data.classified_search_terms || 0);
  const total = Number(data.total_search_terms || 0);
  const rows = Number(data.search_term_rows || 0);
  return (
    <section className="rounded-xl bg-paper p-5 shadow-sheet">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-xl font-medium tracking-tight">Measurement Guard</h2>
        <StatusChip value={txt(data.overall)} />
        <StatusChip value={txt(data.source_flag)} />
      </div>
      <p className="mt-1 text-sm text-muted">{txt(data.overall_label)}</p>
      {blocked ? (
        <p className="mt-3 rounded-md bg-danger-bg px-4 py-3 text-sm text-danger">
          Việc lớn bị chặn. {txt(data.coverage_note) || txt(data.verdict)}
        </p>
      ) : (
        <p className="mt-3 rounded-md bg-ok-bg px-4 py-3 text-sm text-ok">{txt(data.verdict)}</p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-md bg-inset px-3 py-3">
          <div className="text-xs text-muted">Coverage ST</div>
          <div className="mt-1 text-lg font-medium tabular-nums">{pct(Number(data.search_term_coverage || 0))}</div>
          <div className="text-xs text-muted">
            {classified}/{total} cụm
            {rows && rows !== total ? ` · ${rows} dòng` : ""}
          </div>
        </div>
        <div className="rounded-md bg-inset px-3 py-3">
          <div className="text-xs text-muted">CPA Google 7N</div>
          <div className="mt-1 text-lg font-medium tabular-nums">
            {cpa.google_7d == null ? "—" : money(Number(cpa.google_7d), currency)}
          </div>
          <div className="text-xs text-muted">Không phải Qualified Lead</div>
        </div>
        <div className="rounded-md bg-inset px-3 py-3">
          <div className="text-xs text-muted">CPA Sale 7N</div>
          <div className="mt-1 text-lg font-medium tabular-nums">
            {cpa.sale_7d == null ? "Chưa có" : money(Number(cpa.sale_7d), currency)}
          </div>
          <div className="text-xs text-muted">Tách khỏi CPA Google</div>
        </div>
        <div className="rounded-md bg-inset px-3 py-3">
          <div className="text-xs text-muted">FINAL</div>
          <div className="mt-1 text-lg font-medium">{data.final_blocked ? "Không sinh" : "Chỉ đề xuất"}</div>
          <div className="text-xs text-muted">Không apply Google Ads</div>
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {checks.map((c) => (
          <li key={txt(c.name)} className="rounded-md bg-inset px-3 py-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <span className="font-medium">{txt(c.label)}</span>
              <StatusChip value={txt(c.status)} />
            </div>
            <p className="mt-1 text-muted">{txt(c.detail)}</p>
            {c.blocks_large_actions && c.status !== "PASS" ? (
              <p className="mt-1 text-xs text-danger">Chặn việc lớn</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HubPanel({ data }: { data: AnyRec | null }) {
  if (!data) return <Empty>Chưa có Data Hub.</Empty>;
  const windows = asObj(data.windows);
  const kpis = asArr(data.kpis) as { id: string; label: string }[];
  const currency = String(data.currency || "VND");
  const keys = ["1", "7", "14", "30", "90"].filter((key) => asObj(windows[key]).days);
  const opt = asObj(data.opt_sources);
  const tables = asArr(opt.tables);
  const preview = asArr(opt.search_term_preview);
  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl bg-paper p-5 shadow-sheet">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-medium tracking-tight">Nguồn tối ưu Drive</h2>
            <p className="mt-1 text-sm text-muted">
              Folder {txt(opt.folder_name) || "chưa gắn"} · {txt(opt.dialect) || "ops_drive_v1"}
            </p>
          </div>
          <StatusChip value={txt(opt.flag)} label={txt(opt.flag) || "Chưa kéo"} />
        </div>
        <p className="mt-2 text-sm text-muted">
          {txt(opt.rule) || "Lệch cột = SOURCE-CONFLICT — không đoán, không trộn vào 5 KPI."} Chỉ đề
          xuất. Coverage ST {pct(Number(opt.search_term_coverage || 0))} — chưa 100% thì không việc
          lớn.
        </p>
        {tables.length === 0 ? (
          <p className="mt-4 text-sm text-muted">Chưa gắn ST / phủ định / RSA cho khách này.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {tables.map((table) => (
              <li key={txt(table.id)} className="rounded-md bg-inset px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{txt(table.label || table.id)}</p>
                  <StatusChip value={txt(table.flag)} />
                </div>
                <p className="mt-1 text-sm text-muted">
                  {txt(table.rows)} dòng
                  {txt(table.notes) ? ` · ${txt(table.notes)}` : ""}
                </p>
                {asArr(table.missing_columns).length > 0 && (
                  <p className="mt-1 text-sm text-danger">
                    Thiếu cột: {asArr(table.missing_columns).map(txt).join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {preview.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-subtle">Cụm từ (xem trước)</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {preview.map((row, i) => (
                <li key={`${txt(row.query)}-${i}`} className="flex flex-wrap gap-x-2">
                  <span className="font-medium">{txt(row.query)}</span>
                  <span className="text-muted">{txt(row.campaign_name)}</span>
                  <span className="text-subtle">{txt(row.label)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-xl bg-paper p-5 shadow-sheet">
        <h2 className="font-display text-xl font-medium tracking-tight">Data Hub · 5 KPI</h2>
        <p className="mt-1 text-sm text-muted">
          {txt(data.day_count)} ngày · {txt(data.date_start)} → {txt(data.data_through)} · 5 KPI{" "}
          {txt(data.adapter)}
        </p>
        <p className="mt-1 text-sm text-muted">5 KPI kho — không trộn All conversions. Không trộn nguồn Drive.</p>
        {keys.map((key) => {
          const w = asObj(windows[key]);
          return (
            <div key={key} className="mt-4">
              <p className="text-xs font-medium text-muted">
                {COMPARE_WINDOW_LABELS[key] || `${key} ngày`}
              </p>
              <KpiGrid kpis={kpis.length ? kpis : fallbackKpis} values={w} currency={currency} />
            </div>
          );
        })}
      </section>
    </div>
  );
}

const fallbackKpis = [
  { id: "cost", label: "Chi tiêu" },
  { id: "impressions", label: "Hiển thị" },
  { id: "clicks", label: "Lượt nhấp" },
  { id: "conversions", label: "Chuyển đổi" },
  { id: "cpc", label: "CPC" },
];

export function ProposalsPanel({ data }: { data: AnyRec | null }) {
  if (!data) return <Empty>Chưa có máy đề xuất.</Empty>;
  const items = asArr(data.proposals).length ? asArr(data.proposals) : asArr(data.ready);
  const ready = items.filter((p) => txt(p.status) === "READY");
  const largeReady = ready.filter((p) => p.is_large);
  const smallReady = ready.filter((p) => !p.is_large);
  const conditional = items.filter((p) => txt(p.status) === "CONDITIONAL");
  const holds = items.filter((p) => txt(p.kind) === "hold");
  const coverage = Number(asObj(data.guard).search_term_coverage ?? data.search_term_coverage ?? 0);
  const classified = Number(asObj(data.guard).classified_search_terms ?? 0);
  const total = Number(asObj(data.guard).total_search_terms ?? 0);
  const finalBlocked = Boolean(data.final_blocked);
  const guardOverall = txt(asObj(data.guard).overall);
  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl bg-paper p-5 shadow-sheet">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-medium tracking-tight">Máy đề xuất</h2>
            <p className="mt-1 text-sm text-muted">
              Chỉ đề xuất — không tự apply Google Ads. CPA Google không phải Qualified Lead.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {guardOverall ? <StatusChip value={guardOverall} /> : null}
            <StatusChip value="CHỈ ĐỀ XUẤT" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-md bg-inset px-3 py-3">
            <div className="text-xs text-muted">Coverage ST</div>
            <div className="mt-1 text-lg font-medium tabular-nums">{pct(coverage)}</div>
            <div className="text-xs text-muted">
              {classified}/{total || "—"} cụm đã phân loại
            </div>
          </div>
          <div className="rounded-md bg-inset px-3 py-3">
            <div className="text-xs text-muted">Việc lớn READY</div>
            <div className="mt-1 text-lg font-medium tabular-nums">{largeReady.length}</div>
            <div className="text-xs text-muted">Exact / phủ định / shield</div>
          </div>
          <div className="rounded-md bg-inset px-3 py-3">
            <div className="text-xs text-muted">QA nhỏ READY</div>
            <div className="mt-1 text-lg font-medium tabular-nums">{smallReady.length}</div>
            <div className="text-xs text-muted">Không dựa search term</div>
          </div>
          <div className="rounded-md bg-inset px-3 py-3">
            <div className="text-xs text-muted">FINAL</div>
            <div className="mt-1 text-lg font-medium">{finalBlocked ? "Không sinh" : "Chỉ đề xuất"}</div>
            <div className="text-xs text-muted">Không nút Apply Ads</div>
          </div>
        </div>
        {finalBlocked || txt(data.verdict) ? (
          <p className={`mt-4 rounded-md px-4 py-3 text-sm ${finalBlocked ? "bg-danger-bg text-danger" : "bg-ok-bg text-ok"}`}>
            {txt(data.coverage_note) || txt(data.final_block_reason) || txt(data.verdict)}
          </p>
        ) : null}
      </section>

      {holds.length > 0 && (
        <section className="rounded-xl bg-paper p-5 shadow-sheet">
          <h3 className="font-display text-lg font-medium tracking-tight">Cổng đang chặn</h3>
          <p className="mt-1 text-sm text-muted">Mỗi việc đủ 6 trường. Không copy HOLD / HARD_STOP vào Google Ads.</p>
          <ul className="mt-4 space-y-3">
            {holds.map((p, i) => (
              <li key={`hold-${i}`} className="rounded-md bg-inset px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{txt(p.kind_label || p.kind)}</p>
                  <StatusChip value={txt(p.status)} />
                </div>
                <SixFields item={p} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {smallReady.length > 0 && (
        <section className="rounded-xl bg-paper p-5 shadow-sheet">
          <h3 className="font-display text-lg font-medium tracking-tight">Việc nhỏ READY</h3>
          <p className="mt-1 text-sm text-muted">
            QA / gỡ whitelist — không phải việc lớn dựa trên ST.
            {finalBlocked ? " Coverage chưa 100% thì không đưa vào FINAL." : " Copy tay — AdsOps không tự apply."}
          </p>
          <ul className="mt-4 space-y-3">
            {smallReady.map((p, i) => (
              <li key={`small-${i}`} className="rounded-md bg-inset px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{txt(p.kind_label || p.kind)}</p>
                  <StatusChip value={txt(p.status)} />
                </div>
                <SixFields item={p} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {largeReady.length > 0 && (
        <section className="rounded-xl bg-paper p-5 shadow-sheet">
          <h3 className="font-display text-lg font-medium tracking-tight">Việc lớn READY</h3>
          <p className="mt-1 text-sm text-muted">Copy tay. AdsOps không tự apply.</p>
          <ul className="mt-4 space-y-3">
            {largeReady.map((p, i) => (
              <li key={`large-${i}`} className="rounded-md bg-inset px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{txt(p.kind_label || p.kind)}</p>
                  <StatusChip value={txt(p.status)} />
                </div>
                <SixFields item={p} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {conditional.length > 0 && (
        <section className="rounded-xl bg-paper p-5 shadow-sheet">
          <h3 className="font-display text-lg font-medium tracking-tight">Cần duyệt</h3>
          <p className="mt-1 text-sm text-muted">CONDITIONAL — trưởng phòng Ads duyệt. Không vào Tab 12.</p>
          <ul className="mt-4 space-y-3">
            {conditional.map((p, i) => (
              <li key={`cond-${i}`} className="rounded-md bg-inset px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{txt(p.kind_label || p.kind)}</p>
                  <StatusChip value={txt(p.status)} />
                </div>
                <SixFields item={p} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {items.length === 0 && (
        <section className="rounded-xl bg-paper p-5 shadow-sheet">
          <p className="rounded-md bg-warn-bg px-4 py-3 text-sm text-warn">
            Không có việc READY. Guard đang chặn hoặc nguồn không đủ.
          </p>
        </section>
      )}
    </div>
  );
}

export function FinalPanel({
  data,
  connect,
  guard,
}: {
  data: AnyRec | null;
  connect?: AnyRec | null;
  guard?: AnyRec | null;
}) {
  if (!data) return <LiveEmpty connect={connect || null} noun="Gói FINAL" guard={guard} />;
  if (data.workbook) {
    return <FinalWorkbook data={data} />;
  }
  const tab0 = asObj(data.tab0);
  const tab12 = asObj(data.tab12);
  const top5 = asArr(tab0.top5);
  const rows = asArr(tab12.rows);
  const windows = asObj(tab0.windows);
  const currency = String(data.currency || "VND");

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl bg-paper p-5 shadow-sheet">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-medium tracking-tight">Gói FINAL · Tab 0</h2>
            <p className="mt-1 text-sm text-muted">{txt(tab0.banner || data.banner)}</p>
          </div>
          <FileLink href={txt(data.xlsx_href) || undefined} label="Tải file FINAL" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <StatusChip value={`Guard ${txt(tab0.guard || "")}`} />
          <span className="rounded-full bg-inset px-2.5 py-0.5 text-xs">
            Coverage ST {pct(Number(tab0.search_term_coverage || 0))}
          </span>
          <span className="rounded-full bg-inset px-2.5 py-0.5 text-xs">{txt(tab0.source_flag)}</span>
        </div>
        {txt(tab0.hold_note) ? (
          <p className="mt-3 rounded-md bg-warn-bg px-4 py-3 text-sm text-warn">{txt(tab0.hold_note)}</p>
        ) : null}
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {["7", "14", "30"].map((key) => {
            const w = asObj(windows[key]);
            if (!w.days) return null;
            return (
              <div key={key} className="rounded-md bg-inset px-3 py-3 text-sm">
                <p className="text-xs text-muted">{key} ngày</p>
                <p className="mt-1 font-medium tabular-nums">{money(Number(w.cost || 0), currency)}</p>
                <p className="text-muted">
                  {num(Number(w.clicks || 0))} click · {num(Number(w.conversions || 0), 2)} conv
                </p>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-muted">
          CPA Google {money(Number(tab0.cpa_google_7d), currency)} ≠ Qualified Lead
          {tab0.cpa_sale_7d != null
            ? ` · CPA Sale ${money(Number(tab0.cpa_sale_7d), currency)}`
            : ""}
          .
        </p>
      </section>

      <section className="rounded-xl bg-paper p-5 shadow-sheet">
        <h3 className="font-display text-lg font-medium tracking-tight">5 việc — đủ 6 trường</h3>
        <ol className="mt-3 space-y-3">
          {top5.map((job) => (
            <li key={txt(job.index)} className="rounded-md bg-inset px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {txt(job.index)}. {txt(job.kind_label || job.kind)}
                </span>
                <StatusChip value={txt(job.status)} />
              </div>
              <SixFields item={job} />
            </li>
          ))}
        </ol>
        {top5.length === 0 && (
          <p className="mt-3 text-sm text-muted">Không có việc trên Tab 0 — Guard đang chặn.</p>
        )}
      </section>

      <section className="rounded-xl bg-paper p-5 shadow-sheet">
        <h3 className="font-display text-lg font-medium tracking-tight">Tab 12 — copy theo nhóm quảng cáo</h3>
        <p className="mt-1 text-sm text-muted">{txt(tab12.banner)}</p>
        {rows.length === 0 ? (
          <p className="mt-4 rounded-md bg-warn-bg px-4 py-3 text-sm text-warn">
            Tab 12 trống. Không copy HOLD / HARD_STOP vào Google Ads.
          </p>
        ) : (
          <div className="mt-4">
            <Tab12CopyDesk
              clientId={txt(data.client_id)}
              headers={[
                "LOẠI HÀNH ĐỘNG",
                "Campaign",
                "Ad Group nguồn / nơi áp dụng",
                "Từ khóa / Negative / Asset",
                "Match",
                "CÚ PHÁP COPY",
                "DÁN VÀO",
              ]}
              rows={rows.map((row) => {
                const term = txt(row.criterion_or_keyword);
                const match = txt(row.match);
                const ml = match.toLowerCase();
                const syntax =
                  ml.includes("chính xác") || ml === "exact"
                    ? `[${term}]`
                    : ml.includes("cụm") || ml === "phrase"
                      ? `"${term}"`
                      : term;
                return [
                  txt(row.action),
                  txt(row.campaign),
                  txt(row.ad_group),
                  term,
                  match,
                  syntax,
                  txt(row.note),
                ];
              })}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function SixFields({ item }: { item: AnyRec }) {
  return (
    <dl className="mt-2 grid gap-2 text-sm md:grid-cols-2">
      {fieldsOf(item).map((f) => (
        <div key={f.key}>
          <dt className="text-xs text-muted">{f.label}</dt>
          <dd className="mt-0.5 text-pretty">{txt(f.value) || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SopPanel({ data }: { data: AnyRec | null }) {
  if (!data) return <Empty>Chưa có SOP.</Empty>;
  const sections = asArr(data.sections);
  const forbid = asArr(data.forbid).map(String);
  return (
    <section className="rounded-xl bg-paper p-5 shadow-sheet">
      <h2 className="font-display text-xl font-medium tracking-tight">{txt(data.title)}</h2>
      <p className="mt-1 text-sm text-muted">{txt(data.lead)}</p>
      {forbid.length > 0 && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
          {forbid.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <div className="mt-5 space-y-5">
        {sections.map((s) => (
          <article key={txt(s.id)}>
            <h3 className="font-medium">{txt(s.title)}</h3>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-muted">{txt(s.body)}</pre>
          </article>
        ))}
      </div>
    </section>
  );
}

export function ConnectPanel({
  data,
  clientId,
  live,
  onConnectResult,
  onKpiPulled,
}: {
  data: AnyRec | null;
  clientId?: string;
  live?: boolean;
  onConnectResult?: (snap: AnyRec) => void;
  onKpiPulled?: (pack: {
    report?: AnyRec | null;
    compare?: AnyRec | null;
    connect?: AnyRec | null;
    hub?: AnyRec | null;
  }) => void;
}) {
  const [fileName, setFileName] = useState("");
  const [yamlText, setYamlText] = useState("");
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [busy, setBusy] = useState<"save" | "probe" | "kpi" | null>(null);
  const [formError, setFormError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  if (!data) return <Empty>Chưa có thông tin kết nối.</Empty>;
  const checks = asArr(data.checklist);
  const status = String(data.status || "");
  const statusVi =
    {
      CONNECTED: "ĐÃ NỐI",
      MISSING_CREDENTIALS: "CHƯA CÓ QUYỀN",
      FIXTURE: "KHÁCH GIẢ",
      PERMISSION_DENIED: "BỊ TỪ CHỐI QUYỀN",
      TOKEN_EXPIRED: "TOKEN HẾT HẠN",
      CLOUD_PROJECT_TEST: "PROJECT CLOUD CHƯA ĐỦ CẤP",
      DEVELOPER_TOKEN_BLOCKED: "TOKEN NHÀ PHÁT TRIỂN BỊ CHẶN",
      API_VERSION_SUNSET: "BẢN API ĐÃ TẮT",
      ACCOUNT_NOT_FOUND: "KHÔNG TÌM THẤY TÀI KHOẢN",
    }[status] || status;
  const yamlPresent = Boolean(data.yaml_file_present);
  const probed = formatProbed(data.probed_at);
  const showIntake = Boolean(live && clientId);
  const connected = status === "CONNECTED";
  const pulledKpis = Boolean(data.pulled_kpis);
  const hasIntake = Boolean(
    yamlText.trim() || oauthClientId.trim() || oauthClientSecret.trim() || refreshToken.trim(),
  );
  const mccRows = asArr(data.mcc_accounts);
  const mccAds = mccRows.filter((a) => !a.is_manager);

  function clearSecrets() {
    setYamlText("");
    setFileName("");
    setOauthClientId("");
    setOauthClientSecret("");
    setRefreshToken("");
  }

  async function run(save: boolean) {
    if (!clientId) return;
    if (save && !hasIntake) {
      setFormError("Kéo file yaml hoặc điền 3 ô OAuth trước khi lưu. Không dán token vào chat.");
      return;
    }
    setBusy(save ? "save" : "probe");
    setFormError("");
    try {
      const result = (await saveYamlAndProbe({
        data: {
          clientId,
          yamlText: save ? yamlText : "",
          developerToken: "",
          oauthClientId: save ? oauthClientId : "",
          oauthClientSecret: save ? oauthClientSecret : "",
          refreshToken: save ? refreshToken : "",
          save,
        },
      })) as InstallAndProbeResult;
      if (result.error_vi) setFormError(friendlyConnectError(result.error_vi));
      if (result.connect) onConnectResult?.(result.connect);
      if (save && result.install?.ok) clearSecrets();
    } catch {
      setFormError("Không thử được. Token không hiện ra đây — thử lại trên màn này, đừng dán chat.");
    } finally {
      setBusy(null);
    }
  }

  async function runKpis() {
    if (!clientId) return;
    setBusy("kpi");
    setFormError("");
    try {
      const result = (await pullClientKpis({ data: { clientId } })) as PullKpisResult;
      if (result.error_vi) setFormError(result.error_vi);
      if (result.connect) onConnectResult?.(result.connect as AnyRec);
      if (result.ok) {
        onKpiPulled?.({
          report: (result.report as AnyRec) || null,
          compare: (result.compare as AnyRec) || null,
          connect: (result.connect as AnyRec) || null,
          hub: (result.hub as AnyRec) || null,
        });
      }
    } catch {
      setFormError("Không kéo được 5 KPI. Không dán token vào chat.");
    } finally {
      setBusy(null);
    }
  }

  function acceptYaml(file: File | undefined) {
    if (!file) return;
    const name = file.name || "google-ads.yaml";
    if (!/\.(ya?ml)$/i.test(name) && file.type && !/yaml|text\/plain/i.test(file.type)) {
      setFormError("Chỉ nhận file .yaml / .yml. Không dán token vào chat.");
      return;
    }
    setFormError("");
    setFileName(name);
    const reader = new FileReader();
    reader.onload = () => {
      setYamlText(typeof reader.result === "string" ? reader.result : "");
    };
    reader.readAsText(file);
  }

  function onDragOverZone(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }

  function onDragLeaveZone(e: DragEvent) {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
  }

  function onDropZone(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    acceptYaml(e.dataTransfer.files?.[0]);
  }

  return (
    <section className="rounded-xl bg-paper p-5 shadow-sheet">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-xl font-medium tracking-tight">Kết nối Ads</h2>
        <StatusChip value={status} label={statusVi} />
      </div>
      <p className="mt-2 text-sm">{txt(data.title_vi || data.status)}</p>
      <p className="mt-1 text-sm text-muted">{txt(data.detail_vi)}</p>
      {data.customer_id_dashed ? (
        <p className="mt-3 text-sm tabular-nums">
          Customer ID {txt(data.customer_id_dashed)}
          {data.mcc_id_dashed ? ` · MCC ${txt(data.mcc_id_dashed)}` : ""}
          {data.mcc_display_name ? ` · ${txt(data.mcc_display_name)}` : ""}
        </p>
      ) : null}
      {mccRows.length ? (
        <div className="mt-4 overflow-x-auto">
          <p className="mb-2 text-sm">
            MCC {txt(data.mcc_display_name) || "Fago Agency"} {txt(data.mcc_id_dashed)}: {mccAds.length} tài
            khoản quảng cáo
            {data.roster_complete ? " — đã kéo từ MCC." : " — danh sách chưa đủ, không đoán tên."}
          </p>
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-subtle">
                <th className="py-2 pr-3 font-medium">Tài khoản</th>
                <th className="py-2 pr-3 font-medium">Customer ID</th>
                <th className="py-2 pr-3 font-medium">Loại</th>
                <th className="py-2 font-medium">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {mccRows.map((row) => (
                <tr
                  key={txt(row.client_id) || txt(row.customer_id)}
                  className="border-b border-line"
                >
                  <td className="py-2 pr-3">{txt(row.display_name || row.account_name)}</td>
                  <td className="py-2 pr-3 tabular-nums">{txt(row.customer_id_dashed)}</td>
                  <td className="py-2 pr-3">{row.is_manager ? "MCC" : "QC"}</td>
                  <td className="py-2">
                    {ACCOUNT_STATUS_VI[String(row.status || "").toUpperCase()] ||
                      txt(row.status) ||
                      "Chưa rõ"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : data.mcc_id_dashed ? (
        <p className="mt-2 rounded-md bg-warn-bg px-3 py-2 text-sm text-warn">
          MCC {txt(data.mcc_display_name) || "Fago Agency"} {txt(data.mcc_id_dashed)}: lần thử API
          thấy {txt(data.accessible_count) || "?"} tài khoản truy cập được. Chỉ hiện tài khoản đã có
          customer ID xác nhận. Không đoán CID còn lại. Điền 3 ô OAuth rồi bấm Lưu trên máy rồi thử
          gọi — không dán token vào chat.
        </p>
      ) : null}
      <ul className="mt-3 space-y-1 text-sm">
        <li>
          File cấu hình trên máy:{" "}
          <span className={yamlPresent ? "text-ok" : "text-warn"}>{yamlPresent ? "có" : "chưa có"}</span>
          {yamlPresent ? " (không hiện nội dung)" : ""}
        </li>
        {probed ? <li className="text-muted">Lần thử gần nhất: {probed}</li> : null}
        <li className="text-muted">
          5 KPI: {pulledKpis ? "đã kéo" : "chưa kéo"} · Search term: chưa kéo
        </li>
      </ul>
      <p className="mt-2 text-sm text-muted">{txt(data.next_step_vi)}</p>
      {connected ? (
        <p className="mt-3 rounded-md bg-ok-bg px-3 py-2 text-sm text-ok">
          Phiếu ghi ĐÃ NỐI. {pulledKpis ? "Đã kéo 5 KPI — mở tab Báo cáo để đối chiếu UI." : "Có thể kéo 5 KPI để đối chiếu. Chưa kéo search term."}
        </p>
      ) : (
        <p className="mt-3 rounded-md bg-warn-bg px-3 py-2 text-sm text-warn">
          Chưa ĐÃ NỐI — không đối chiếu 5 KPI, không kéo search term, không sinh FINAL.
        </p>
      )}
      {connected && live && clientId ? (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void runKpis()}
          className="mt-4 h-11 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-60"
        >
          {busy === "kpi" ? "Đang kéo 5 KPI…" : pulledKpis ? "Kéo lại 5 KPI" : "Kéo 5 KPI để đối chiếu"}
        </button>
      ) : null}
      <ul className="mt-4 space-y-2">
        {checks.map((c) => (
          <li
            key={txt(c.id)}
            className="flex items-center justify-between gap-3 rounded-md bg-inset px-3 py-2 text-sm"
          >
            <span>{txt(c.label_vi)}</span>
            <span
              className={
                c.present ? "text-ok" : c.required === false ? "text-subtle" : "font-medium text-warn"
              }
            >
              {txt(c.state_vi) || (c.present ? "Có" : c.required === false ? "Không bắt buộc" : "Thiếu")}
            </span>
          </li>
        ))}
      </ul>
      {showIntake ? (
        <div className="mt-5 border-t border-line pt-5">
          <h3 className="font-medium">Đặt quyền trên máy này</h3>
          <p className="mt-1 text-sm text-muted">
            Kéo file google-ads.yaml vào ô, hoặc điền 3 ô OAuth. Không dán token vào chat. Google đã
            bỏ token nhà phát triển (9/2026) — quyền API theo Google Cloud project của OAuth. Không
            còn gọi Python trên máy này.
          </p>
          <div
            onDragEnter={onDragOverZone}
            onDragOver={onDragOverZone}
            onDragLeave={onDragLeaveZone}
            onDrop={onDropZone}
            className={cn(
              "mt-3 rounded-md border border-dashed px-3 py-4 text-center transition-colors duration-150",
              dragOver ? "border-accent bg-ok-bg" : "border-line-strong bg-inset",
            )}
          >
            <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1">
              <Upload className="size-4 text-muted" aria-hidden />
              <span className="text-sm font-medium">
                {dragOver ? "Thả file yaml vào đây" : "Kéo file yaml vào đây"}
              </span>
              <span className="text-xs text-subtle">
                {fileName
                  ? `Đã chọn ${fileName} (nội dung ẩn) — bấm Lưu trên máy rồi thử gọi`
                  : "Chỉ nhận .yaml / .yml — không hiện token"}
              </span>
              <input
                type="file"
                accept=".yaml,.yml,text/yaml,text/plain"
                className="sr-only"
                onChange={(e) => acceptYaml(e.target.files?.[0])}
              />
            </label>
          </div>
          <p className="mt-4 text-xs text-subtle">
            Ba ô OAuth bắt buộc nếu không có file yaml (ô mật khẩu, không chat). Token nhà phát
            triển không còn cần.
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <SecretField label="OAuth Client ID" value={oauthClientId} onChange={setOauthClientId} />
            <SecretField
              label="OAuth Client Secret"
              value={oauthClientSecret}
              onChange={setOauthClientSecret}
            />
            <SecretField label="Refresh token" value={refreshToken} onChange={setRefreshToken} />
          </div>
          {formError ? <p className="mt-3 text-sm text-danger">{friendlyConnectError(formError)}</p> : null}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={busy !== null || !hasIntake}
              onClick={() => void run(true)}
              className="h-11 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-60"
            >
              {busy === "save" ? "Đang lưu và thử gọi…" : "Lưu trên máy rồi thử gọi"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run(false)}
              className="h-11 rounded-md bg-inset px-4 text-sm font-medium text-ink disabled:opacity-60"
            >
              {busy === "probe" ? "Đang thử gọi…" : "Thử gọi Google Ads"}
            </button>
          </div>
        </div>
      ) : formError ? (
        <p className="mt-3 text-sm text-danger">{friendlyConnectError(formError)}</p>
      ) : null}
      <p className="mt-4 text-xs text-subtle">
        Phiên này: kéo 5 KPI để đối chiếu UI · không kéo search term · không sinh FINAL · không
        apply Ads. Token không dán vào chat.
      </p>
    </section>
  );
}

function SecretField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
      {label}
      <input
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 rounded-md border border-line bg-bg px-3 text-sm text-ink"
      />
    </label>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <section className="rounded-xl bg-paper px-5 py-10 text-center text-sm text-muted shadow-sheet">
      {children}
    </section>
  );
}
