import { createFileRoute } from "@tanstack/react-router";

/**
 * TikTok OAuth redirect URL (exactly /api/tiktok/callback). Verifies the one-time state and that the
 * browser session is an Admin, exchanges auth_code (the only POST to TikTok), stores the token encrypted,
 * lists the authorized advertisers and pulls them read-only within a short time budget.
 */
const PULL_BUDGET_MS = 40_000;

async function handle({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url);
  const back = (q: string) => Response.redirect(`${url.origin}/?${q}`, 302);
  const fail = (msg: string) => back(`tiktok=error&msg=${encodeURIComponent(msg.slice(0, 200))}`);
  const code = url.searchParams.get("auth_code") || url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const p = await import("@/lib/adsops/permissions.server");
  let ctx: Awaited<ReturnType<typeof p.resolveAccessFromHeaders>>;
  try {
    await (await import("@/lib/adsops/access.server")).ensureRosterSeeded();
    ctx = await p.resolveAccessFromHeaders(request.headers);
    p.assertEffectiveAdmin(ctx);
  } catch {
    return fail("Chỉ Admin (đã đăng nhập, không ở chế độ Xem như) mới kết nối được TikTok Ads.");
  }
  const m = await import("@/lib/adsops/tiktok-ads.server");
  if (!(await m.takeState(state).catch(() => false))) return fail("Phiên kết nối đã hết hạn hoặc không hợp lệ. Bấm Kết nối lại.");
  if (!code || code.length > 512) return fail("TikTok không trả về mã uỷ quyền (có thể bạn đã huỷ).");
  try {
    const r = await m.connectFromCode(code, p.actorLabel(ctx.real));
    const started = Date.now();
    let pulled = 0;
    for (const a of r.advertisers) {
      if (Date.now() - started > PULL_BUDGET_MS) break;
      const x = await m.refreshTikTokAccount(a.client_id).catch(() => ({ ok: false }));
      if (x.ok) pulled += 1;
    }
    return back(`tiktok=ok&n=${r.advertisers.length}&pulled=${pulled}`);
  } catch (e) {
    console.error("[tiktok] connect failed:", m.errVi(e).slice(0, 200));
    return fail(`Không kết nối được: ${m.errVi(e)}`);
  }
}

export const Route = createFileRoute("/api/tiktok/callback")({
  server: { handlers: { GET: handle } },
});
