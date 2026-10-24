import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { NavTab } from "@/components/adsops/brand";
import { cn } from "@/lib/cn";

type Icon = ComponentType<{ className?: string }>;
export type NavItem = { id: string; label: ReactNode; text: string; icon?: Icon; badge?: number; dot?: boolean; active: boolean; onClick: () => void };
export type NavEntry = { kind: "tab"; item: NavItem } | { kind: "group"; id: string; label: string; icon?: Icon; items: NavItem[] };

const useLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Popover menu: click-outside / Escape close, arrow keys move focus. */
function Menu({ button, children, align = "left", label }: { button: (p: { open: boolean; toggle: () => void }) => ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; label: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent | TouchEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); (box.current?.querySelector("button") as HTMLButtonElement | null)?.focus(); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const els = [...(box.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") || [])];
      if (!els.length) return;
      e.preventDefault();
      const i = els.indexOf(document.activeElement as HTMLButtonElement);
      els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length].focus();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("touchstart", down);
    document.addEventListener("keydown", key);
    // Focus the first item for keyboard users.
    setTimeout(() => box.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus(), 0);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("touchstart", down); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div ref={box} className="relative shrink-0">
      {button({ open, toggle: () => setOpen((o) => !o) })}
      {open ? (
        <div role="menu" aria-label={label} className={cn("absolute top-full z-50 mt-2 max-h-[70vh] min-w-[220px] overflow-y-auto rounded-lg border border-line bg-paper p-1 shadow-sheet", align === "right" ? "right-0" : "left-0")}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({ it, close }: { it: NavItem; close: () => void }) {
  const I = it.icon;
  return (
    <button type="button" role="menuitem" aria-current={it.active ? "page" : undefined} onClick={() => { it.onClick(); close(); }}
      className={cn("flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent", it.active ? "bg-accent-soft text-accent" : "text-ink hover:bg-inset focus:bg-inset")}>
      {I ? <I className={cn("size-4 shrink-0", it.active ? "text-accent" : "text-muted")} /> : null}
      <span className="flex-1">{it.label}</span>
      {it.dot ? <span className="size-1.5 rounded-full bg-danger" /> : null}
      {it.badge ? <span className="rounded-sm bg-danger px-1.5 text-[11px] font-bold text-white">{it.badge > 99 ? "99+" : it.badge}</span> : null}
    </button>
  );
}

function GroupButton({ g, open, toggle }: { g: Extract<NavEntry, { kind: "group" }>; open: boolean; toggle: () => void }) {
  const act = g.items.find((i) => i.active);
  const badge = g.items.reduce((s, i) => s + (i.badge || 0), 0);
  const dot = g.items.some((i) => i.dot);
  const I = act?.icon || g.icon;
  return (
    <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={toggle} title={g.label}
      className={cn(
        "relative inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3.5 text-[15px] font-semibold transition-colors",
        "after:pointer-events-none after:absolute after:inset-x-2 after:-bottom-[7px] after:h-0.5 after:rounded-full",
        act ? "bg-accent-soft text-accent after:bg-accent" : "text-ink/85 after:bg-transparent hover:bg-inset hover:text-ink",
      )}>
      {I ? <I className={cn("size-4 shrink-0", act ? "text-accent" : "text-muted")} /> : null}
      {act ? <span><span className="mr-1 text-[11px] font-semibold uppercase tracking-wider opacity-70">{g.label}:</span>{act.text}</span> : g.label}
      {dot ? <span className="size-1.5 rounded-full bg-danger" /> : null}
      {badge ? <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-danger px-1.5 text-[11px] font-bold text-white">{badge > 99 ? "99+" : badge}</span> : null}
      <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
    </button>
  );
}

function Entry({ e }: { e: NavEntry }) {
  if (e.kind === "tab") {
    const it = e.item;
    return (
      <NavTab icon={it.icon} badge={it.badge} active={it.active} onClick={it.onClick}>
        {it.label}{it.dot ? <span className="ml-1.5 inline-block size-1.5 rounded-full bg-danger" /> : null}
      </NavTab>
    );
  }
  return (
    <Menu label={e.label} button={({ open, toggle }) => <GroupButton g={e} open={open} toggle={toggle} />}>
      {(close) => e.items.map((it) => <MenuItem key={it.id} it={it} close={close} />)}
    </Menu>
  );
}

/**
 * Top navigation: main tabs + group dropdowns; whatever does not fit the width moves into "Thêm".
 * Widths come from an invisible measuring row, re-measured on resize.
 */
export function NavBar({ entries, className }: { entries: NavEntry[]; className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const meas = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(entries.length);
  const sig = entries.map((e) => (e.kind === "tab" ? `${e.item.id}:${e.item.active}:${e.item.badge || 0}:${e.item.dot ? 1 : 0}` : `${e.id}:${e.items.map((i) => `${i.id}${i.active ? "*" : ""}${i.badge || 0}`).join(".")}`)).join("|");
  useLayout(() => {
    const calc = () => {
      const w = wrap.current?.clientWidth || 0;
      const kids = [...(meas.current?.children || [])] as HTMLElement[];
      if (!w || !kids.length) return;
      const more = kids[kids.length - 1].offsetWidth;
      const ws = kids.slice(0, -1).map((k) => k.offsetWidth);
      const GAP = 6;
      const total = ws.reduce((s, x) => s + x + GAP, 0);
      if (total <= w) { setFit(ws.length); return; }
      let used = more + GAP, n = 0;
      for (const x of ws) { if (used + x + GAP > w) break; used += x + GAP; n++; }
      setFit(Math.max(0, n));
    };
    calc();
    const ro = new ResizeObserver(calc);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [sig]);
  const shown = entries.slice(0, fit);
  const rest = entries.slice(fit);
  const restActive = rest.some((e) => (e.kind === "tab" ? e.item.active : e.items.some((i) => i.active)));
  return (
    <div ref={wrap} className={cn("relative min-w-0 flex-1", className)}>
      {/* Measuring row: same markup, invisible, never clipped. */}
      <div ref={meas} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap" style={{ width: "max-content" }}>
        {entries.map((e) => <div key={e.kind === "tab" ? e.item.id : e.id} className="shrink-0"><Entry e={e} /></div>)}
        <div className="shrink-0"><MoreBtn active={false} open={false} toggle={() => {}} /></div>
      </div>
      <div className="flex items-center gap-1.5">
        {shown.map((e) => <Entry key={e.kind === "tab" ? e.item.id : e.id} e={e} />)}
        {rest.length ? (
          <Menu label="Thêm" align="right" button={({ open, toggle }) => <MoreBtn active={restActive} open={open} toggle={toggle} />}>
            {(close) => rest.map((e) =>
              e.kind === "tab" ? <MenuItem key={e.item.id} it={e.item} close={close} /> : (
                <div key={e.id} className="py-1">
                  <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">{e.label}</p>
                  {e.items.map((it) => <MenuItem key={it.id} it={it} close={close} />)}
                </div>
              ))}
          </Menu>
        ) : null}
      </div>
    </div>
  );
}

function MoreBtn({ active, open, toggle }: { active: boolean; open: boolean; toggle: () => void }) {
  return (
    <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={toggle} title="Thêm"
      className={cn("inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md px-3 text-[15px] font-semibold", active ? "bg-accent-soft text-accent" : "text-ink/85 hover:bg-inset")}>
      <MoreHorizontal className="size-4" /> Thêm
    </button>
  );
}

/**
 * Mobile bottom navigation (< md). Shows up to 4 destinations (the active one always included)
 * plus "Thêm", which opens a bottom sheet with every destination. 44px+ touch targets, safe-area aware.
 */
export function BottomNav({ entries, pin }: { entries: NavEntry[]; /** Fixed mobile bar (≤ 4) + "Thêm" for everything else. */ pin?: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const all = entries.flatMap((e) => (e.kind === "tab" ? [e.item] : e.items));
  const MAX = all.length <= 5 ? 5 : 4;
  let shown = all.slice(0, MAX);
  const act = all.find((i) => i.active);
  if (act && !shown.includes(act)) shown = [...shown.slice(0, MAX - 1), act];
  let more = all.length > shown.length;
  let moreActive = false;
  if (pin && pin.length >= 2) {
    shown = pin.slice(0, 4);
    more = true;
    moreActive = !shown.some((i) => i.active);
  }
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);
  const short = (t: string) => t.replace(/ \(.*\)$/, "").replace("Tổng quan tài khoản", "Tổng quan").replace("Báo cáo khách hàng", "Báo cáo KH").replace("Nhật ký tối ưu", "Nhật ký").replace("So sánh tài khoản", "So sánh").replace("Bảng điều hành", "Điều hành");
  const Btn = ({ it }: { it: NavItem }) => {
    const I = it.icon;
    return (
      <button type="button" onClick={() => { it.onClick(); setOpen(false); }} aria-current={it.active ? "page" : undefined}
        className={cn("relative flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-semibold", it.active ? "text-accent" : "text-muted")}>
        {I ? <I className="size-5" /> : null}
        <span className="max-w-full truncate">{short(it.text)}</span>
        {it.badge ? <span className="absolute right-[18%] top-1 rounded-sm bg-danger px-1 text-[10px] font-bold text-white">{it.badge > 99 ? "99+" : it.badge}</span> : it.dot ? <span className="absolute right-[30%] top-2 size-1.5 rounded-full bg-danger" /> : null}
      </button>
    );
  };
  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Tất cả mục">
          <button type="button" aria-label="Đóng" className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[75vh] overflow-y-auto rounded-t-2xl bg-paper p-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-sheet">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line" />
            {entries.map((e) => e.kind === "tab" ? <MenuItem key={e.item.id} it={e.item} close={() => setOpen(false)} /> : (
              <div key={e.id} className="py-1">
                <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">{e.label}</p>
                {e.items.map((it) => <MenuItem key={it.id} it={it} close={() => setOpen(false)} />)}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <nav aria-label="Điều hướng chính" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {shown.map((it) => <Btn key={it.id} it={it} />)}
        {more ? (
          <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className={cn("flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold", open || moreActive ? "text-accent" : "text-muted")}>
            <MoreHorizontal className="size-5" /> Thêm
          </button>
        ) : null}
      </nav>
    </>
  );
}
