import { createFileRoute } from "@tanstack/react-router";

/**
 * OAuth callback for "Kết nối Google Ads" (admin only). Exchanges the code for a
 * refresh token and stores it encrypted in Neon. The token never reaches the browser.
 */
const STATE_COOKIE = "__Host-adsops.gads_state";

function back(origin: string, query: string, clearCookie: string): Response {
  return new Response(null, {
    status: 302,
    headers: { "cache-control": "private, no-store", location: `${origin}/?${query}`, "set-cookie": clearCookie },
  });
}

function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  const part = idToken.split(".")[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { email?: unknown };
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

async function handle({ request }: { request: Request }): Promise<Response> {
  const p = await import("@/lib/adsops/permissions.server");
  const acc = await import("@/lib/adsops/access.server");
  const g = await import("@/lib/adsops/google-ads.server");
  const origin = g.publicOrigin(request);
  const clear = p.clearCookieHeader(STATE_COOKIE);
  let ctx: Awaited<ReturnType<typeof p.resolveAccessFromHeaders>>;
  try {
    await acc.ensureRosterSeeded();
    ctx = await p.resolveAccessFromHeaders(request.headers);
  } catch {
    return new Response("Unauthorized", { status: 401, headers: { "cache-control": "private, no-store" } });
  }
  if (!ctx.real.isSuperAdmin || ctx.readOnly) {
    return new Response("Forbidden", { status: 403, headers: { "cache-control": "private, no-store" } });
  }
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const cookieState = p.parseCookies(request.headers)[STATE_COOKIE] || "";
  if (!state || state !== cookieState || !g.verifyState(state)) {
    return back(origin, "gads=error&reason=state", clear);
  }
  const oauthErr = url.searchParams.get("error");
  if (oauthErr) {
    console.error(`[google-ads] oauth consent returned error=${oauthErr.slice(0, 60)}`);
    return back(origin, `gads=error&reason=${encodeURIComponent(oauthErr === "access_denied" ? "denied" : "consent")}`, clear);
  }
  const code = url.searchParams.get("code") || "";
  if (!code) return back(origin, "gads=error&reason=no_code", clear);

  const client = g.oauthClient();
  if (!client.clientId || !client.clientSecret) return back(origin, "gads=error&reason=oauth_client_missing", clear);
  let tok: { refresh_token?: string; id_token?: string; access_token?: string; scope?: string; error?: string };
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: g.redirectUriFor(request),
        grant_type: "authorization_code",
      }),
    });
    tok = (await res.json().catch(() => ({}))) as typeof tok;
    if (!res.ok) {
      console.error(`[google-ads] oauth code exchange failed status=${res.status} error=${String(tok.error || "").slice(0, 60)}`);
      return back(origin, "gads=error&reason=exchange", clear);
    }
  } catch (err) {
    console.error(`[google-ads] oauth code exchange crashed: ${err instanceof Error ? err.message.slice(0, 200) : "unknown"}`);
    return back(origin, "gads=error&reason=exchange", clear);
  }
  if (!tok.refresh_token) return back(origin, "gads=error&reason=no_refresh_token", clear);
  if (!String(tok.scope || "").includes(g.ADWORDS_SCOPE)) return back(origin, "gads=error&reason=scope", clear);

  let email = emailFromIdToken(tok.id_token);
  if (!email && tok.access_token) {
    try {
      const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { authorization: `Bearer ${tok.access_token}` },
      });
      const j = (await r.json().catch(() => ({}))) as { email?: unknown };
      email = typeof j.email === "string" ? j.email : null;
    } catch {
      email = null;
    }
  }
  try {
    await g.saveStoredCredential({
      refreshToken: tok.refresh_token,
      googleEmail: email,
      scope: tok.scope || null,
      connectedBy: ctx.real.email || ctx.real.id,
    });
    await p.audit(p.actorLabel(ctx.real), "google_ads.connect", "google_ads", "credential", { google_email: email });
  } catch (err) {
    console.error(`[google-ads] saving credential failed: ${err instanceof Error ? err.message.slice(0, 200) : "unknown"}`);
    return back(origin, "gads=error&reason=store", clear);
  }
  return back(origin, "gads=connected", clear);
}

export const Route = createFileRoute("/api/google-ads/oauth/callback")({
  server: { handlers: { GET: handle } },
});
