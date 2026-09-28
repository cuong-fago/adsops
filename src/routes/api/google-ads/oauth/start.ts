import { createFileRoute } from "@tanstack/react-router";

/**
 * Admin-only: start Google OAuth consent for the Google Ads API (scope adwords,
 * offline access) so AdsOps can read ad accounts under the MCC. Read-only use.
 */
const STATE_COOKIE = "__Host-adsops.gads_state";
const NO_STORE = { "cache-control": "private, no-store" };

async function handle({ request }: { request: Request }): Promise<Response> {
  const p = await import("@/lib/adsops/permissions.server");
  const acc = await import("@/lib/adsops/access.server");
  let ctx: Awaited<ReturnType<typeof p.resolveAccessFromHeaders>>;
  try {
    await acc.ensureRosterSeeded();
    ctx = await p.resolveAccessFromHeaders(request.headers);
  } catch {
    return new Response("Unauthorized", { status: 401, headers: NO_STORE });
  }
  if (!ctx.real.isSuperAdmin || ctx.readOnly) {
    return new Response("Forbidden", { status: 403, headers: NO_STORE });
  }
  const g = await import("@/lib/adsops/google-ads.server");
  const client = g.oauthClient();
  if (!client.clientId || !client.clientSecret) {
    return Response.redirect(new URL("/?gads=error&reason=oauth_client_missing", g.publicOrigin(request)).toString(), 302);
  }
  const nonce = (await import("node:crypto")).randomBytes(16).toString("base64url");
  const state = g.signState({ n: nonce, u: ctx.real.email || ctx.real.id, exp: Date.now() + 10 * 60_000 });
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: g.redirectUriFor(request),
    response_type: "code",
    scope: `openid email ${g.ADWORDS_SCOPE}`,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  if (ctx.real.email) params.set("login_hint", ctx.real.email);
  return new Response(null, {
    status: 302,
    headers: {
      ...NO_STORE,
      location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      "set-cookie": p.setCookieHeader(STATE_COOKIE, state, 600),
    },
  });
}

export const Route = createFileRoute("/api/google-ads/oauth/start")({
  server: { handlers: { GET: handle } },
});
