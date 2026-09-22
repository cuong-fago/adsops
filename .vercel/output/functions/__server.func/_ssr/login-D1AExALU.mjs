import { o as __toESM } from "../_runtime.mjs";
import { _ as Navigate, y as require_jsx_runtime, z as require_react } from "../_libs/@tanstack/react-router+[...].mjs";
import { r as createServerFn } from "./ssr.mjs";
import { r as signIn, t as authClient } from "./client-CVqXY6bk.mjs";
import { t as GROK_PROVIDERS } from "./server-DRHzIFb5.mjs";
import { r as useCurrentUserState, t as createSsrRpc } from "./use-current-user-DWR5fiv3.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/login-D1AExALU.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
/** Public AdsOps origin used for Google/X (BETTER_AUTH_URL). Empty in live preview. */
var getAuthPublicOrigin = createServerFn({ method: "GET" }).handler(createSsrRpc("8fa9776d9d84df5511f1c7a3cea99c5bd55cd00f2b66e84aff1fc46ba9899d49"));
function oauthErrorVi(raw) {
	const msg = raw.toLowerCase();
	if (msg.includes("invalid origin") || msg.includes("invalid_origin") || msg.includes("callback")) return "Google/X chưa nhận domain này. Bấm lại — hệ thống sẽ mở đúng cửa sổ đăng nhập. Hoặc dùng email bên dưới.";
	if (msg.includes("popup")) return "Trình duyệt chặn cửa sổ. Cho phép pop-up rồi bấm lại.";
	return raw || "Không đăng nhập được bằng Google/X.";
}
function Login() {
	const { user, isPending } = useCurrentUserState();
	const [mode, setMode] = (0, import_react.useState)("in");
	const [email, setEmail] = (0, import_react.useState)("");
	const [password, setPassword] = (0, import_react.useState)("");
	const [name, setName] = (0, import_react.useState)("");
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [oauthBusy, setOauthBusy] = (0, import_react.useState)("");
	const [error, setError] = (0, import_react.useState)("");
	const [authOrigin, setAuthOrigin] = (0, import_react.useState)(null);
	const started = (0, import_react.useRef)(false);
	(0, import_react.useEffect)(() => {
		getAuthPublicOrigin().then((origin) => setAuthOrigin(origin || "")).catch(() => setAuthOrigin(""));
	}, []);
	async function startOauth(providerId) {
		setOauthBusy(providerId);
		setError("");
		try {
			if (authOrigin && window.location.origin !== authOrigin) {
				const next = new URL("/login", authOrigin);
				next.searchParams.set("idp", providerId);
				window.location.assign(next.toString());
				return;
			}
			await signIn(providerId, {
				callbackURL: "/",
				errorCallbackURL: "/login"
			});
		} catch (err) {
			setError(oauthErrorVi(err instanceof Error ? err.message : ""));
			setOauthBusy("");
		}
	}
	(0, import_react.useEffect)(() => {
		if (isPending || user || false) return;
		if (authOrigin === null) return;
		const idp = new URLSearchParams(window.location.search).get("idp") || "";
		if (!GROK_PROVIDERS.some((p) => p.providerId === idp)) return;
		if (started.current) return;
		if (authOrigin && window.location.origin !== authOrigin) return;
		started.current = true;
		startOauth(idp);
	}, [
		isPending,
		user,
		authOrigin
	]);
	if (isPending) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "min-h-screen bg-bg" });
	if (user) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Navigate, { to: "/" });
	async function submit(e) {
		e.preventDefault();
		setBusy(true);
		setError("");
		try {
			if (mode === "up") {
				const result = await authClient.signUp.email({
					email: email.trim(),
					password,
					name: name.trim() || email.trim()
				});
				if (result.error) throw new Error(result.error.message || "Không tạo được tài khoản.");
			} else {
				const result = await authClient.signIn.email({
					email: email.trim(),
					password
				});
				if (result.error) throw new Error(result.error.message || "Email hoặc mật khẩu không đúng.");
			}
			window.location.assign("/");
		} catch (err) {
			const raw = err instanceof Error ? err.message : "";
			setError(raw.toLowerCase().includes("invalid origin") ? "Domain này chưa khớp phiên đăng nhập. Thử lại, hoặc tạo tài khoản email mới." : raw || "Không đăng nhập được.");
		} finally {
			setBusy(false);
		}
	}
	const oauthDisabled = Boolean(oauthBusy) || authOrigin === null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		className: "grid min-h-screen place-items-center bg-bg px-4 py-10 text-ink",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "w-full max-w-md rounded-xl bg-paper p-6 shadow-sheet",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-xs font-medium uppercase tracking-widest text-subtle",
					children: "AdsOps"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "font-display mt-1 text-2xl font-medium tracking-tight",
					children: "Đăng nhập"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 text-sm text-muted",
					children: "Khách hàng và sale chỉ xem chỉ số báo cáo của tài khoản được cấp. Vận hành thấy đủ công cụ. CPA Google không phải Qualified Lead."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-5 flex flex-col gap-2",
						children: GROK_PROVIDERS.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: oauthDisabled,
							onClick: () => void startOauth(p.providerId),
							className: "h-11 rounded-md border border-line-strong bg-inset px-4 text-sm font-medium text-ink hover:bg-line disabled:opacity-60",
							children: oauthBusy === p.providerId ? `Đang mở ${p.label}…` : `Tiếp tục với ${p.label}`
						}, p.providerId))
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-5 text-center text-xs text-subtle",
						children: "hoặc email trên domain này"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
						className: "mt-3 space-y-3",
						onSubmit: (e) => void submit(e),
						children: [
							mode === "up" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "flex flex-col gap-1 text-xs font-medium text-muted",
								children: ["Tên", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									value: name,
									onChange: (e) => setName(e.target.value),
									className: "h-11 rounded-md border border-line bg-bg px-3 text-sm text-ink",
									autoComplete: "name"
								})]
							}) : null,
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "flex flex-col gap-1 text-xs font-medium text-muted",
								children: ["Email", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "email",
									required: true,
									value: email,
									onChange: (e) => setEmail(e.target.value),
									className: "h-11 rounded-md border border-line bg-bg px-3 text-sm text-ink",
									autoComplete: "email"
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "flex flex-col gap-1 text-xs font-medium text-muted",
								children: ["Mật khẩu", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "password",
									required: true,
									minLength: 8,
									value: password,
									onChange: (e) => setPassword(e.target.value),
									className: "h-11 rounded-md border border-line bg-bg px-3 text-sm text-ink",
									autoComplete: mode === "up" ? "new-password" : "current-password"
								})]
							}),
							error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-sm text-danger",
								children: error
							}) : null,
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "submit",
								disabled: busy || Boolean(oauthBusy),
								className: "h-11 w-full rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-60",
								children: busy ? "Đang xử lý…" : mode === "up" ? "Tạo tài khoản" : "Đăng nhập email"
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "mt-3 w-full text-sm text-muted underline-offset-4 hover:underline",
						onClick: () => {
							setMode(mode === "in" ? "up" : "in");
							setError("");
						},
						children: mode === "in" ? "Chưa có tài khoản? Tạo mới" : "Đã có tài khoản? Đăng nhập"
					})
				] })
			]
		})
	});
}
//#endregion
export { Login as component };
