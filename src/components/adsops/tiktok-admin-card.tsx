import { useCallback, useEffect, useState } from "react";
import { listTikTokConnectionsFn } from "@/lib/adsops/tiktok-ads.functions";
import { Badge, Card } from "@/components/adsops/ui";

const dt = (s: string | null) => (s ? new Date(s).toLocaleString("vi-VN") : "—");
type Conn = Awaited<ReturnType<typeof listTikTokConnectionsFn>>["connections"][number];

/** Admin-only: "Kết nối TikTok Ads" via OAuth. Tokens are stored encrypted on the server and never sent to the browser. */
export function TikTokAdminCard() {
  const [list, setList] = useState<Conn[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [encReady, setEncReady] = useState(true);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await listTikTokConnectionsFn();
      setList(r.connections);
      setConfigured(r.configured);
      setEncReady(r.enc_ready);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    // Result of the OAuth round-trip (/api/tiktok/callback redirects with ?tiktok=ok|error).
    try {
      const u = new URL(window.location.href);
      const t = u.searchParams.get("tiktok");
      if (!t) return;
      if (t === "ok") setResult({ ok: true, text: `Đã kết nối ${u.searchParams.get("n") || "0"} tài khoản TikTok Ads, đã kéo số liệu ${u.searchParams.get("pulled") || "0"} tài khoản. Tải lại trang để thấy trong danh sách tài khoản.` });
      else setResult({ ok: false, text: u.searchParams.get("msg") || "Kết nối TikTok Ads thất bại." });
      for (const k of ["tiktok", "n", "pulled", "msg"]) u.searchParams.delete(k);
      window.history.replaceState(null, "", u.toString());
    } catch { /* ignore */ }
  }, []);

  if (err.includes("Chỉ Admin")) return null;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-ink">Kết nối TikTok Ads</p>
        <Badge tone="neutral" title="AdsOps chỉ ĐỌC số liệu (GET). Mọi lệnh tạo/sửa/xoá tới TikTok bị chặn trong mã nguồn.">Chỉ đọc</Badge>
      </div>
      <p className="text-xs text-muted">Đăng nhập TikTok For Business và cấp quyền cho các tài khoản quảng cáo. Mã truy cập được mã hoá rồi lưu trên máy chủ; trình duyệt không bao giờ nhận lại mã.</p>
      {!configured ? (
        <p className="text-sm text-warn">Chưa cấu hình ứng dụng TikTok</p>
      ) : !encReady ? (
        <p className="text-sm text-warn">Thiếu biến môi trường TIKTOK_ENC_KEY (hoặc OPENAI_ADS_ENC_KEY): chưa thể lưu mã truy cập.</p>
      ) : (
        <div><a href="/api/tiktok/connect" className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-sm font-medium text-white hover:opacity-90">Kết nối TikTok Ads</a></div>
      )}
      {result ? <p className={result.ok ? "text-sm text-ok" : "text-sm text-danger [overflow-wrap:anywhere]"}>{result.text}</p> : null}
      {err ? <p className="text-sm text-danger [overflow-wrap:anywhere]">{err}</p> : null}
      {list && list.length ? (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr><th className="py-1">Tài khoản</th><th>Kết nối bởi</th><th title="Ngày gần nhất đã có số liệu">Số liệu đến</th><th>Kiểm tra OK</th><th>Lỗi</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.map((c) => (
              <tr key={c.client_id}>
                <td className="py-1.5">{c.name || c.advertiser_id}<div className="text-xs text-muted">{c.advertiser_id}{c.currency ? ` · ${c.currency}` : ""}</div></td>
                <td>{c.created_by || "Admin"}</td>
                <td>{c.insights_through ? c.insights_through.split("-").reverse().join("/") : "—"}</td>
                <td>{dt(c.last_ok_at)}</td>
                <td className="text-danger [overflow-wrap:anywhere]">{c.error || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : list && configured ? <p className="text-sm text-muted">Chưa có tài khoản TikTok Ads nào.</p> : null}
    </Card>
  );
}
