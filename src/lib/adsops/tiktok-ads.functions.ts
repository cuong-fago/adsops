import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import type { TTView } from "./tiktok-ads.types.ts";
export type { TTView, TTMetrics, TTCampaign, TTAdGroup, TTNode } from "./tiktok-ads.types.ts";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const TT_RE = /^tt_\d+$/;

/** TikTok Ads view for one account the viewer may see. Previous period: staff only. Reads Neon only. */
export const readTikTokViewFn = createServerFn({ method: "POST" })
  .validator((data: unknown): { clientId: string; start: string; end: string; compare: boolean } => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const clientId = String(d.clientId || "").trim();
    const start = String(d.start || ""), end = String(d.end || "");
    if (!TT_RE.test(clientId)) throw new Error("Tài khoản TikTok Ads không hợp lệ");
    if (!YMD.test(start) || !YMD.test(end) || start > end) throw new Error("Khoảng ngày không hợp lệ");
    return { clientId, start, end, compare: d.compare === true };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<TTView> => {
    const ctx = context.access;
    const { assertAccount } = await import("./permissions.server");
    if (ctx.principal.role === "pending") throw new Error("Chưa được cấp quyền.");
    assertAccount(ctx, data.clientId);
    const withPrev = ctx.principal.kind === "staff" && data.compare;
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const st = await sql.query<{ insights_through: unknown }>(`select insights_through from tiktok_account_state where client_id = $1`, [data.clientId]).catch(() => []);
    if (st.length && !st[0].insights_through) {
      const { acquireLock } = await import("./warehouse.server");
      const { TT_META_VERSION, refreshTikTokAccount } = await import("./tiktok-ads.server");
      if (await acquireLock(`${data.clientId}:tt-pull-v${TT_META_VERSION}`, 120)) {
        const r = await refreshTikTokAccount(data.clientId).catch((e: unknown) => ({ ok: false, error_vi: String(e) }));
        if (!r.ok) console.error("[tiktok] first pull failed", data.clientId);
      }
    }
    return (await import("./tiktok-analytics.server")).readTikTokView(data.clientId, data.start, data.end, withPrev);
  });

/** Admin (not in Xem như): app config state + connected advertisers. Never includes token material. */
export const listTikTokConnectionsFn = createServerFn({ method: "POST" })
  .middleware([principalMiddleware])
  .handler(async ({ context }) => {
    const { assertEffectiveAdmin } = await import("./permissions.server");
    assertEffectiveAdmin(context.access);
    const m = await import("./tiktok-ads.server");
    return { configured: Boolean(m.appConfig()), enc_ready: m.encReady(), connections: await m.listConnections() };
  });
