import { useEffect, useRef, useState, type FormEvent } from "react";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { getAuthPublicOrigin } from "@/lib/adsops/login-origin.functions";
import { AUTH_PROVIDERS, authClient, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/login")({ component: Login });

function oauthErrorVi(raw: string): string {
  const msg = raw.toLowerCase();
  if (msg.includes("invalid origin") || msg.includes("invalid_origin") || msg.includes("callback")) {
    return "Google chưa nhận domain này. Bấm lại — hệ thống sẽ mở đúng cửa sổ đăng nhập. Hoặc dùng email bên dưới.";
  }
  if (msg.includes("popup")) return "Trình duyệt chặn cửa sổ. Cho phép pop-up rồi bấm lại.";
  return raw || "Không đăng nhập được bằng Google.";
}

function Login() {
  const { user, isPending } = useCurrentUserState();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState("");
  const [error, setError] = useState("");
  const [authOrigin, setAuthOrigin] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    getAuthPublicOrigin()
      .then((origin) => setAuthOrigin(origin || ""))
      .catch(() => setAuthOrigin(""));
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
  if (user) return <Navigate to="/" />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!authEnabled) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "up") {
        const result = await authClient.signUp.email({
          email: email.trim(),
          password,
          name: name.trim() || email.trim(),
        });
        if (result.error) throw new Error(result.error.message || "Không tạo được tài khoản.");
      } else {
        const result = await authClient.signIn.email({ email: email.trim(), password });
        if (result.error) throw new Error(result.error.message || "Email hoặc mật khẩu không đúng.");
      }
      window.location.assign("/");
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      setError(
        raw.toLowerCase().includes("invalid origin")
          ? "Domain này chưa khớp phiên đăng nhập. Thử lại, hoặc tạo tài khoản email mới."
          : raw || "Không đăng nhập được.",
      );
    } finally {
      setBusy(false);
    }
  }

  const oauthDisabled = Boolean(oauthBusy) || authOrigin === null;

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4 py-10 text-ink">
      <section className="w-full max-w-md rounded-xl bg-paper p-6 shadow-sheet">
        <p className="text-xs font-medium uppercase tracking-widest text-subtle">AdsOps</p>
        <h1 className="font-display mt-1 text-2xl font-medium tracking-tight">Đăng nhập</h1>
        <p className="mt-2 text-sm text-muted">
          Khách hàng và sale chỉ xem chỉ số báo cáo của tài khoản được cấp. Vận hành thấy đủ công
          cụ. CPA Google không phải Qualified Lead.
        </p>
        {authEnabled ? (
          <>
            <div className="mt-5 flex flex-col gap-2">
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
            <p className="mt-5 text-center text-xs text-subtle">hoặc email trên domain này</p>
            <form className="mt-3 space-y-3" onSubmit={(e) => void submit(e)}>
              {mode === "up" ? (
                <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                  Tên
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-11 rounded-md border border-line bg-bg px-3 text-sm text-ink"
                    autoComplete="name"
                  />
                </label>
              ) : null}
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                Email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 rounded-md border border-line bg-bg px-3 text-sm text-ink"
                  autoComplete="email"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                Mật khẩu
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 rounded-md border border-line bg-bg px-3 text-sm text-ink"
                  autoComplete={mode === "up" ? "new-password" : "current-password"}
                />
              </label>
              {error ? <p className="text-sm text-danger">{error}</p> : null}
              <button
                type="submit"
                disabled={busy || Boolean(oauthBusy)}
                className="h-11 w-full rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-60"
              >
                {busy ? "Đang xử lý…" : mode === "up" ? "Tạo tài khoản" : "Đăng nhập email"}
              </button>
            </form>
            <button
              type="button"
              className="mt-3 w-full text-sm text-muted underline-offset-4 hover:underline"
              onClick={() => {
                setMode(mode === "in" ? "up" : "in");
                setError("");
              }}
            >
              {mode === "in" ? "Chưa có tài khoản? Tạo mới" : "Đã có tài khoản? Đăng nhập"}
            </button>
          </>
        ) : (
          <p className="mt-4 text-sm text-muted">Đăng nhập đang tắt.</p>
        )}
      </section>
    </main>
  );
}
