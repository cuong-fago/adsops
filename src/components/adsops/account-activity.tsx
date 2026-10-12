import { useEffect, useState } from "react";
import { readAccountActivityFn, type AccountActivity } from "@/lib/adsops/account-activity.functions";
import { cn } from "@/lib/cn";

const KEY = "adsops.showInactive";
const EVT = "adsops-show-inactive";
let cache: { at: number; p: Promise<Record<string, AccountActivity>> } | null = null;

function loadActivity(): Promise<Record<string, AccountActivity>> {
  if (!cache || Date.now() - cache.at > 5 * 60_000) {
    cache = { at: Date.now(), p: readAccountActivityFn().then((r) => r.accounts).catch(() => ({})) };
  }
  return cache.p;
}

/** client_id → activity (null while loading; then unknown accounts are simply absent). */
export function useAccountActivity(): Record<string, AccountActivity> | null {
  const [map, setMap] = useState<Record<string, AccountActivity> | null>(null);
  useEffect(() => {
    let alive = true;
    void loadActivity().then((m) => { if (alive) setMap(m); });
    return () => { alive = false; };
  }, []);
  return map;
}

/** "Hiện cả tài khoản không hoạt động": one setting for every list, remembered in localStorage. */
export function useShowInactive(): [boolean, (v: boolean) => void] {
  const read = () => {
    try { return window.localStorage.getItem(KEY) === "1"; } catch { return false; }
  };
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(read());
    const on = () => setShow(read());
    window.addEventListener(EVT, on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener(EVT, on); window.removeEventListener("storage", on); };
  }, []);
  const set = (v: boolean) => {
    try { window.localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* private mode */ }
    setShow(v);
    window.dispatchEvent(new Event(EVT));
  };
  return [show, set];
}

export function isInactive(map: Record<string, AccountActivity> | null, id: string): boolean {
  return map?.[id]?.state === "inactive";
}

/** Rows to show: inactive hidden unless toggled (the `keep` id, e.g. the selected account, always stays). */
export function useActiveFilter<T>(rows: T[] | null, idOf: (r: T) => string, keep?: string) {
  const map = useAccountActivity();
  const [show, setShow] = useShowInactive();
  const inactiveCount = (rows || []).filter((r) => isInactive(map, idOf(r))).length;
  const shown = rows ? rows.filter((r) => show || !isInactive(map, idOf(r)) || idOf(r) === keep) : null;
  return { map, show, setShow, inactiveCount, shown };
}

export function InactiveToggle({ show, onChange, count, className }: { show: boolean; onChange: (v: boolean) => void; count: number; className?: string }) {
  if (!count && !show) return null;
  return (
    <label className={cn("inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-line bg-paper px-3 text-sm", className)}>
      <input type="checkbox" checked={show} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--color-accent)]" />
      Hiện cả tài khoản không hoạt động ({count})
    </label>
  );
}

export function InactiveBadge({ activity }: { activity: AccountActivity | undefined }) {
  if (activity?.state !== "inactive") return null;
  return (
    <span className="mt-0.5 inline-flex rounded-full bg-inset px-2 py-0.5 text-[11px] font-medium text-muted" title={activity.google_status ? `Google: ${activity.google_status}` : undefined}>
      Không hoạt động · {activity.reason}
    </span>
  );
}
