import { useCallback, useEffect, useState } from "react";
import {
  disconnectGoogleAds,
  getGoogleAdsStatus,
  testGoogleAdsConnection,
  type GoogleAdsStatus,
  type GoogleAdsTestResult,
} from "@/lib/adsops/google-ads.functions";
import { formatSaigon } from "@/lib/adsops/permissions.types";
import { cn } from "@/lib/cn";

const btn = "h-10 rounded-md border border-line-strong bg-inset px-3 text-sm font-medium text-ink hover:bg-line disabled:opacity-60";
const btnPrimary = "inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-60";
const btnDanger = "h-10 rounded-md px-3 text-sm text-danger hover:bg-inset disabled:opacity-60";
const card = "rounded-xl bg-paper p-5 shadow-sheet";

const REASON_VI: Record<string, string> = {
  state: "Phiên kết nối hết hạn hoặc không khớp — bấm lại “Kết nối Google Ads”.",
  denied: "Bạn đã từ chối cấp quyền trên màn hình Google.",
  consent: "Google báo lỗi ở màn hình cấp quyền (kiểm tra OAuth consent screen có scope adwords).",
  no_code: "Google không trả mã xác thực — thử lại.",
  oauth_client_missing: "Thiếu OAuth client (GOOGLE_ADS_CLIENT_ID/SECRET hoặc GOOGLE_CLIENT_ID/SECRET).",
  exchange: "Không đổi được mã lấy token — kiểm tra Redirect URI đã thêm vào OAuth client và client secret đúng.",
  no_refresh_token: "Google không trả refresh token — thử lại (màn hình phải hỏi quyền đầy đủ).",
  scope: "Chưa tích quyền Google Ads trên màn hình Google — kết nối lại và cho phép quyền quản lý Google Ads.",
  store: "Không lưu được token vào Neon (thiếu bảng hoặc thiếu BETTER_AUTH_SECRET).",
};

const SOURCE_VI: Record<string, string> = {
  env: "biến môi trường",
  neon: "nút Kết nối (lưu mã hoá trên Neon)",
  GOOGLE_ADS_CLIENT_ID: "GOOGLE_ADS_CLIENT_ID/SECRET",
  GOOGLE_CLIENT_ID: "OAuth client đăng nhập (GOOGLE_CLIENT_ID/SECRET)",
  default: "mặc định 532-145-0531",
};

function src(v: string | null | undefined): string {
  return v ? SOURCE_VI[v] || v : "chưa có";
}

function errMsg(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function GoogleAdsAdminCard({ readOnly }: { readOnly?: boolean }) {
  const [status, setStatus] = useState<GoogleAdsStatus | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [busy, setBusy] = useState<"" | "test" | "disconnect">("");
  const [test, setTest] = useState<GoogleAdsTestResult | null>(null);
  const [flash, setFlash] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus((await getGoogleAdsStatus()) as GoogleAdsStatus);
      setLoadErr("");
    } catch (err) {
      setLoadErr(errMsg(err, "Không đọc được trạng thái Google Ads."));
    }
  }, []);

  useEffect(() => {
    void load();
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const g = url.searchParams.get("gads");
    if (g) {
      if (g === "connected") setFlash("Đã kết nối Google Ads. Bấm “Thử kết nối” để kiểm tra.");
      else setFlash(REASON_VI[url.searchParams.get("reason") || ""] || "Kết nối Google Ads không thành công.");
      url.searchParams.delete("gads");
      url.searchParams.delete("reason");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }, [load]);

  async function runTest() {
    setBusy("test");
    setTest(null);
    try {
      setTest((await testGoogleAdsConnection()) as GoogleAdsTestResult);
      await load();
    } catch (err) {
      setTest({ ok: false, message_vi: errMsg(err, "Không thử được kết nối.") });
    } finally {
      setBusy("");
    }
  }

  async function runDisconnect() {
    if (!window.confirm("Ngắt kết nối Google Ads? Token đã lưu sẽ bị xoá (biến môi trường, nếu có, vẫn giữ).")) return;
    setBusy("disconnect");
    try {
      await disconnectGoogleAds();
      setTest(null);
      setFlash("Đã xoá token Google Ads đã lưu.");
      await load();
    } catch (err) {
      setFlash(errMsg(err, "Không ngắt được kết nối."));
    } finally {
      setBusy("");
    }
  }

  async function copyRedirect() {
    if (!status?.redirect_uri) return;
    try {
      await navigator.clipboard.writeText(status.redirect_uri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  const ready = Boolean(status?.ready);
  return (
    <section className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-medium tracking-tight">Google Ads API</h2>
          <p className="mt-1 text-sm text-muted">Chỉ đọc số (không sửa gì trên Google Ads). Chỉ admin thấy thẻ này.</p>
        </div>
        {status ? (
          <span
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium",
              ready ? "bg-accent/15 text-accent" : "bg-danger/10 text-danger",
            )}
          >
            {ready ? "Đã cấu hình" : "Chưa cấu hình đủ"}
          </span>
        ) : null}
      </div>

      {flash ? <p className="mt-3 rounded-md bg-inset px-3 py-2 text-sm">{flash}</p> : null}
      {loadErr ? <p className="mt-3 text-sm text-danger">{loadErr}</p> : null}

      {status ? (
        <div className="mt-4 flex flex-col gap-3 text-sm">
          {status.missing.length ? (
            <div className="rounded-md border border-danger/30 px-3 py-2">
              <p className="font-medium text-danger">Còn thiếu:</p>
              <ul className="mt-1 list-disc pl-5">
                {status.missing.map((m) => (
                  <li key={m.id}>{m.label_vi}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {status.notes.length ? (
            <ul className="list-disc pl-5 text-muted">
              {status.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
            <dt className="text-muted">Tài khoản Google đã kết nối</dt>
            <dd>
              {status.google_email || (status.refresh_source === "env" ? "(token từ GOOGLE_ADS_REFRESH_TOKEN)" : "—")}
              {status.connected_at ? ` · lúc ${formatSaigon(status.connected_at)}` : ""}
            </dd>
            <dt className="text-muted">Nguồn refresh token</dt>
            <dd>{src(status.refresh_source)}</dd>
            <dt className="text-muted">OAuth client</dt>
            <dd>{src(status.client_source)}</dd>
            <dt className="text-muted">MCC (login-customer-id)</dt>
            <dd>
              {status.login_customer_id_dashed} ({status.login_source === "env" ? "GOOGLE_ADS_LOGIN_CUSTOMER_ID" : "mặc định"})
            </dd>
            <dt className="text-muted">Developer token</dt>
            <dd>{status.developer_token_set ? "Đã đặt" : "Chưa đặt (tuỳ chọn từ 10/9/2026)"}</dd>
            <dt className="text-muted">Lần thử gần nhất</dt>
            <dd>
              {status.last_test_at
                ? `${status.last_test_ok ? "OK" : "Lỗi"} · ${formatSaigon(status.last_test_at)}${
                    status.last_test_message ? ` — ${status.last_test_message}` : ""
                  }`
                : "—"}
            </dd>
            <dt className="text-muted">Redirect URI (thêm vào OAuth client)</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-inset px-2 py-1 text-xs">{status.redirect_uri}</code>
              <button type="button" className="text-xs underline" onClick={() => void copyRedirect()}>
                {copied ? "Đã chép" : "Chép"}
              </button>
            </dd>
          </dl>

          <div className="flex flex-wrap gap-2">
            {readOnly ? (
              <span className="text-sm text-muted">Đang Xem như — thoát để kết nối.</span>
            ) : (
              <a className={btnPrimary} href="/api/google-ads/oauth/start">
                {status.google_email ? "Kết nối lại Google Ads" : "Kết nối Google Ads"}
              </a>
            )}
            <button type="button" className={btn} disabled={busy !== "" || !ready} onClick={() => void runTest()}>
              {busy === "test" ? "Đang thử…" : "Thử kết nối"}
            </button>
            {status.google_email && !readOnly ? (
              <button type="button" className={btnDanger} disabled={busy !== ""} onClick={() => void runDisconnect()}>
                {busy === "disconnect" ? "Đang ngắt…" : "Ngắt kết nối"}
              </button>
            ) : null}
          </div>

          {test ? (
            <div className="flex flex-col gap-2">
              <p className={cn("text-sm", test.ok ? "text-ink" : "text-danger")}>{test.message_vi}</p>
              {test.accounts && test.accounts.length ? (
                <div className="max-h-80 overflow-auto rounded-md border border-line">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-inset">
                      <tr>
                        <th className="px-2 py-1">Customer ID</th>
                        <th className="px-2 py-1">Tên</th>
                        <th className="px-2 py-1">Trạng thái</th>
                        <th className="px-2 py-1">Loại</th>
                      </tr>
                    </thead>
                    <tbody>
                      {test.accounts.map((a) => (
                        <tr key={a.customer_id_dashed} className="border-t border-line">
                          <td className="px-2 py-1 font-mono">{a.customer_id_dashed}</td>
                          <td className="px-2 py-1">{a.name || "—"}</td>
                          <td className="px-2 py-1">{a.status}</td>
                          <td className="px-2 py-1">
                            {a.manager ? "MCC" : "Tài khoản QC"}
                            {a.test_account ? " · test" : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
