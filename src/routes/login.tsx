import { useEffect, useRef, useState, type FormEvent } from "react";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { clientSignIn, getViewer } from "@/lib/adsops/client-auth.functions";
import { getAuthPublicOrigin } from "@/lib/adsops/login-origin.functions";
import { AUTH_PROVIDERS, authClient, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/login")({ component: Login });

function oauthErrorVi(raw: string): string {
  const msg = raw.toLowerCase();
  if (msg.includes("invalid origin") || msg.includes("invalid_origin") || msg.includes("callback")) {
    return "Google chưa nhận domain này. Bấm lại — hệ thống sẽ mở đúng cửa sổ đăng nhập.";
  }
  if (msg.includes("popup")) return "Trình duyệt chặn cửa sổ. Cho phép pop-up rồi bấm lại.";
  return raw || "Không đăng nhập được bằng Google.";
}

const inputCls = "h-11 rounded-md border border-line bg-bg px-3 text-sm text-ink";
const labelCls = "flex flex-col gap-1 text-xs font-medium text-muted";

function Login() {
  const { user, isPending } = useCurrentUserState();
  const [mode, setMode] = useState<"staff" | "client">("staff");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [clientPassword, setClientPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState("");
  const [error, setError] = useState("");
  const [authOrigin, setAuthOrigin] = useState<string | null>(null);
  const [clientSession, setClientSession] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    getAuthPublicOrigin()
      .then((origin) => setAuthOrigin(origin || ""))
      .catch(() => setAuthOrigin(""));
    getViewer()
      .then((v) => setClientSession(Boolean(v && v.kind === "client")))
      .catch(() => undefined);
    if (new URLSearchParams(window.location.search).get("as") === "client") setMode("client");
  }, []);

  async function startOauth(providerId: string) {
    if (!authEnabled) return;
    setOauthBusy(providerId);
    setError("");
    try {
      if (authOrigin && window.location.origin !== authOrigin) {
        const next = new URL("/login", authOrigin);
        next.searchParams.set("idp", providerId);
        window.location.assign(next.toString());
        return;
      }
      await signIn(providerId, { callbackURL: "/", errorCallbackURL: "/login" });
    } catch (err) {
      setError(oauthErrorVi(err instanceof Error ? err.message : ""));
      setOauthBusy("");
    }
  }

  useEffect(() => {
    if (isPending || user || !authEnabled) return;
    if (authOrigin === null) return;
    const idp = new URLSearchParams(window.location.search).get("idp") || "";
    if (!AUTH_PROVIDERS.some((p) => p.providerId === idp)) return;
    if (started.current) return;
    if (authOrigin && window.location.origin !== authOrigin) return;
    started.current = true;
    void startOauth(idp);
  }, [isPending, user, authOrigin]);

  if (isPending) {
    return <div className="min-h-screen bg-bg" />;
  }
  if (user || clientSession) return <Navigate to="/" />;

  async function submitStaff(e: FormEvent) {
    e.preventDefault();
    if (!authEnabled) return;
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) throw new Error(result.error.message || "Email hoặc mật khẩu không đúng.");
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Không đăng nhập được.");
    } finally {
      setBusy(false);
    }
  }

  async function submitClient(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await clientSignIn({ data: { username: username.trim(), password: clientPassword } });
      if (!res.ok) throw new Error(res.error || "Tên đăng nhập hoặc mật khẩu không đúng.");
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Không đăng nhập được.");
    } finally {
      setBusy(false);
    }
  }

  const oauthDisabled = Boolean(oauthBusy) || authOrigin === null;

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4 py-10 text-ink">
      <section className="w-full max-w-md rounded-xl bg-paper p-6 shadow-sheet">
        <p className="text-xs font-medium uppercase tracking-widest text-subtle">AdsOps · Fago Group</p>
        <h1 className="font-display mt-1 text-2xl font-medium tracking-tight">Đăng nhập</h1>
        <div className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-inset p-1">
          <button
            type="button"
            onClick={() => {
              setMode("staff");
              setError("");
            }}
            className={`h-10 rounded-md text-sm font-medium ${mode === "staff" ? "bg-paper text-ink shadow-sheet" : "text-muted"}`}
          >
            Nhân sự Fago
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("client");
              setError("");
            }}
            className={`h-10 rounded-md text-sm font-medium ${mode === "client" ? "bg-paper text-ink shadow-sheet" : "text-muted"}`}
          >
            Đăng nhập khách hàng
          </button>
        </div>

        {mode === "client" ? (
          <form className="mt-5 space-y-3" onSubmit={(e) => void submitClient(e)}>
            <p className="text-sm text-muted">
              Dùng tên đăng nhập và mật khẩu Fago Group đã cấp. Quên mật khẩu: liên hệ người phụ trách tại Fago.
            </p>
            <label className={labelCls}>
              Tên đăng nhập hoặc email
              <input
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={inputCls}
                autoComplete="username"
                autoCapitalize="none"
              />
            </label>
            <label className={labelCls}>
              Mật khẩu
              <input
                type="password"
                required
                value={clientPassword}
                onChange={(e) => setClientPassword(e.target.value)}
                className={inputCls}
                autoComplete="current-password"
              />
            </label>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <button
              type="submit"
              disabled={busy}
              className="h-11 w-full rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-60"
            >
              {busy ? "Đang xử lý…" : "Đăng nhập"}
            </button>
          </form>
        ) : authEnabled ? (
          <>
            <p className="mt-4 text-sm text-muted">Nhân sự Fago đăng nhập bằng Google công ty.</p>
            <div className="mt-3 flex flex-col gap-2">
              {AUTH_PROVIDERS.map((p) => (
                <button
                  key={p.providerId}
                  type="button"
                  disabled={oauthDisabled}
                  onClick={() => void startOauth(p.providerId)}
                  className="h-11 rounded-md border border-line-strong bg-inset px-4 text-sm font-medium text-ink hover:bg-line disabled:opacity-60"
                >
                  {oauthBusy === p.providerId ? `Đang mở ${p.label}…` : `Tiếp tục với ${p.label}`}
                </button>
              ))}
            </div>
            <details className="mt-5">
              <summary className="cursor-pointer text-center text-xs text-subtle">Đăng nhập email nội bộ (tài khoản cũ)</summary>
              <form className="mt-3 space-y-3" onSubmit={(e) => void submitStaff(e)}>
                <label className={labelCls}>
                  Email
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputCls}
                    autoComplete="email"
                  />
                </label>
                <label className={labelCls}>
                  Mật khẩu
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={inputCls}
                    autoComplete="current-password"
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy || Boolean(oauthBusy)}
                  className="h-11 w-full rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-60"
                >
                  {busy ? "Đang xử lý…" : "Đăng nhập email"}
                </button>
              </form>
            </details>
            {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
          </>
        ) : (
          <p className="mt-4 text-sm text-muted">Đăng nhập nhân sự đang tắt.</p>
        )}
      </section>
    </main>
  );
}
