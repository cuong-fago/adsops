import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Copy, Search } from "lucide-react";
import { cn } from "@/lib/cn";

export type PackKind = "keyword" | "negative" | "rsa" | "routing" | "remove";
export type KindFilter = PackKind | "all";
export type NegScope = "account" | "campaign" | "ad_group";

type CopyRow = {
  action: string;
  campaign: string;
  adGroup: string;
  term: string;
  match: string;
  syntax: string;
  pasteInto: string;
  evidence: string;
  kind: PackKind;
  scope: NegScope;
};

type Pack = {
  key: string;
  kind: PackKind;
  scope: NegScope;
  action: string;
  campaign: string;
  adGroup: string;
  rows: CopyRow[];
  destination: string;
  matchLabel: string;
};

export type JumpTarget = {
  tabId: string;
  copyKind?: KindFilter;
  cardId?: string;
};

function txt(v: unknown) {
  if (v == null || v === "") return "";
  return String(v);
}

function matchEn(value: string) {
  const s = value.toLowerCase();
  if (s.includes("chính xác") || s === "exact") return "Exact";
  if (s.includes("cụm") || s === "phrase") return "Phrase";
  if (s.includes("rộng") || s === "broad") return "Broad";
  return value || "Exact";
}

export function classifyAction(action: string): PackKind {
  const a = action.toUpperCase();
  if (a.includes("REMOVE")) return "remove";
  if (a.includes("RSA") || a.includes("ASSET")) return "rsa";
  if (a.includes("ROUT") || a.includes("MOVE") || a.includes("ĐIỀU HƯỚNG")) return "routing";
  if (a.includes("NEGATIVE")) return "negative";
  return "keyword";
}

const KIND_META: Record<PackKind, { title: string; step: string; chip: string; verb: string }> = {
  keyword: { title: "Thêm từ khoá?", step: "Thêm từ khoá", chip: "Thêm từ khoá", verb: "từ khoá" },
  negative: { title: "Phủ định?", step: "Phủ định", chip: "Phủ định", verb: "phủ định" },
  rsa: { title: "Cải RSA?", step: "Cải RSA", chip: "Cải RSA", verb: "RSA" },
  routing: { title: "Cấu trúc lại?", step: "Điều hướng", chip: "Điều hướng", verb: "điều hướng" },
  remove: { title: "Gỡ phủ định?", step: "Gỡ phủ định", chip: "Gỡ phủ định", verb: "gỡ" },
};

const SCOPE_META: Record<NegScope, { short: string; label: string; hint: string }> = {
  account: {
    short: "Tài khoản",
    label: "Cấp tài khoản",
    hint: "Dán vào phủ định tài khoản / Negative keyword list. Không mở chiến dịch, không mở nhóm.",
  },
  campaign: {
    short: "Chiến dịch",
    label: "Cấp chiến dịch",
    hint: "Mở chiến dịch → Negative keywords. Không mở Ad Group. Không dán vào Keywords.",
  },
  ad_group: {
    short: "Nhóm QC",
    label: "Cấp nhóm quảng cáo",
    hint: "Mở đúng Ad Group → Negative keywords. Không dán lên chiến dịch hay tài khoản.",
  },
};

function parseScope(raw: string, pasteInto: string, kind: PackKind): NegScope {
  const s = raw.trim().toLowerCase();
  if (s === "ad_group" || s === "ad group" || s.startsWith("ad_group") || s === "nhóm") return "ad_group";
  if (s === "campaign" || s === "chiến dịch") return "campaign";
  if (s === "account" || s === "tài khoản") return "account";

  const blob = `${raw} ${pasteInto}`.toLowerCase();
  if (blob.includes("ad_group") || blob.includes("ad group") || blob.includes("đúng nhóm")) return "ad_group";
  if (/\baccount\b/.test(blob) || blob.includes("tài khoản") || blob.includes("keyword list")) return "account";
  if (blob.includes("đúng campaign") || blob.includes("cấp chiến dịch") || blob.includes("chiến dịch")) {
    return "campaign";
  }
  if (kind === "routing") return "campaign";
  return "ad_group";
}

function campaignShort(name: string) {
  const parts = name.split("|").map((p) => p.trim()).filter(Boolean);
  const drop = new Set(["search", "pmax", "display", "hcm", "hn", "lead"]);
  const kept = parts.filter((p) => !drop.has(p.toLowerCase()));
  return kept[0] || parts[1] || parts[0] || name;
}

function isScopeKind(kind: PackKind) {
  return kind === "negative" || kind === "remove" || kind === "routing";
}

function packTitle(pack: Pack) {
  if (!isScopeKind(pack.kind) || pack.scope === "ad_group") return pack.adGroup || pack.campaign;
  if (pack.scope === "account") return "Tài khoản Google Ads";
  return pack.campaign;
}

function packSub(pack: Pack) {
  if (!isScopeKind(pack.kind)) return pack.campaign;
  if (pack.scope === "account") return "Negative keyword list · không mở chiến dịch, không mở nhóm";
  if (pack.scope === "campaign") {
    return pack.adGroup
      ? `Nguồn phát sinh: ${pack.adGroup} — không dán vào nhóm này`
      : "Dán cấp chiến dịch · không mở Ad Group";
  }
  return pack.campaign;
}

function scopeTone(scope: NegScope) {
  if (scope === "account") return "bg-danger-bg text-danger";
  if (scope === "campaign") return "bg-warn-bg text-warn";
  return "bg-ok-bg text-ok";
}

function negativeScopeLine(packs: Pack[]) {
  const neg = packs.filter((p) => p.kind === "negative");
  if (!neg.length) return "Không có negative READY";
  const nAcc = neg.filter((p) => p.scope === "account").length;
  const nCamp = neg.filter((p) => p.scope === "campaign").length;
  const nAg = neg.filter((p) => p.scope === "ad_group").length;
  const bits: string[] = [];
  if (nAg) bits.push(nAg === neg.length ? "cấp nhóm" : `${nAg} cấp nhóm`);
  if (nCamp) bits.push(nCamp === neg.length ? "cấp chiến dịch" : `${nCamp} cấp chiến dịch`);
  if (nAcc) bits.push(nAcc === neg.length ? "cấp tài khoản" : `${nAcc} cấp tài khoản`);
  return `${neg.length} chỗ dán · ${bits.join(" · ")}`;
}

function parseRows(headers: string[], rows: unknown[][]): CopyRow[] {
  const idx = (name: string, fallback: number) => {
    const hit = headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    return hit >= 0 ? hit : fallback;
  };
  const iAction = idx("LOẠI HÀNH ĐỘNG", 0);
  const iCamp = idx("Campaign", 1);
  const iGroup = idx("Ad Group nguồn / nơi áp dụng", 2);
  const iTerm = idx("Từ khóa / Negative / Asset", 3);
  const iMatch = idx("Match", 4);
  const iCopy = headers.findIndex((h) => h.toLowerCase().includes("cú pháp"));
  const iPaste = headers.findIndex((h) => h.toLowerCase().includes("dán"));
  const iEvi = headers.findIndex((h) => h.toLowerCase().includes("evidence") || h.toLowerCase().includes("bằng chứng"));
  const iScope = headers.findIndex((h) => h.toLowerCase() === "scope" || h.toLowerCase().includes("phạm vi"));
  const copyAt = iCopy >= 0 ? iCopy : 5;
  const pasteAt = iPaste >= 0 ? iPaste : 6;
  const out: CopyRow[] = [];
  for (const row of rows) {
    const action = txt(row[iAction]);
    const campaign = txt(row[iCamp]);
    const adGroup = txt(row[iGroup]);
    const term = txt(row[iTerm]);
    const match = txt(row[iMatch]);
    const syntax = txt(row[copyAt]) || (matchEn(match) === "Exact" ? `[${term}]` : term);
    if (!action || !syntax) continue;
    const kind = classifyAction(action);
    const pasteInto = txt(row[pasteAt]);
    out.push({
      action,
      campaign,
      adGroup,
      term,
      match,
      syntax,
      pasteInto,
      evidence: iEvi >= 0 ? txt(row[iEvi]) : "",
      kind,
      scope: parseScope(iScope >= 0 ? txt(row[iScope]) : "", pasteInto, kind),
    });
  }
  return out;
}

function destinationOf(row: CopyRow) {
  if (row.kind === "negative" || row.kind === "routing" || row.kind === "remove") {
    if (row.scope === "account") {
      return `Google Ads → Công cụ → Negative keyword lists (cấp tài khoản) → dán → Lưu`;
    }
    if (row.scope === "campaign") {
      return `Google Ads → ${row.campaign} → Negative keywords (cấp chiến dịch) → + → dán → Lưu`;
    }
    return `Google Ads → ${row.campaign} → ${row.adGroup} → Negative keywords (cấp nhóm) → + → dán → Lưu`;
  }
  if (row.kind === "rsa") {
    return `Google Ads → ${row.campaign} → ${row.adGroup} → Ads / RSA`;
  }
  return `Google Ads → ${row.campaign} → ${row.adGroup} → Từ khoá → + → dán cả khối → Lưu`;
}

const KIND_ORDER: PackKind[] = ["keyword", "negative", "routing", "rsa", "remove"];

function matchLabelOf(rows: CopyRow[]) {
  const set = new Set(rows.map((r) => matchEn(r.match)));
  if (set.size === 1 && set.has("Exact")) return "Chính xác";
  if (set.size === 1 && set.has("Phrase")) return "Cụm từ";
  if (set.size === 1 && set.has("Broad")) return "Rộng";
  return `${set.size} kiểu khớp`;
}

function toPacks(rows: CopyRow[]): Pack[] {
  const map = new Map<string, CopyRow[]>();
  for (const row of rows) {
    const key = `${row.kind}||${row.scope}||${row.campaign}||${row.scope === "ad_group" ? row.adGroup : ""}`;
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  const packs: Pack[] = [];
  for (const [key, list] of map) {
    const first = list[0];
    const unique: CopyRow[] = [];
    const seen = new Set<string>();
    for (const row of list) {
      const id = row.syntax.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      unique.push(row);
    }
    packs.push({
      key,
      kind: first.kind,
      scope: first.scope,
      action: first.action,
      campaign: first.campaign,
      adGroup: first.adGroup,
      rows: unique,
      destination: destinationOf(first),
      matchLabel: matchLabelOf(unique),
    });
  }
  packs.sort((a, b) => {
    const ka = KIND_ORDER.indexOf(a.kind);
    const kb = KIND_ORDER.indexOf(b.kind);
    if (ka !== kb) return ka - kb;
    if (a.campaign !== b.campaign) return a.campaign.localeCompare(b.campaign, "vi");
    return b.rows.length - a.rows.length;
  });
  return packs;
}

function pasteBlockOf(rows: CopyRow[]) {
  return rows.map((r) => r.syntax).join("\n");
}

function tsvOf(rows: CopyRow[], scope?: NegScope) {
  if (scope === "campaign" || scope === "account") {
    return [
      "Campaign\tKeyword\tCriterion type\tLevel",
      ...rows.map((r) => `${r.campaign}\t${r.term}\t${matchEn(r.match)}\t${scope === "account" ? "Account" : "Campaign"}`),
    ].join("\n");
  }
  return [
    "Campaign\tAd group\tKeyword\tCriterion type\tStatus",
    ...rows.map((r) => `${r.campaign}\t${r.adGroup}\t${r.term}\t${matchEn(r.match)}\tEnabled`),
  ].join("\n");
}

async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallback below */
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.left = "-9999px";
  document.body.appendChild(el);
  el.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(el);
  return ok;
}

function CopyBtn({
  label,
  text,
  primary,
  disabled,
  onCopied,
}: {
  label: string;
  text: string;
  primary?: boolean;
  disabled?: boolean;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled || !text}
      onClick={async () => {
        const ok = await copyText(text);
        if (!ok) return;
        setCopied(true);
        onCopied?.();
        window.setTimeout(() => setCopied(false), 2200);
      }}
      className={cn(
        "inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        primary
          ? "w-full bg-accent text-accent-fg hover:bg-accent/90 sm:w-auto"
          : "border border-line bg-paper text-ink hover:bg-inset",
      )}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? "Đã copy" : label}
    </button>
  );
}

function countByKind(rows: CopyRow[]) {
  const packs = toPacks(rows);
  const out: Record<PackKind, { rows: number; packs: number }> = {
    keyword: { rows: 0, packs: 0 },
    negative: { rows: 0, packs: 0 },
    rsa: { rows: 0, packs: 0 },
    routing: { rows: 0, packs: 0 },
    remove: { rows: 0, packs: 0 },
  };
  for (const pack of packs) {
    out[pack.kind].packs += 1;
    out[pack.kind].rows += pack.rows.length;
  }
  return out;
}

function tabById(tabs: { id?: unknown; short?: unknown; name?: unknown }[], id: string) {
  return tabs.find((t) => String(t.id) === id);
}

function rsaKeepLabel(tabs: Record<string, unknown>[]) {
  const t10 = tabById(tabs, "10") as { headers?: unknown[]; rows?: unknown[][] } | undefined;
  const headers = (t10?.headers || []).map(String);
  const rows = Array.isArray(t10?.rows) ? t10!.rows : [];
  if (!rows.length) return "Không / giữ hiện trạng";
  const iFinal = headers.findIndex((h) => h.toLowerCase().includes("cuối") || h.toLowerCase().includes("quyết"));
  if (iFinal < 0) return "Không / giữ hiện trạng";
  const statuses = rows.map((r) => String(r[iFinal] || "").toUpperCase());
  if (statuses.length && statuses.every((s) => s === "PASS" || s === "SNAPSHOT" || s === "KEEP")) {
    return "Không / giữ hiện trạng";
  }
  if (statuses.some((s) => s === "HOLD")) return "Chưa READY — không copy";
  return `${rows.length} RSA trên tab 10`;
}

export function buildDayCards(
  tabs: Record<string, unknown>[],
  copyRows: CopyRow[],
  holdCount: number,
): { id: string; title: string; yes: boolean; headline: string; detail: string; jump: JumpTarget }[] {
  const counts = countByKind(copyRows);
  const packsAll = toPacks(copyRows);
  const rsaReady = counts.rsa.packs;
  const rsaLine = rsaReady ? `${rsaReady} lô READY` : rsaKeepLabel(tabs);
  const structurePacks = counts.routing.packs + counts.remove.packs;
  const structureRows = counts.routing.rows + counts.remove.rows;
  const t06 = tabById(tabs, "06") as { rows?: unknown[] } | undefined;
  const holds = holdCount || (Array.isArray(t06?.rows) ? t06!.rows.length : 0);

  return [
    {
      id: "keyword",
      title: "Thêm từ khoá?",
      yes: counts.keyword.packs > 0,
      headline: counts.keyword.packs ? `Có · ${counts.keyword.rows}` : "Không",
      detail: counts.keyword.packs
        ? `${counts.keyword.packs} lần dán · ${counts.keyword.rows} từ`
        : "Không có exact READY",
      jump: { tabId: "12", copyKind: "keyword", cardId: "keyword" },
    },
    {
      id: "negative",
      title: "Phủ định?",
      yes: counts.negative.packs > 0,
      headline: counts.negative.packs ? `Có · ${counts.negative.rows}` : "Không",
      detail: counts.negative.packs ? negativeScopeLine(packsAll) : "Không có negative READY",
      jump: { tabId: "12", copyKind: "negative", cardId: "negative" },
    },
    {
      id: "rsa",
      title: "Cải RSA?",
      yes: rsaReady > 0,
      headline: rsaReady ? `Có · ${counts.rsa.rows}` : "Không / giữ hiện trạng",
      detail: rsaLine,
      jump: { tabId: rsaReady ? "12" : "10", copyKind: rsaReady ? "rsa" : undefined, cardId: "rsa" },
    },
    {
      id: "routing",
      title: "Cấu trúc lại?",
      yes: structurePacks > 0,
      headline: structurePacks ? `Có · ${structureRows}` : "Không",
      detail: structurePacks
        ? `${structurePacks} lô điều hướng / gỡ`
        : "Không đổi cấu trúc hôm nay",
      jump: {
        tabId: structurePacks ? "12" : "03",
        copyKind: structurePacks ? "routing" : undefined,
        cardId: "routing",
      },
    },
    {
      id: "other",
      title: "Việc khác?",
      yes: holds > 0,
      headline: holds ? `Có · ${holds}` : "Không",
      detail: holds ? `${holds} việc chờ tay — không READY` : "Không có HOLD",
      jump: { tabId: "06", cardId: "other" },
    },
  ];
}

export function DayPackOverview({
  tabs,
  headers,
  rows,
  holdCount = 0,
  activeId,
  onJump,
}: {
  tabs: Record<string, unknown>[];
  headers: string[];
  rows: unknown[][];
  holdCount?: number;
  activeId?: string;
  onJump: (jump: JumpTarget) => void;
}) {
  const parsed = useMemo(() => parseRows(headers, rows), [headers, rows]);
  const cards = useMemo(() => buildDayCards(tabs, parsed, holdCount), [tabs, parsed, holdCount]);
  const pasteLots = cards.filter((c) => c.id !== "other" && c.yes).reduce((n, c) => {
    const bit = c.detail.match(/^(\d+)/);
    return n + (bit ? Number(bit[1]) : 0);
  }, 0);

  return (
    <section className="rounded-xl bg-paper p-4 shadow-sheet md:p-5">
      <p className="text-xs font-medium tracking-wide text-subtle">Việc hôm nay · chỉ READY · không apply</p>
      <h3 className="mt-1 font-display text-lg font-medium tracking-tight">
        {pasteLots > 0 ? `${pasteLots} lần dán vào Google Ads` : "Không có lô copy hôm nay"}
      </h3>
      <p className="mt-1 max-w-3xl text-pretty text-sm text-muted">
        Mỗi ô là một loại việc. Bấm để nhảy đúng lô. Phủ định: xem cấp dán (nhóm / chiến dịch / tài khoản) trước khi
        paste. Thêm từ khoá trước, phủ định sau. HOLD không copy.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((card) => {
          const on = activeId === card.id;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onJump(card.jump)}
              className={cn(
                "flex min-h-24 flex-col rounded-lg px-4 py-3 text-left transition-colors duration-150",
                on ? "bg-accent text-accent-fg" : "bg-inset text-ink hover:bg-line",
              )}
            >
              <span className="flex items-center justify-between gap-2 text-xs font-medium tracking-wide">
                <span className={on ? "text-accent-fg/80" : "text-subtle"}>{card.title}</span>
                <ChevronRight className="size-4 shrink-0 opacity-70" />
              </span>
              <span className="mt-2 font-display text-lg font-medium tracking-tight">{card.headline}</span>
              <span className={cn("mt-1 text-sm", on ? "text-accent-fg/80" : "text-muted")}>{card.detail}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function doneKey(clientId?: string) {
  return clientId ? `adsops-tab12-done:${clientId}` : "";
}

function readDone(clientId?: string): Set<string> {
  const key = doneKey(clientId);
  if (!key || typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeDone(clientId: string | undefined, next: Set<string>) {
  const key = doneKey(clientId);
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify([...next]));
  } catch {
    /* ignore quota */
  }
}

export function Tab12CopyDesk({
  headers,
  rows,
  clientId,
  kind = "all",
  onKindChange,
}: {
  headers: string[];
  rows: unknown[][];
  clientId?: string;
  kind?: KindFilter;
  onKindChange?: (kind: KindFilter) => void;
}) {
  const parsed = useMemo(() => parseRows(headers, rows), [headers, rows]);
  const [query, setQuery] = useState("");
  const [activeKey, setActiveKey] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [trim, setTrim] = useState(false);
  const [toast, setToast] = useState("");
  const [done, setDone] = useState<Set<string>>(() => readDone(clientId));
  const [localKind, setLocalKind] = useState<KindFilter>(kind);
  const deskRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalKind(kind);
  }, [kind]);

  const currentKind = localKind;

  useEffect(() => {
    setDone(readDone(clientId));
  }, [clientId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return parsed.filter((row) => {
      if (currentKind !== "all") {
        if (currentKind === "routing") {
          if (row.kind !== "routing" && row.kind !== "remove") return false;
        } else if (row.kind !== currentKind) return false;
      }
      if (!q) return true;
      return (
        row.campaign.toLowerCase().includes(q) ||
        row.adGroup.toLowerCase().includes(q) ||
        row.term.toLowerCase().includes(q) ||
        row.syntax.toLowerCase().includes(q)
      );
    });
  }, [parsed, currentKind, query]);

  const packs = useMemo(() => toPacks(filtered), [filtered]);
  const allPacks = useMemo(() => toPacks(parsed), [parsed]);
  const counts = useMemo(() => countByKind(parsed), [parsed]);

  useEffect(() => {
    if (!packs.length) {
      setActiveKey("");
      return;
    }
    if (!packs.some((p) => p.key === activeKey)) {
      const pending = packs.find((p) => !done.has(p.key));
      setActiveKey((pending || packs[0]).key);
    }
  }, [packs, activeKey, done]);

  useEffect(() => {
    setToast("");
  }, [activeKey, currentKind]);

  useEffect(() => {
    deskRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [currentKind]);

  const active = packs.find((p) => p.key === activeKey) || packs[0] || null;
  const stepIndex = active ? packs.findIndex((p) => p.key === active.key) + 1 : 0;

  useEffect(() => {
    const pack = packs.find((p) => p.key === activeKey);
    if (!pack) {
      setPicked(new Set());
      return;
    }
    setPicked(new Set(pack.rows.map((r) => r.syntax)));
    setTrim(false);
  }, [activeKey, packs]);

  const selectedRows = active ? active.rows.filter((r) => picked.has(r.syntax)) : [];
  const paste = pasteBlockOf(selectedRows);
  const doneCount = packs.filter((p) => done.has(p.key)).length;

  function markDone(key: string) {
    setDone((prev) => {
      const next = new Set(prev);
      next.add(key);
      writeDone(clientId, next);
      return next;
    });
  }

  function markUndone(key: string) {
    setDone((prev) => {
      const next = new Set(prev);
      next.delete(key);
      writeDone(clientId, next);
      return next;
    });
  }

  function goNext() {
    if (!active) return;
    const i = packs.findIndex((p) => p.key === active.key);
    const rest = packs.slice(i + 1);
    const nxt = rest.find((p) => !done.has(p.key)) || rest[0] || packs.find((p) => !done.has(p.key));
    if (nxt) setActiveKey(nxt.key);
  }

  function announceCopy() {
    if (!active) return;
    markDone(active.key);
    const meta = KIND_META[active.kind];
    if (isScopeKind(active.kind)) {
      const sc = SCOPE_META[active.scope];
      if (active.scope === "account") {
        setToast(
          `Đã copy ${selectedRows.length} ${meta.verb}. Dán ${sc.label} — Công cụ → Negative keyword lists. Không mở chiến dịch.`,
        );
      } else if (active.scope === "campaign") {
        setToast(
          `Đã copy ${selectedRows.length} ${meta.verb}. Dán ${sc.label} vào «${active.campaign}» → Negative keywords. Không mở Ad Group.`,
        );
      } else {
        setToast(
          `Đã copy ${selectedRows.length} ${meta.verb}. Dán ${sc.label} vào «${active.adGroup}» → Negative keywords. Không dán lên chiến dịch.`,
        );
      }
      return;
    }
    setToast(
      `Đã copy ${selectedRows.length} ${meta.verb} của «${active.adGroup}». Mở đúng Campaign / Ad Group đó rồi dán — không trộn nhóm.`,
    );
  }

  const chips: { id: KindFilter; label: string; n: number }[] = (
    [
      { id: "all" as const, label: "Tất cả lô", n: allPacks.length },
      { id: "keyword" as const, label: KIND_META.keyword.chip, n: counts.keyword.packs },
      { id: "negative" as const, label: KIND_META.negative.chip, n: counts.negative.packs },
      { id: "routing" as const, label: KIND_META.routing.chip, n: counts.routing.packs + counts.remove.packs },
      { id: "rsa" as const, label: KIND_META.rsa.chip, n: counts.rsa.packs },
    ] satisfies { id: KindFilter; label: string; n: number }[]
  ).filter((c) => c.id === "all" || c.n > 0);

  if (!parsed.length) {
    return <p className="text-sm text-muted">Không có dòng READY để copy.</p>;
  }

  return (
    <div ref={deskRef} id="tab12-desk" className="flex scroll-mt-4 flex-col gap-4">
      <p className="text-sm text-muted">
        Một thẻ = một lần dán vào đúng cấp Google Ads. Phủ định có ba cấp: nhóm quảng cáo, chiến dịch, tài khoản — xem
        badge trước khi dán. Copy cả khối, mỗi dòng một cú pháp. Không apply. Thứ tự: thêm từ khoá → phủ định đúng cấp →
        điều hướng → RSA → gỡ negative.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {chips.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setLocalKind(item.id);
              onKindChange?.(item.id);
            }}
            className={cn(
              "inline-flex h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors duration-150",
              currentKind === item.id ? "bg-accent text-accent-fg" : "bg-inset text-ink hover:bg-line",
            )}
          >
            {item.label}
            <span className={cn("tabular-nums", currentKind === item.id ? "text-accent-fg/80" : "text-muted")}>
              {" "}
              · {item.n}
            </span>
          </button>
        ))}
      </div>

      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Lọc chiến dịch, nhóm quảng cáo, từ khoá…"
          className="h-11 w-full rounded-md border border-line bg-paper pl-10 pr-3 text-sm text-ink"
        />
      </label>

      <p className="text-sm text-muted">
        {doneCount}/{packs.length} lô đã copy
        {currentKind !== "all" ? ` · đang xem ${KIND_META[currentKind as PackKind]?.chip || currentKind}` : ""}
      </p>

      {toast ? (
        <p className="rounded-md bg-ok-bg px-4 py-3 text-sm text-ok" role="status">
          {toast}
        </p>
      ) : null}

      {packs.length === 0 ? (
        <p className="rounded-md bg-inset px-4 py-6 text-sm text-muted">Không khớp bộ lọc.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <aside className="rounded-lg bg-inset p-3 lg:col-span-1">
            <label className="mb-3 block lg:hidden">
              <span className="mb-1.5 block text-xs font-medium tracking-wide text-subtle">Lô dán</span>
              <select
                value={active?.key || ""}
                onChange={(e) => setActiveKey(e.target.value)}
                className="h-11 w-full rounded-md border border-line bg-paper px-3 text-sm text-ink"
              >
                {packs.map((pack, i) => (
                  <option key={pack.key} value={pack.key}>
                    {done.has(pack.key) ? "✓ " : ""}
                    {i + 1}. {KIND_META[pack.kind].step}
                    {isScopeKind(pack.kind) ? ` · ${SCOPE_META[pack.scope].label}` : ""} · {packTitle(pack)} ({pack.rows.length})
                  </option>
                ))}
              </select>
            </label>
            <div className="hidden max-h-[32rem] overflow-auto lg:block">
              {packs.map((pack, i) => {
                const on = pack.key === active?.key;
                const ok = done.has(pack.key);
                return (
                  <button
                    key={pack.key}
                    type="button"
                    onClick={() => setActiveKey(pack.key)}
                    className={cn(
                      "mb-1 flex min-h-11 w-full items-start justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors duration-150 last:mb-0",
                      on ? "bg-accent text-accent-fg" : "bg-paper text-ink hover:bg-line",
                    )}
                  >
                    <span className="min-w-0">
                      <span className={cn("block text-xs", on ? "text-accent-fg/80" : "text-subtle")}>
                        {i + 1}/{packs.length} · {KIND_META[pack.kind].step}
                        {isScopeKind(pack.kind) ? ` · ${SCOPE_META[pack.scope].short}` : ""}
                        {ok ? " · đã copy" : ""}
                      </span>
                      <span className="mt-0.5 block text-pretty">{packTitle(pack)}</span>
                      <span className={cn("mt-0.5 block text-xs", on ? "text-accent-fg/80" : "text-muted")}>
                        {isScopeKind(pack.kind) && pack.scope === "campaign"
                          ? "Cấp chiến dịch · không mở nhóm"
                          : isScopeKind(pack.kind) && pack.scope === "account"
                            ? "Cấp tài khoản · không mở chiến dịch"
                            : campaignShort(pack.campaign)}
                      </span>
                    </span>
                    <span className={cn("shrink-0 tabular-nums", on ? "text-accent-fg" : "text-muted")}>
                      {pack.rows.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          {active ? (
            <LotCard
              pack={active}
              stepIndex={stepIndex}
              stepTotal={packs.length}
              selectedRows={selectedRows}
              paste={paste}
              picked={picked}
              setPicked={setPicked}
              trim={trim}
              setTrim={setTrim}
              done={done.has(active.key)}
              onCopied={announceCopy}
              onToggleDone={() => (done.has(active.key) ? markUndone(active.key) : markDone(active.key))}
              onNext={goNext}
              hasNext={stepIndex < packs.length}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function LotCard({
  pack,
  stepIndex,
  stepTotal,
  selectedRows,
  paste,
  picked,
  setPicked,
  trim,
  setTrim,
  done,
  onCopied,
  onToggleDone,
  onNext,
  hasNext,
}: {
  pack: Pack;
  stepIndex: number;
  stepTotal: number;
  selectedRows: CopyRow[];
  paste: string;
  picked: Set<string>;
  setPicked: (next: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  trim: boolean;
  setTrim: (v: boolean | ((p: boolean) => boolean)) => void;
  done: boolean;
  onCopied: () => void;
  onToggleDone: () => void;
  onNext: () => void;
  hasNext: boolean;
}) {
  const meta = KIND_META[pack.kind];
  const scope = SCOPE_META[pack.scope];
  const scoped = isScopeKind(pack.kind);
  const pills = pack.rows.slice(0, 8);
  const extra = pack.rows.length - pills.length;
  const evidence = pack.rows[0]?.evidence;

  return (
    <section className="flex flex-col gap-4 rounded-lg bg-paper p-4 shadow-sheet lg:col-span-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-wide text-subtle">
            Bước {stepIndex}/{stepTotal} · {meta.step} · {pack.rows.length} {meta.verb} · {pack.matchLabel}
          </p>
          {scoped ? (
            <p className={cn("mt-2 inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium", scopeTone(pack.scope))}>
              {scope.label} — dán đúng cấp này
            </p>
          ) : null}
          <h4 className="mt-2 font-display text-xl font-medium tracking-tight text-pretty">{packTitle(pack)}</h4>
          <p className="mt-1 text-sm text-muted">{packSub(pack)}</p>
        </div>
        <CopyBtn
          primary
          text={paste}
          disabled={!selectedRows.length}
          label={`Copy cả ${selectedRows.length} ${meta.verb} — dán 1 lần`}
          onCopied={onCopied}
        />
      </div>

      <div
        className={cn(
          "rounded-md px-3 py-3",
          scoped && pack.scope !== "ad_group" ? "bg-warn-bg text-warn" : scoped ? "bg-ok-bg text-ok" : "bg-inset text-ink",
        )}
      >
        <p className="text-xs font-medium tracking-wide">
          {scoped ? `Dán vào · ${scope.label}` : "Dán vào · Keywords · đúng Ad Group"}
        </p>
        <p className="mt-1 text-sm text-pretty">{pack.destination}</p>
        <p className={cn("mt-1 text-xs", scoped && pack.scope !== "ad_group" ? "text-warn" : scoped ? "text-ok" : "text-muted")}>
          {scoped ? scope.hint : "Dán cả khối, mỗi dòng một cú pháp. Sai nhóm = sai traffic."}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {pills.map((row) => (
          <span key={row.syntax} className="inline-flex max-w-full rounded-full bg-inset px-3 py-1.5 font-mono text-xs text-ink">
            {row.syntax}
          </span>
        ))}
        {extra > 0 ? <span className="inline-flex items-center text-xs text-muted">+{extra} trong khối copy</span> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <CopyBtn text={tsvOf(selectedRows, pack.scope)} label="Copy bảng nhiều thay đổi" />
        <button
          type="button"
          onClick={() => setTrim((v) => !v)}
          className="inline-flex h-11 items-center rounded-md border border-line bg-paper px-4 text-sm font-medium text-ink hover:bg-inset"
        >
          {trim ? "Xong chọn bớt" : "Bỏ vài từ không cần"}
        </button>
        <button
          type="button"
          onClick={onToggleDone}
          className={cn(
            "inline-flex h-11 items-center rounded-md px-4 text-sm font-medium",
            done ? "bg-ok-bg text-ok" : "border border-line bg-paper text-ink hover:bg-inset",
          )}
        >
          {done ? "Đã dán lô này" : "Đánh dấu đã dán"}
        </button>
        {hasNext ? (
          <button
            type="button"
            onClick={onNext}
            className="inline-flex h-11 items-center rounded-md border border-line bg-paper px-4 text-sm font-medium text-ink hover:bg-inset"
          >
            Lô tiếp theo
          </button>
        ) : null}
      </div>

      {trim ? (
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="h-10 text-sm font-medium text-accent"
              onClick={() => setPicked(new Set(pack.rows.map((r) => r.syntax)))}
            >
              Chọn tất cả ({pack.rows.length})
            </button>
            <button type="button" className="h-10 text-sm font-medium text-muted" onClick={() => setPicked(new Set())}>
              Bỏ chọn hết
            </button>
          </div>
          <ul className="max-h-72 overflow-auto rounded-md border border-line">
            {pack.rows.map((row) => {
              const on = picked.has(row.syntax);
              return (
                <li key={row.syntax} className="border-b border-line last:border-b-0">
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-inset">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (next.has(row.syntax)) next.delete(row.syntax);
                          else next.add(row.syntax);
                          return next;
                        });
                      }}
                      className="size-4 shrink-0 accent-accent"
                    />
                    <span className="font-mono text-sm text-ink">{row.syntax}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium tracking-wide text-subtle">
          Khối dán ({selectedRows.length} dòng) — bôi đen + Ctrl/Cmd+C nếu nút Copy bị chặn
        </span>
        <textarea
          readOnly
          value={paste}
          onFocus={(e) => e.currentTarget.select()}
          rows={Math.min(12, Math.max(6, selectedRows.length))}
          className="w-full rounded-md border border-line bg-inset/50 p-3 font-mono text-sm leading-6 text-ink"
        />
      </label>

      {evidence ? <p className="text-xs text-subtle">{evidence}</p> : null}
    </section>
  );
}
