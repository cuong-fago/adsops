import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronsUpDown, Search } from "lucide-react";
import { accountMatchesFilter, accountOptionLabel, compareAccountsByAlias } from "@/lib/adsops/account-label";
import { cn } from "@/lib/cn";
import { InactiveBadge, isInactive, useAccountActivity, useShowInactive } from "@/components/adsops/account-activity";

type PickerClient = {
  client_id: string;
  display_name: string;
  customer_id_dashed?: string | null;
  alias?: string | null;
  mcc_id_dashed?: string | null;
  platform?: "google" | "facebook";
};

function PlatformBadge({ id, platform }: { id: string; platform?: string }) {
  const fb = platform === "facebook" || id.startsWith("fb_");
  return (
    <span
      className={cn(
        "mr-2 inline-flex h-5 items-center rounded px-1.5 align-middle text-[11px] font-semibold",
        fb ? "bg-[#e7f0fd] text-[#1d4ed8]" : "bg-inset text-muted",
      )}
    >
      {fb ? "Facebook" : "Google"}
    </span>
  );
}

/** Type-to-filter account picker. A native select cannot filter while open. */
export function AccountPicker({
  label,
  clients,
  value,
  onChange,
  compact = false,
}: {
  label: string;
  clients: PickerClient[];
  value: string;
  onChange: (clientId: string) => void;
  /** Top-bar variant: one row, selected account shown inside the field. */
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const sorted = useMemo(() => [...clients].sort(compareAccountsByAlias), [clients]);
  const activity = useAccountActivity();
  const [showInactive, setShowInactive] = useShowInactive();
  // Inactive accounts: hidden unless toggled or searched for; the selected one always stays; listed last.
  const inactiveCount = sorted.filter((c) => isInactive(activity, c.client_id)).length;
  const filtered = useMemo(() => {
    const hit = sorted.filter((c) => accountMatchesFilter(c, query));
    const on = hit.filter((c) => !isInactive(activity, c.client_id));
    const off = hit.filter((c) => isInactive(activity, c.client_id) && (showInactive || query.trim() || c.client_id === value));
    return [...on, ...off];
  }, [sorted, query, activity, showInactive, value]);
  const selected = sorted.find((c) => c.client_id === value);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function choose(id: string) {
    onChange(id);
    setQuery("");
    setOpen(false);
  }

  const selectedLabel = selected ? accountOptionLabel(selected) : "";
  return (
    <div ref={box} className={cn("relative flex flex-col gap-1", compact && "w-full")}>
      <span className={compact ? "sr-only" : "text-xs font-medium text-muted"}>{label}</span>
      {compact ? <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" /> : null}
      {compact ? <ChevronsUpDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-subtle" /> : null}
      <input
        value={query}
        title={compact ? selectedLabel || undefined : undefined}
        placeholder={compact && !open && selectedLabel ? selectedLabel : "Gõ CID hoặc tên…"}
        aria-label="Lọc tài khoản theo CID hoặc tên"
        aria-expanded={open}
        aria-controls="adsops-account-list"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            return;
          }
          if (e.key === "Enter" && filtered[0]) {
            e.preventDefault();
            choose(filtered[0].client_id);
          }
        }}
        className={
          compact
            ? cn(
                "h-9 w-full truncate rounded-lg border border-line bg-inset pl-9 pr-9 text-sm text-ink transition-colors hover:border-line-strong focus:bg-paper",
                !open && selectedLabel ? "placeholder:font-medium placeholder:text-ink" : "placeholder:text-subtle",
              )
            : "h-11 w-full rounded-lg border border-line bg-paper px-3 text-base text-ink"
        }
      />
      {compact ? null : (
        <p className="truncate text-xs font-normal text-ink">
          {selected ? <><PlatformBadge id={selected.client_id} platform={selected.platform} />{accountOptionLabel(selected)}</> : "Chưa chọn tài khoản"}
        </p>
      )}
      {open ? (
        <ul
          id="adsops-account-list"
          role="listbox"
          className={cn(
            "absolute top-full z-50 mt-1 max-h-80 overflow-auto rounded-lg border border-line bg-paper py-1 shadow-sheet",
            compact ? "right-0 w-[min(36rem,calc(100vw-2rem))]" : "left-0 right-0",
          )}
        >
          {filtered.length ? (
            filtered.map((c) => (
              <li key={c.client_id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={c.client_id === value}
                  className={cn(
                    "block w-full px-3 py-2 text-left text-sm text-ink",
                    c.client_id === value ? "bg-accent-soft font-medium" : "hover:bg-inset",
                  )}
                  onClick={() => choose(c.client_id)}
                >
                  <PlatformBadge id={c.client_id} platform={c.platform} />
                  {accountOptionLabel(c)}
                  {isInactive(activity, c.client_id) ? <span className="ml-2"><InactiveBadge activity={activity?.[c.client_id]} /></span> : null}
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-sm text-muted">Không có tài khoản khớp.</li>
          )}
          {inactiveCount ? (
            <li className="border-t border-line">
              <button type="button" onClick={() => setShowInactive(!showInactive)} className="block w-full px-3 py-2 text-left text-xs font-medium text-muted hover:bg-inset">
                {showInactive ? "Ẩn tài khoản không hoạt động" : `Hiện cả tài khoản không hoạt động (${inactiveCount})`}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
