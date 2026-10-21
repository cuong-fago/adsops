import { createFileRoute } from "@tanstack/react-router";

/** Admin only: start "Kết nối TikTok Ads" → TikTok advertiser authorization page. */
async function handle({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url);
  const back = (q: string) => Response.redirect(`${url.origin}/?${q}`, 302);
  const p = await import("@/lib/adsops/permissions.server");
  let ctx: Awaited<ReturnType<typeof p.resolveAccessFromHeaders>>;
  try {
    await (await import("@/lib/adsops/access.server")).ensureRosterSeeded();
    ctx = await p.resolveAccessFromHeaders(request.headers);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  try { p.assertEffectiveAdmin(ctx); } catch { return new Response("Forbidden", { status: 403 }); }
  const m = await import("@/lib/adsops/tiktok-ads.server");
  const cfg = m.appConfig();
  if (!cfg) return back(`tiktok=error&msg=${encodeURIComponent("Chưa cấu hình ứng dụng TikTok")}`);
  if (!m.encReady()) return back(`tiktok=error&msg=${encodeURIComponent("Thiếu khoá mã hoá TIKTOK_ENC_KEY")}`);
  const state = await m.newState(p.actorLabel(ctx.real));
  const redirect = (process.env.TIKTOK_REDIRECT_URI || "").trim() || `${url.origin}/api/tiktok/callback`;
  return Response.redirect(m.authUrl(cfg.appId, state, redirect), 302);
}

export const Route = createFileRoute("/api/tiktok/connect")({
  server: { handlers: { GET: handle } },
});
