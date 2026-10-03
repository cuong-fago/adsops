import { useEffect, useMemo, useRef, useState } from "react";
import { accountMatchesFilter, accountOptionLabel, compareAccountsByAlias } from "@/lib/adsops/account-label";
import { cn } from "@/lib/cn";

type PickerClient = {
  client_id: string;
  display_name: string;
  customer_id_dashed?: string | null;
  alias?: string | null;
  mcc_id_dashed?: string | null;
};

/** Type-to-filter account picker. A native select cannot filter while open. */
export function AccountPicker({
  label,
  clients,
  value,
  onChange,
}: {
  label: string;
  clients: PickerClient[];
  value: string;
  onChange: (clientId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const sorted = useMemo(() => [...clients].sort(compareAccountsByAlias), [clients]);
  const filtered = useMemo(() => sorted.filter((c) => accountMatchesFilter(c, query)), [sorted, query]);
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

  return (
    <div ref={box} className="relative flex flex-col gap-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      <input
        value={query}
        placeholder="Gõ CID hoặc tên…"
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
        className="h-11 w-full rounded-md border border-line bg-bg px-3 text-base text-ink"
      />
      <p className="truncate text-xs font-normal text-ink">
        {selected ? accountOptionLabel(selected) : "Chưa chọn tài khoản"}
      </p>
      {open ? (
        <ul
          id="adsops-account-list"
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-md border border-line bg-paper shadow-sheet"
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
                    c.client_id === value ? "bg-accent/15" : "hover:bg-inset",
                  )}
                  onClick={() => choose(c.client_id)}
                >
                  {accountOptionLabel(c)}
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-sm text-muted">Không có tài khoản khớp.</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
