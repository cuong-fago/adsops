import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronsUpDown, Search } from "lucide-react";
import type { ScopeOption } from "@/lib/adsops/client-report.types";
import { cn } from "@/lib/cn";

/** Fold one char: lower-case, strip Vietnamese diacritics, đ→d. Always 1 char out, so indexes stay aligned for highlighting. */
function foldChar(ch: string): string {
  const f = ch.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace("đ", "d");
  return f.length === 1 ? f : f.charAt(0) || ch;
}
const fold = (s: string) => Array.from(s).map(foldChar).join("");
const digits = (s: string) => s.replace(/\D/g, "");

function Hl({ text, q }: { text: string; q: string }): ReactNode {
  const fq = fold(q.trim());
  if (!fq) return text;
  const chars = Array.from(text);
  const ft = chars.map(foldChar).join("");
  const i = ft.indexOf(fq);
  if (i < 0) return text;
  return <>{chars.slice(0, i).join("")}<mark className="rounded bg-warn-bg px-0.5 text-ink">{chars.slice(i, i + fq.length).join("")}</mark>{chars.slice(i + fq.length).join("")}</>;
}

const isCidLike = (s: string) => /^[\d\s-]{9,}$/.test(s.trim()) || /^act_\d+$/.test(s.trim());
const BADGE = { google: ["Google", "bg-inset text-muted"], facebook: ["Facebook", "bg-[#e7f0fd] text-[#1d4ed8]"], chatgpt: ["ChatGPT", "bg-[#e6f6f1] text-[#0d7a5f]"] } as const;
const keyOf = (s: ScopeOption) => `${s.kind}:${s.id}`;
const RECENT_KEY = "adsops.report.recentScopes";

export function readRecent(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 5) : []; } catch { return []; }
}
export function pushRecent(key: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([key, ...readRecent().filter((k) => k !== key)].slice(0, 5))); } catch { /* ignore */ }
}

/** What a query matches: client name, every account name/label, CID (with/without dashes), act id, OpenAI id. */
function matches(s: ScopeOption, q: string): boolean {
  const fq = fold(q.trim());
  if (!fq) return true;
  const dq = digits(q);
  const hay = [s.label, ...s.members.flatMap((m) => [m.label, m.name || "", m.ext || "", m.id])];
  if (hay.some((h) => fold(h).includes(fq))) return true;
  return dq.length >= 3 && s.members.some((m) => digits(m.ext || "").includes(dq) || digits(m.id).includes(dq));
}

/** Searchable client / account picker for reports. Options come pre-scoped by the server (permissions unchanged). */
export function ScopeCombobox({ scopes, value, onChange }: { scopes: ScopeOption[]; value: string; onChange: (key: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => setRecent(readRecent()), [open]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const byKey = useMemo(() => new Map(scopes.map((s) => [keyOf(s), s])), [scopes]);
  const items = useMemo(() => {
    const hit = scopes.filter((s) => matches(s, q));
    const az = [...hit].sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label, "vi") : a.kind === "group" ? -1 : 1));
    const rec = q.trim() ? [] : recent.map((k) => byKey.get(k)).filter((s): s is ScopeOption => Boolean(s));
    return { rec, az, flat: [...rec, ...az] };
  }, [scopes, q, recent, byKey]);
  useEffect(() => setActive(0), [q, open]);
  useEffect(() => { listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  const cur = byKey.get(value);
  const choose = (s: ScopeOption) => { onChange(keyOf(s)); pushRecent(keyOf(s)); setQ(""); setOpen(false); };

  const Option = ({ s, i }: { s: ScopeOption; i: number }) => {
    const plats = [...new Set(s.members.map((m) => m.platform))];
    const second = isCidLike(s.label) ? s.members.map((m) => m.name).filter((n): n is string => Boolean(n) && !isCidLike(n!)).join(" · ") : "";
    const memberHit = q.trim() && !fold(s.label).includes(fold(q.trim())) ? s.members.find((m) => matches({ ...s, label: "", members: [m] }, q)) : null;
    return (
      <li data-i={i} role="option" aria-selected={i === active}>
        <button type="button" onMouseEnter={() => setActive(i)} onClick={() => choose(s)}
          className={cn("flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm", i === active ? "bg-accent-soft" : "hover:bg-inset", keyOf(s) === value && "font-semibold")}>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ink"><Hl text={s.label} q={q} /></span>
            {second ? <span className="block truncate text-xs text-muted"><Hl text={second} q={q} /></span> : null}
            {memberHit ? <span className="block truncate text-xs text-muted">Khớp: <Hl text={`${memberHit.name || memberHit.label}${memberHit.ext ? ` · ${memberHit.ext}` : ""}`} q={q} /></span> : null}
          </span>
          <span className="shrink-0 text-xs text-muted">{s.kind === "group" ? `${s.members.length} TK` : "1 TK"}</span>
          <span className="flex shrink-0 gap-1">{plats.map((p) => <span key={p} className={cn("rounded px-1.5 text-[11px] font-semibold", BADGE[p][1])}>{BADGE[p][0]}</span>)}</span>
        </button>
      </li>
    );
  };

  return (
    <div ref={box} className="relative w-[min(28rem,calc(100vw-2rem))]">
      <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <ChevronsUpDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <input
        value={q}
        role="combobox"
        aria-expanded={open}
        aria-controls="report-scope-list"
        aria-label="Tìm khách hàng hoặc tài khoản"
        placeholder={cur && !open ? `${cur.label}${cur.kind === "group" ? ` (${cur.members.length} TK)` : ""}` : "Gõ tên khách, tên tài khoản, CID, act id…"}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, items.flat.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); const s = items.flat[active]; if (s) choose(s); }
          else if (e.key === "Escape") { setOpen(false); setQ(""); }
        }}
        className={cn("h-9 w-full rounded-lg border border-line bg-paper pl-8 pr-8 text-sm text-ink", cur && !open ? "placeholder:text-ink" : "placeholder:text-subtle")}
      />
      {open ? (
        <ul id="report-scope-list" ref={listRef} role="listbox"
          className="absolute left-0 top-full z-50 mt-1 max-h-[min(24rem,60vh)] w-full overflow-auto rounded-lg border border-line bg-paper py-1 shadow-sheet">
          {items.rec.length ? <li className="px-3 pb-0.5 pt-1 text-[11px] font-semibold uppercase text-subtle">Gần đây</li> : null}
          {items.rec.map((s, i) => <Option key={`r-${keyOf(s)}`} s={s} i={i} />)}
          {items.rec.length ? <li className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase text-subtle">Tất cả (A→Z)</li> : null}
          {items.az.map((s, j) => <Option key={keyOf(s)} s={s} i={items.rec.length + j} />)}
          {!items.flat.length ? <li className="px-3 py-2 text-sm text-muted">Không tìm thấy khách hàng / tài khoản.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
