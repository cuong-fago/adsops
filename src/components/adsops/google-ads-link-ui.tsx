import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { readGoogleAdsLinksFn, setGoogleAdsLinkFn } from "@/lib/adsops/google-ads-link.functions";
import { googleAdsUrl, isGoogleId } from "@/lib/adsops/google-ads-link";

// Shared cache of saved ocids (one fetch per page; refreshed after an Admin edit).
let LINKS: Record<string, string> | null = null;
let inflight: Promise<void> | null = null;
const subs = new Set<() => void>();
function load(force = false) {
  if (inflight && !force) return inflight;
  inflight = readGoogleAdsLinksFn().then((r) => { LINKS = r.links; }).catch(() => { LINKS = LINKS || {}; }).finally(() => { subs.forEach((f) => f()); });
  return inflight;
}
function useLinks(): Record<string, string> | null {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f);
    if (!LINKS) void load();
    return () => { subs.delete(f); };
  }, []);
  return LINKS;
}

/** "Mở Google Ads ↗" (new tab, link only) + Admin ✎ to paste a real Google Ads URL (only its ocid is kept). */
export function GoogleAdsLink({ clientId, cid, isAdmin, className }: { clientId: string; cid: string | null | undefined; isAdmin?: boolean; className?: string }) {
  const links = useLinks();
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  if (!isGoogleId(clientId)) return null;
  const ocid = links?.[clientId] || null;
  const url = googleAdsUrl(cid, ocid);
  async function save(v: string | null) {
    setBusy(true); setMsg("");
    try {
      await setGoogleAdsLinkFn({ data: { clientId, url: v } });
      await load(true);
      setEdit(false); setVal("");
      setMsg(v ? "Đã lưu link." : "Đã xoá link.");
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  return (
    <span className={className}>
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
            title={ocid ? "Mở đúng tài khoản trong Google Ads (link Admin đã lưu), tab mới" : "Mở Google Ads (chọn tài khoản theo mã khách hàng), tab mới"}
            className="inline-flex h-6 items-center rounded-md border border-line bg-paper px-2 text-xs font-medium text-accent hover:bg-inset hover:underline">
            Mở Google Ads ↗
          </a>
        ) : null}
        {ocid ? <span className="text-[11px] text-ok" title={`ocid ${ocid}`}>● đã lưu link</span> : null}
        {isAdmin ? (
          <button type="button" onClick={(e) => { e.stopPropagation(); setEdit((x) => !x); setMsg(""); }} title="Admin: dán link Google Ads của tài khoản" aria-label="Sửa link Google Ads" className="text-muted hover:text-ink">
            <Pencil className="size-3.5" />
          </button>
        ) : null}
      </span>
      {isAdmin && edit ? (
        <form className="mt-1 flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (val.trim()) void save(val); }}>
          <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="Dán link Google Ads (có ocid=…)" aria-label="Link Google Ads"
            className="h-7 min-w-[200px] flex-1 rounded-md border border-line bg-paper px-2 text-xs" />
          <button type="submit" disabled={busy || !val.trim()} className="h-7 rounded-md bg-brand px-2 text-xs font-medium text-accent-fg disabled:opacity-50">Lưu</button>
          {ocid ? <button type="button" disabled={busy} onClick={() => void save(null)} className="h-7 rounded-md border border-line px-2 text-xs text-danger hover:bg-inset">Xoá link</button> : null}
          <button type="button" onClick={() => setEdit(false)} className="h-7 px-1 text-xs text-muted hover:text-ink">Huỷ</button>
        </form>
      ) : null}
      {msg ? <span className="mt-0.5 block text-[11px] text-muted [overflow-wrap:anywhere]">{msg}</span> : null}
    </span>
  );
}
