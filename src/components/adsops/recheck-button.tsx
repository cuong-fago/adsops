import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { recheckAccountFn } from "@/lib/adsops/recheck.functions";
import { cn } from "@/lib/cn";

/** Staff account strip: re-check budget + score (+ shared lists) for this account now. */
export function RecheckButton({ clientId, onDone }: { clientId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "muted" | "danger" } | null>(null);
  async function run() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await recheckAccountFn({ data: { clientId } });
      if (r.state === "cooldown") setMsg({ text: "Vừa kiểm tra, thử lại sau", tone: "muted" });
      else {
        if (r.error_vi) setMsg({ text: r.error_vi, tone: "danger" });
        onDone();
      }
    } catch (err) {
      setMsg({ text: err instanceof Error && err.message ? err.message : "Không kiểm tra được.", tone: "danger" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        title="Kiểm tra lại ngân sách và điểm tối ưu của tài khoản này ngay (chỉ đọc Google Ads)"
        className="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-paper px-2 text-xs font-medium text-ink hover:border-line-strong hover:bg-inset disabled:opacity-60"
      >
        <RefreshCw className={cn("size-3", busy && "animate-spin")} /> {busy ? "Đang kiểm tra…" : "Kiểm tra lại"}
      </button>
      {msg ? <span className={cn("text-xs [overflow-wrap:anywhere]", msg.tone === "danger" ? "text-danger" : "text-muted")}>{msg.text}</span> : null}
    </span>
  );
}
