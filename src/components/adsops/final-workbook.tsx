import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { money, num } from "@/lib/adsops/format";
import { cn } from "@/lib/cn";
import { Tab12CopyDesk, DayPackOverview, type KindFilter } from "@/components/adsops/tab12-copy";

type AnyRec = Record<string, unknown>;

function asObj(v: unknown): AnyRec {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as AnyRec) : {};
}

function isCopyTab(tab: AnyRec | null | undefined) {
  if (!tab) return false;
  const id = String(tab.id ?? "").trim();
  if (id === "12") return true;
  const blob = `${tab.short || ""} ${tab.name || ""} ${tab.title || ""}`.toLowerCase();
  return blob.includes("copy ready") || blob.includes("copy-paste");
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function txt(v: unknown) {
  if (v == null || v === "") return "";
  if (typeof v === "boolean") return v ? "Có" : "Không";
  return String(v);
}

function isMoneyHeader(header: string) {
  const h = header.toLowerCase();
  return (
    h.includes("chi phí") ||
    h.includes("cpl") ||
    h.includes("cpc") ||
    h.includes("ngân sách") ||
    h.includes("cpa")
  );
}

function isCopyHeader(header: string) {
  const h = header.toLowerCase();
  return h.includes("cú pháp") || h.includes("copy");
}

function cellText(value: unknown, currency: string, header = "") {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    if (isMoneyHeader(header)) return money(value, currency);
    if (!Number.isInteger(value)) return num(value, 2);
    return num(value, 0);
  }
  return String(value);
}

function statusTone(value: string) {
  const s = value.toUpperCase();
  if (s.includes("HARD") || s === "STALE" || s === "FAIL" || s.includes("CONFLICT") || s === "STOP") {
    return "bg-danger-bg text-danger";
  }
  if (s === "READY" || s === "PASS" || s === "CÓ" || s === "KEEP" || s.includes("VERIFIED") || s.startsWith("ADD ")) {
    return "bg-ok-bg text-ok";
  }
  if (s.includes("HOLD") || s === "CONDITIONAL" || s === "REVIEW" || s === "MONITOR") {
    return "bg-warn-bg text-warn";
  }
  return "";
}

function isStatusHeader(header: string) {
  const h = header.toLowerCase();
  return h.includes("trạng thái") || h === "status" || h === "loại hành động" || h === "được làm ngay?";
}

function Guide({ guide }: { guide: AnyRec }) {
  const entries = Object.entries(guide);
  if (!entries.length) return null;
  return (
    <details className="rounded-md bg-inset/80 px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-ink">Hướng dẫn đọc tab</summary>
      <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key}>
            <dt className="text-xs font-medium uppercase tracking-wide text-subtle">{key}</dt>
            <dd className="mt-1 text-pretty text-muted">{txt(value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function SheetTable({
  headers,
  rows,
  currency,
  empty,
}: {
  headers: string[];
  rows: unknown[][];
  currency: string;
  empty?: string;
}) {
  if (!headers.length) return null;
  return (
    <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                className="sticky top-0 z-10 whitespace-nowrap border-b border-line-strong bg-accent px-2.5 py-2 text-[11px] font-medium uppercase tracking-wide text-accent-fg"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="px-2.5 py-6 text-muted" colSpan={headers.length}>
                {empty || "Không có dòng ở tab này."}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i} className="odd:bg-paper even:bg-inset/60">
                {headers.map((h, c) => {
                  const raw = row[c];
                  const text = cellText(raw, currency, h);
                  const tone = isStatusHeader(h) ? statusTone(txt(raw)) : "";
                  const copy = isCopyHeader(h);
                  return (
                    <td
                      key={`${i}-${c}`}
                      className={cn(
                        "max-w-[18rem] border-b border-line px-2.5 py-2 align-top",
                        c === 0 ? "font-medium text-ink" : "text-muted",
                        copy ? "bg-ok-bg/40 font-mono text-ink" : "",
                      )}
                    >
                      {tone ? (
                        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", tone)}>
                          {text}
                        </span>
                      ) : (
                        <span className="line-clamp-4 text-pretty">{text}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function AuditRows({
  headers,
  rows,
  currency,
  empty,
}: {
  headers: string[];
  rows: unknown[][];
  currency: string;
  empty?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="rounded-md bg-inset/80 px-4 py-3"
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-sm font-medium text-ink">
        Bảng từng dòng ({rows.length}) — chỉ đối chiếu, không copy từ đây
      </summary>
      {open ? (
        <div className="mt-4">
          <SheetTable headers={headers} rows={rows} currency={currency} empty={empty} />
        </div>
      ) : null}
    </details>
  );
}

function OverviewBody({ tab, currency }: { tab: AnyRec; currency: string }) {
  const coverage = asArr(tab.coverage) as unknown[][];
  const sources = asArr(tab.source_status) as unknown[][];
  const kpiHeaders = asArr(tab.kpi_headers).map(String);
  const kpiRows = asArr(tab.kpi_rows) as unknown[][];
  const top5Headers = asArr(tab.top5_headers).map(String);
  const top5 = asArr(tab.top5) as unknown[][];
  const stopHeaders = asArr(tab.hard_stop_headers).map(String);
  const stops = asArr(tab.hard_stops) as unknown[][];
  const tabMap = asArr(tab.tab_map) as unknown[][];
  const newcomer = asArr(tab.newcomer) as unknown[][];
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">A. Coverage</h3>
          <ul className="space-y-2 text-sm">
            {coverage.map((row, i) => (
              <li key={i} className="rounded-md bg-inset px-3 py-2">
                <p className="font-medium">{txt(row[0])}</p>
                <p className="mt-0.5 tabular-nums">{txt(row[1])}</p>
                <p className="text-xs text-muted">{txt(row[2])}</p>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">B. Nguồn dữ liệu</h3>
          <ul className="space-y-2 text-sm">
            {sources.map((row, i) => (
              <li key={i} className="rounded-md bg-inset px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{txt(row[0])}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusTone(txt(row[1])))}>
                    {txt(row[1])}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">{txt(row[2])}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">C. KPI 7 / 14 / 30</h3>
        <SheetTable headers={kpiHeaders} rows={kpiRows} currency={currency} />
      </section>
      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">D. Đúng 5 việc hôm nay</h3>
        <SheetTable headers={top5Headers} rows={top5} currency={currency} empty="Không có việc READY/HOLD đủ điều kiện." />
      </section>
      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">E. Hard stop</h3>
        <SheetTable
          headers={stopHeaders}
          rows={stops}
          currency={currency}
          empty="Không có HARD_STOP trên gói này."
        />
      </section>
      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">F. Sơ đồ 12 tab</h3>
        <ul className="grid gap-2 text-sm md:grid-cols-2">
          {tabMap.map((row, i) => (
            <li key={i} className="rounded-md bg-inset px-3 py-2">
              <p className="font-medium">{txt(row[0])}</p>
              <p className="mt-0.5 text-muted">{txt(row[1])}</p>
            </li>
          ))}
        </ul>
      </section>
      {newcomer.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">Người mới Google Ads cần nhớ</h3>
          <div className="grid gap-2">
            {newcomer.map((row, i) => (
              <article key={i} className="rounded-md bg-inset px-3 py-3 text-sm">
                <p className="font-medium">{txt(row[0])}</p>
                <p className="mt-1 text-pretty text-muted">{txt(row[1])}</p>
                <p className="mt-1 text-xs text-subtle">{txt(row[2])}</p>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function FinalWorkbook({ data }: { data: AnyRec }) {
  const workbook = asObj(data.workbook);
  const tabs = asArr(workbook.tabs) as AnyRec[];
  const [tabId, setTabId] = useState(tabs[0] ? String(tabs[0].id) : "00");
  const [copyKind, setCopyKind] = useState<KindFilter>("all");
  const [overviewId, setOverviewId] = useState<string>("");
  const currency = String(data.currency || "VND");
  const tab0 = asObj(data.tab0);
  const current = useMemo(() => tabs.find((t) => String(t.id) === tabId) || tabs[0] || null, [tabs, tabId]);
  const copyTab = useMemo(() => tabs.find((t) => isCopyTab(t)) || null, [tabs]);
  const holdTab = tabs.find((t) => String(t.id) === "06");
  const holdCount = asArr(asObj(holdTab).rows).length;

  function jumpTo(jump: { tabId: string; copyKind?: KindFilter; cardId?: string }) {
    setTabId(jump.tabId);
    setOverviewId(jump.cardId || "");
    setCopyKind(jump.copyKind || "all");
  }

  if (!tabs.length) return null;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl bg-paper p-5 shadow-sheet">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-subtle">Gói FINAL · 13 tab</p>
            <h2 className="font-display text-xl font-medium tracking-tight text-balance">
              {txt(workbook.file_title || workbook.title || tab0.title)}
            </h2>
            <p className="mt-1 max-w-3xl text-pretty text-sm text-muted">{txt(tab0.banner)}</p>
          </div>
          {txt(data.xlsx_href) ? (
            <a
              href={txt(data.xlsx_href)}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-accent-fg"
            >
              <Download className="size-4" />
              Tải file Google Sheet
            </a>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", statusTone(txt(tab0.guard)))}>
            Guard {txt(tab0.guard)}
          </span>
          <span className="rounded-full bg-inset px-2.5 py-0.5 text-xs">
            Coverage ST {txt(tab0.search_term_coverage) ? `${Math.round(Number(tab0.search_term_coverage) * 100)}%` : "—"}
          </span>
          <span className="rounded-full bg-inset px-2.5 py-0.5 text-xs">{txt(tab0.source_flag)}</span>
          <span className="rounded-full bg-inset px-2.5 py-0.5 text-xs">
            Tab 12: {txt(asObj(data.tab12).count) || "0"} READY
          </span>
        </div>
        {txt(tab0.hold_note) ? (
          <p className="mt-3 rounded-md bg-warn-bg px-4 py-3 text-sm text-warn">{txt(tab0.hold_note)}</p>
        ) : null}
      </section>

      {copyTab ? (
        <DayPackOverview
          tabs={tabs}
          headers={asArr(copyTab.headers).map(String)}
          rows={asArr(copyTab.rows) as unknown[][]}
          holdCount={holdCount}
          activeId={overviewId}
          onJump={jumpTo}
        />
      ) : null}

      <nav className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="flex min-w-max gap-px overflow-hidden rounded-lg border border-line bg-line shadow-sheet">
          {tabs.map((item) => {
            const id = String(item.id);
            const active = id === tabId;
            const isCopy = isCopyTab(item);
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTabId(id)}
                className={cn(
                  "h-11 shrink-0 px-3 text-xs font-medium transition-colors duration-150 md:text-sm",
                  active
                    ? isCopy
                      ? "bg-ok text-paper"
                      : "bg-accent text-accent-fg"
                    : "bg-paper text-muted hover:bg-inset hover:text-ink",
                )}
              >
                {isCopy ? "12 Copy dán" : txt(item.short || item.name)}
              </button>
            );
          })}
        </div>
      </nav>

      {current ? (
        <section className="rounded-xl bg-paper p-5 shadow-sheet">
          <h3 className="font-display text-lg font-medium tracking-tight">
            {isCopyTab(current) ? "12 — Copy-Paste Ready" : txt(current.title)}
          </h3>
          <p className="mt-1 max-w-4xl text-pretty text-sm text-muted">
            {isCopyTab(current)
              ? "Mỗi lô = một lần dán đúng cấp. Phủ định: nhóm / chiến dịch / tài khoản — xem badge trước khi dán. Không copy HOLD."
              : txt(current.subtitle)}
          </p>
          {isCopyTab(current) ? null : (
            <div className="mt-4">
              <Guide guide={asObj(current.guide)} />
            </div>
          )}
          {asArr(current.reconciliation).length > 0 ? (
            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
              {(asArr(current.reconciliation) as unknown[][]).map((row, i) => (
                <div key={i} className="rounded-md bg-inset px-3 py-2 text-sm">
                  <p className="text-xs text-muted">{txt(row[0])}</p>
                  <p className="mt-0.5 font-medium tabular-nums">{txt(row[1])}</p>
                </div>
              ))}
            </div>
          ) : null}
          {current.truncated ? (
            <p className="mt-4 rounded-md bg-inset px-3 py-2 text-sm text-muted">
              Đang hiện một phần sổ cái. Còn {txt(current.truncated)} dòng — tải file để xem đủ như Google Sheet.
            </p>
          ) : null}
          <div className="mt-5">
            {String(current.kind) === "overview" ? (
              <OverviewBody tab={current} currency={currency} />
            ) : isCopyTab(current) ? (
              <div className="flex flex-col gap-6">
                <Tab12CopyDesk
                  headers={asArr(current.headers).map(String)}
                  rows={asArr(current.rows) as unknown[][]}
                  clientId={String(data.client_id || "")}
                  kind={copyKind}
                  onKindChange={(next) => {
                    setCopyKind(next);
                    setOverviewId(next === "all" ? "" : next);
                  }}
                />
                <AuditRows
                  headers={asArr(current.headers).map(String)}
                  rows={asArr(current.rows) as unknown[][]}
                  currency={currency}
                  empty={txt(current.empty)}
                />
              </div>
            ) : (
              <SheetTable
                headers={asArr(current.headers).map(String)}
                rows={asArr(current.rows) as unknown[][]}
                currency={currency}
                empty={txt(current.empty)}
              />
            )}
          </div>
          {txt(workbook.footer) ? <p className="mt-5 text-xs text-subtle">{txt(workbook.footer)}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
