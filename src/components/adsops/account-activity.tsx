import { useEffect, useState } from "react";
import { readAccountActivityFn, type AccountActivity } from "@/lib/adsops/account-activity.functions";
import { cn } from "@/lib/cn";

const KEY = "adsops.showInactive";
const EVT = "adsops-show-inactive";
let cache: { at: number; p: Promise<{ accounts: Record<string, AccountActivity>; can_show_inactive: boolean }> } | null = null;

function loadRead() {
  if (!cache || Date.now() - cache.at > 5 * 60_000) {
    cache = { at: Date.now(), p: readAccountActivityFn().then((r) => ({ accounts: r.accounts, can_show_inactive: r.can_show_inactive === true })).catch(() => ({ accounts: {}, can_show_inactive: false })) };
  }
  return cache.p;
}
function loadActivity(): Promise<Record<string, AccountActivity>> {
  return loadRead().then((r) => r.accounts);
}

/** Server decides: only a real Admin may show hidden (inactive) accounts. False while loading. */
export function useCanShowInactive(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadRead().then((r) => { if (alive) setOk(r.can_show_inactive); });
    return () => { alive = false; };
  }, []);
  return ok;
}

/** Drop the cached activity so the next read sees fresh hide / re-include decisions (after a recheck). */
export function invalidateActivity() {
  cache = null;
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
  const canShow = useCanShowInactive();
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
  // Non-admins: inactive accounts always stay hidden (a stale "1" in localStorage is ignored).
  return [canShow && show, canShow ? set : () => {}];
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
  const canShow = useCanShowInactive();
  if (!canShow || (!count && !show)) return null;
  return (
    <label className={cn("inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-line bg-paper px-3 text-sm", className)}>
      <input type="checkbox" checked={show} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--color-accent)]" />
      <span title="Ẩn: không chi tiêu 10 ngày (tự hiện lại khi có chi tiêu), hoặc Google tạm ngưng / đã huỷ. Không xoá dữ liệu.">
        Đã ẩn {count} tài khoản không hoạt động · hiện
      </span>
    </label>
  );
}

export function InactiveBadge({ activity }: { activity: AccountActivity | undefined }) {
  if (activity?.systemic) {
    return (
      <span className="mt-1 inline-flex h-5 items-center rounded-sm bg-warn-bg px-1.5 text-[11px] font-medium text-warn" title={[activity.systemic, activity.error].filter(Boolean).join("\n")}>
        Lỗi chung MCC — không ẩn
      </span>
    );
  }
  if (activity?.state !== "inactive") return null;
  const tip = [activity.google_status ? `Google: ${activity.google_status}` : "", activity.error || ""].filter(Boolean).join("\n");
  return (
    <span className="mt-1 inline-flex h-5 items-center rounded-sm bg-inset px-1.5 text-[11px] font-medium text-muted" title={tip || undefined}>
      Không hoạt động · {activity.reason}
    </span>
  );
}
