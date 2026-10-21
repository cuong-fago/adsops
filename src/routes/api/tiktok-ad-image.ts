import { createFileRoute } from "@tanstack/react-router";

/** TikTok ad thumbnail (video cover / image), read-only proxy. Same account permission as the view. */
async function handle({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client") || "";
  const adId = url.searchParams.get("ad") || "";
  if (!/^tt_\d+$/.test(clientId) || !/^\d{1,25}$/.test(adId)) return new Response("Bad request", { status: 400 });
  const p = await import("@/lib/adsops/permissions.server");
  let ctx: Awaited<ReturnType<typeof p.resolveAccessFromHeaders>>;
  try {
    await (await import("@/lib/adsops/access.server")).ensureRosterSeeded();
    ctx = await p.resolveAccessFromHeaders(request.headers);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  if (ctx.principal.role === "pending" || !p.canSeeAccount(ctx, clientId)) return new Response("Not found", { status: 404 });
  const img = await (await import("@/lib/adsops/tiktok-ads.server")).adThumb(clientId, adId).catch(() => null);
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(img.body, { headers: { "Content-Type": img.type, "Cache-Control": "private, max-age=1800", "X-Content-Type-Options": "nosniff" } });
}

export const Route = createFileRoute("/api/tiktok-ad-image")({
  server: { handlers: { GET: handle } },
});
