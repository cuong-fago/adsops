import { useCallback, useEffect, useState } from "react";
import { getMetaStatusFn, syncMetaNowFn, type MetaStatus } from "@/lib/adsops/meta-ads.functions";
import { Badge, Button, Card } from "@/components/adsops/ui";

const TOKEN_VI: Record<MetaStatus["token"], { text: string; tone: "ok" | "danger" | "warn" }> = {
  valid: { text: "Token hợp lệ", tone: "ok" },
  invalid: { text: "Token không hợp lệ", tone: "danger" },
  missing: { text: "Chưa có token", tone: "warn" },
};

/** Admin-only: Meta token health + "Kéo tài khoản Facebook". The token itself is never shown. */
export function MetaAdminCard() {
  const [s, setS] = useState<MetaStatus | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<"" | "load" | "sync">("load");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setBusy("load");
    try { setS((await getMetaStatusFn()) as MetaStatus); setErr(""); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function sync() {
    setBusy("sync");
    setMsg("");
    try {
      const r = await syncMetaNowFn();
      setMsg(r.errors.length ? `Lỗi: ${r.errors.slice(0, 2).join(" · ")}` : `Đã kéo ${r.accounts} tài khoản (${r.done} xong số liệu, ${r.inserted} mới). Tải lại trang để thấy trong danh sách.`);
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    setBusy("");
    void load();
  }

  const tk = s ? TOKEN_VI[s.token] : null;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-ink">Facebook Ads (Meta)</p>
        {tk ? <Badge tone={tk.tone}>{tk.text}</Badge> : null}
      </div>
      {err ? <p className="text-sm text-danger">{err}</p> : null}
      {s ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
          <div><dt className="text-xs text-muted">Token thấy</dt><dd className="tabular-nums text-ink">{s.accounts_visible ?? "—"} tài khoản</dd></div>
          <div><dt className="text-xs text-muted">Đã lưu trong AdsOps</dt><dd className="tabular-nums text-ink">{s.accounts_in_db ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted">Dòng số liệu</dt><dd className="tabular-nums text-ink">{s.insights_rows ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted">Lần kéo gần nhất</dt><dd className="text-ink">{s.last_checked ? new Date(s.last_checked).toLocaleString("vi-VN") : "Chưa kéo"}</dd></div>
        </dl>
      ) : null}
      {s?.error ? <p className="text-sm text-danger [overflow-wrap:anywhere]">{s.error}</p> : null}
      {s && s.token !== "valid" && s.token_length === 10 ? (
        <p className="text-sm text-warn">Giá trị token dài đúng 10 ký tự, thường là chữ “[REDACTED]” bị lưu nhầm. Dán lại token thật vào Vercel rồi redeploy.</p>
      ) : null}
      {s && !s.tables_ok ? <p className="text-sm text-warn">Bảng Meta (migration 0017) chưa có trong DB.</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={sync} disabled={busy !== "" || s?.token !== "valid"}>{busy === "sync" ? "Đang kéo…" : "Kéo tài khoản Facebook"}</Button>
        <Button size="sm" variant="ghost" onClick={load} disabled={busy !== ""}>Kiểm tra token</Button>
        {msg ? <span className="text-sm text-muted">{msg}</span> : null}
      </div>
    </Card>
  );
}
