import { createServerFn } from "@tanstack/react-start";

/**
 * Customer (client_users) username/password login on the same domain.
 * Separate from Better Auth staff sessions. No sign-up: admin creates users.
 */

export type ViewerSummary = {
  kind: "staff" | "client";
  label: string;
  role: string;
} | null;

export const clientSignIn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    return {
      username: typeof d.username === "string" ? d.username : "",
      password: typeof d.password === "string" ? d.password : "",
    };
  })
  .handler(async ({ data }) => {
    const { assertSameSiteRequest } = await import("@/lib/auth/isolation.server");
    assertSameSiteRequest();
    const { getRequest, setCookie } = await import("@tanstack/react-start/server");
    const p = await import("./permissions.server.ts");
    const ua = getRequest()?.headers.get("user-agent") ?? null;
    try {
      const { token } = await p.clientPasswordLogin(data.username, data.password, ua);
      setCookie(p.CLIENT_SESSION_COOKIE, token, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: p.CLIENT_SESSION_COOKIE_MAX_AGE_S,
      });
      return { ok: true as const, error: null };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Không đăng nhập được." };
    }
  });

export const clientSignOut = createServerFn({ method: "POST" }).handler(async () => {
  const { assertSameSiteRequest } = await import("@/lib/auth/isolation.server");
  assertSameSiteRequest();
  const { getRequest, deleteCookie } = await import("@tanstack/react-start/server");
  const p = await import("./permissions.server.ts");
  const req = getRequest();
  const token = req ? p.parseCookies(req.headers)[p.CLIENT_SESSION_COOKIE] : undefined;
  if (token) await p.deleteClientSessionByToken(token);
  deleteCookie(p.CLIENT_SESSION_COOKIE, { path: "/", secure: true, httpOnly: true, sameSite: "lax" });
  return { ok: true };
});

/** Who is signed in (staff or client), without throwing. Used by the index route. */
export const getViewer = createServerFn({ method: "GET" }).handler(async (): Promise<ViewerSummary> => {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const req = getRequest();
    if (!req) return null;
    const p = await import("./permissions.server.ts");
    const principal = await p.resolvePrincipal(req.headers);
    if (!principal) return null;
    return {
      kind: principal.kind,
      label: principal.kind === "client" ? principal.displayName || principal.username || "" : principal.email || "",
      role: String(principal.role),
    };
  } catch {
    return null;
  }
});
