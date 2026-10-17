import { useCallback, useEffect, useState } from "react";
import { connectOpenAIKeyFn, listOpenAIConnectionsFn, type OAConnection } from "@/lib/adsops/openai-ads.functions";
import { Badge, Button, Card } from "@/components/adsops/ui";

const dt = (s: string | null) => (s ? new Date(s).toLocaleString("vi-VN") : "—");

/** Admin-only: "Kết nối ChatGPT Ads". Keys are validated + stored encrypted on the server and never shown again. */
export function OpenAIAdminCard() {
  const [list, setList] = useState<OAConnection[] | null>(null);
  const [encReady, setEncReady] = useState(true);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await listOpenAIConnectionsFn();
      setList(r.connections);
      setEncReady(r.enc_ready);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    setMsg("");
    setErr("");
    const k = key;
    setKey("");
    try {
      const r = await connectOpenAIKeyFn({ data: { key: k } });
      setMsg(`Đã kết nối “${r.name}” (${r.currency || "?"}, ${r.timezone || "?"}). ${r.pulled ? "Đã kéo số liệu." : `Chưa kéo được số liệu: ${r.error_vi || "lỗi"}`} Tải lại trang để thấy trong danh sách tài khoản.`);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    }
    setBusy(false);
    void load();
  }

  if (err.includes("Chỉ Admin")) return null;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-ink">Kết nối ChatGPT Ads</p>
        <Badge tone="neutral" title="AdsOps chỉ ĐỌC số liệu (GET). Mọi lệnh tạo/sửa/xoá tới OpenAI bị chặn trong mã nguồn.">Chỉ đọc</Badge>
      </div>
      <p className="text-xs text-muted">Mỗi tài khoản quảng cáo ChatGPT có một API key riêng (Ads Manager → Settings). Key được kiểm tra với OpenAI, mã hoá rồi lưu trên máy chủ; trình duyệt không bao giờ nhận lại key.</p>
      {!encReady ? <p className="text-sm text-warn">Thiếu biến môi trường OPENAI_ADS_ENC_KEY: chưa thể lưu key.</p> : null}
      <form onSubmit={connect} className="flex flex-wrap items-center gap-2">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Dán API key ChatGPT Ads"
          className="h-9 min-w-[280px] flex-1 rounded-lg border border-line bg-paper px-3 text-sm"
        />
        <Button size="sm" type="submit" disabled={busy || !key.trim() || !encReady}>{busy ? "Đang kiểm tra…" : "Kiểm tra & lưu"}</Button>
      </form>
      {msg ? <p className="text-sm text-ok">{msg}</p> : null}
      {err ? <p className="text-sm text-danger [overflow-wrap:anywhere]">{err}</p> : null}
      {list && list.length ? (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr><th className="py-1">Tài khoản</th><th>Nguồn key</th><th title="Ngày gần nhất đã có số liệu">Số liệu đến</th><th>Kiểm tra OK</th><th>Lỗi</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.map((c) => (
              <tr key={c.ad_account_id}>
                <td className="py-1.5">{c.name || c.ad_account_id}<div className="text-xs text-muted">{c.ad_account_id}</div></td>
                <td>{c.source === "env" ? "Biến môi trường" : `Dán bởi ${c.created_by || "Admin"}`}</td>
                <td>{c.insights_through ? c.insights_through.split("-").reverse().join("/") : "—"}</td>
                <td>{dt(c.last_ok_at)}</td>
                <td className="text-danger [overflow-wrap:anywhere]">{c.last_error || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : list ? <p className="text-sm text-muted">Chưa có tài khoản ChatGPT Ads nào.</p> : null}
    </Card>
  );
}
