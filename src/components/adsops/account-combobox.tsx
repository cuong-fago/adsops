import { useEffect, useMemo, useRef, useState } from "react";

export type ComboAccount = { client_id: string; name: string; cid: string };

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();
const dash = (c: string) => { const d = c.replace(/\D/g, ""); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : c; };

export function matchAccount(a: ComboAccount, q: string): boolean {
  const t = fold(q.trim());
  if (!t) return true;
  const digits = t.replace(/[\s-]/g, "");
  if (/^\d+$/.test(digits) && a.cid.replace(/\D/g, "").includes(digits)) return true;
  const hay = fold(`${a.name} ${dash(a.cid)}`);
  return t.split(/\s+/).every((w) => hay.includes(w));
}

/**
 * Searchable account picker. mode "select": value is client_id, text is only a filter.
 * mode "free": value is the typed text (e.g. CID); picking fills the dashed CID.
 */
export function AccountCombobox({ accounts, value, onChange, mode = "select", placeholder = "Tìm tên hoặc CID…", className = "", size = "md" }: {
  accounts: ComboAccount[]; value: string; onChange: (v: string) => void; mode?: "select" | "free"; placeholder?: string; className?: string; size?: "sm" | "md";
}) {
  const selected = mode === "select" ? accounts.find((a) => a.client_id === value) : undefined;
  const label = selected ? `${selected.name} · ${dash(selected.cid)}` : mode === "free" ? value : "";
  const [q, setQ] = useState(label);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => { if (!open) setQ(label); }, [label, open]);
  const items = useMemo(() => {
    const filterBy = open && q !== label ? q : "";
    return accounts.filter((a) => matchAccount(a, filterBy)).slice(0, 200);
  }, [accounts, q, open, label]);
  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => { list.current?.children[hi]?.scrollIntoView({ block: "nearest" }); }, [hi]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const pick = (a: ComboAccount) => { onChange(mode === "select" ? a.client_id : dash(a.cid)); setQ(`${a.name} · ${dash(a.cid)}`); setOpen(false); };
  const h = size === "sm" ? "h-7 text-xs" : "h-8 text-sm";
  return (
    <div ref={box} className={`relative ${className}`}>
      <input
        role="combobox" aria-expanded={open} aria-autocomplete="list"
        value={open ? q : label} placeholder={placeholder}
        onFocus={(e) => { setOpen(true); setQ(label); e.currentTarget.select(); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); if (mode === "free") onChange(e.target.value); else if (!e.target.value) onChange(""); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((i) => Math.min(i + 1, items.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter") { if (open && items[hi]) { e.preventDefault(); pick(items[hi]); } }
          else if (e.key === "Escape" || e.key === "Tab") setOpen(false);
        }}
        className={`block w-full rounded-md border border-line bg-paper px-2 text-ink ${h}`}
      />
      {open ? (
        <ul ref={list} role="listbox" className="absolute z-30 mt-1 max-h-72 w-full min-w-[18rem] overflow-auto rounded-md border border-line bg-paper py-1 text-sm shadow-lg">
          {items.length ? items.map((a, i) => (
            <li key={a.client_id} role="option" aria-selected={i === hi}
              onMouseDown={(e) => { e.preventDefault(); pick(a); }} onMouseEnter={() => setHi(i)}
              className={`cursor-pointer px-2 py-3 md:py-1 ${i === hi ? "bg-brand/10" : ""} ${a.client_id === value ? "font-semibold" : ""}`}>
              <span className="text-ink">{a.name}</span> <span className="text-muted">· {dash(a.cid)}</span>
            </li>
          )) : <li className="px-2 py-1 text-muted">{mode === "free" ? "Không khớp — vẫn dùng CID đã gõ" : "Không có tài khoản khớp"}</li>}
        </ul>
      ) : null}
    </div>
  );
}
