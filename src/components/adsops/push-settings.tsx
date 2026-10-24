import { useCallback, useEffect, useState } from "react";
import { getPushStateFn, setPushPrefsFn, subscribePushFn, testPushFn, unsubscribePushFn } from "@/lib/adsops/push.functions";
import { PUSH_LABEL, type PushKind, type PushState } from "@/lib/adsops/push.types";

function b64ToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function env() {
  if (typeof window === "undefined") return { supported: false, ios: false, standalone: false };
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return { supported, ios, standalone };
}

async function currentSub(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Bell button in the header → "Thông báo" panel (opt-in per user, per alert type). */
export function PushSettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Cài đặt thông báo"
        title="Thông báo"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-ink hover:bg-inset"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" strokeLinecap="round" />
        </svg>
      </button>
      {open ? <PushSettingsPanel onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function PushSettingsPanel({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<PushState | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const e = env();

  const load = useCallback(async () => {
    try {
      setState(await getPushStateFn());
      if (e.supported) setSubscribed(!!(await currentSub()));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Không tải được cài đặt.");
    }
  }, [e.supported]);
  useEffect(() => void load(), [load]);

  const enable = async () => {
    if (!state?.public_key) return;
    setBusy(true);
    setMsg("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setMsg("Bạn chưa cho phép thông báo. Hãy bật lại trong cài đặt trình duyệt/thiết bị.");
        return;
      }
      const reg = (await navigator.serviceWorker.getRegistration("/")) || (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(state.public_key) as BufferSource }));
      const j = sub.toJSON();
      await subscribePushFn({ data: { endpoint: sub.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth } });
      // First enable: turn on every allowed type; the user can switch off individually.
      if (!Object.values(state.prefs).some(Boolean)) {
        const all = Object.fromEntries(state.allowed.map((k) => [k, true]));
        await setPushPrefsFn({ data: all });
      }
      setSubscribed(true);
      await load();
      setMsg("Đã bật thông báo trên thiết bị này.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Không bật được thông báo.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setMsg("");
    try {
      const sub = await currentSub();
      if (sub) {
        await unsubscribePushFn({ data: { endpoint: sub.endpoint } }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setSubscribed(false);
      await load();
      setMsg("Đã tắt thông báo trên thiết bị này.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (k: PushKind, v: boolean) => {
    if (!state) return;
    setState({ ...state, prefs: { ...state.prefs, [k]: v } });
    try {
      const prefs = await setPushPrefsFn({ data: { [k]: v } });
      setState((s) => (s ? { ...s, prefs } : s));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Không lưu được.");
      await load();
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const r = await testPushFn();
      setMsg(r.sent ? "Đã gửi thông báo thử." : "Chưa gửi được (thiết bị chưa đăng ký?).");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Thông báo"
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-paper p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl md:max-w-md md:rounded-2xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Thông báo</h2>
          <button type="button" onClick={onClose} className="h-9 rounded-lg px-3 text-sm text-muted hover:bg-inset">Đóng</button>
        </div>

        {!state ? (
          <p className="text-sm text-muted">Đang tải…</p>
        ) : !state.allowed.length ? (
          <p className="text-sm text-muted">Vai trò của bạn hiện chưa có loại thông báo nào.</p>
        ) : (
          <>
            {e.ios && !e.standalone ? (
              <div className="mb-3 rounded-lg border border-line bg-inset p-3 text-sm text-ink">
                Trên iPhone/iPad, thông báo cần <b>iOS 16.4 trở lên</b> và mở AdsOps từ <b>Màn hình chính</b>: trong Safari bấm
                <b> Chia sẻ → Thêm vào MH chính</b>, rồi mở app từ biểu tượng và bật thông báo tại đây.
              </div>
            ) : null}
            {!state.configured ? (
              <p className="mb-3 text-sm text-muted">Máy chủ chưa cấu hình thông báo đẩy.</p>
            ) : !e.supported ? (
              e.ios && !e.standalone ? null : <p className="mb-3 text-sm text-muted">Trình duyệt này không hỗ trợ thông báo đẩy.</p>
            ) : (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {subscribed ? (
                  <>
                    <span className="text-sm text-ink">Đang bật trên thiết bị này.</span>
                    <button type="button" disabled={busy} onClick={() => void test()} className="h-10 rounded-lg border border-line px-3 text-sm hover:bg-inset">Gửi thử</button>
                    <button type="button" disabled={busy} onClick={() => void disable()} className="h-10 rounded-lg border border-line px-3 text-sm hover:bg-inset">Tắt trên thiết bị này</button>
                  </>
                ) : (
                  <button type="button" disabled={busy} onClick={() => void enable()} className="h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover">
                    Bật thông báo trên thiết bị này
                  </button>
                )}
              </div>
            )}
            <ul className="divide-y divide-line rounded-lg border border-line">
              {state.allowed.map((k) => (
                <li key={k}>
                  <label className="flex min-h-[52px] cursor-pointer items-start gap-3 p-3">
                    <input type="checkbox" className="mt-1 h-5 w-5 accent-[#3DB54A]" checked={state.prefs[k]} onChange={(ev) => void toggle(k, ev.target.checked)} />
                    <span>
                      <span className="block text-sm font-medium text-ink">{PUSH_LABEL[k].title}</span>
                      <span className="block text-xs text-muted">{PUSH_LABEL[k].hint}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">
              Chỉ nhận cảnh báo cho các tài khoản bạn được cấp quyền. Kiểm tra mỗi sáng (~06:30). {state.devices ? `Thiết bị đã đăng ký: ${state.devices}.` : ""}
            </p>
          </>
        )}
        {msg ? <p className="mt-3 text-sm text-ink">{msg}</p> : null}
      </div>
    </div>
  );
}
