import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import type { MetaAnalytics } from "./meta-ads.types.ts";

export type { MetaAnalytics, MetaMetrics, MetaDay, MetaRow } from "./meta-ads.types.ts";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Facebook analytics for one account the viewer may see. Previous period: staff only. */
export const readMetaAnalyticsFn = createServerFn({ method: "POST" })
  .validator((data: unknown): { clientId: string; start: string; end: string } => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const clientId = String(d.clientId || "").trim();
    const start = String(d.start || "");
    const end = String(d.end || "");
    if (!/^fb_\d+$/.test(clientId)) throw new Error("Tài khoản Facebook không hợp lệ");
    if (!YMD.test(start) || !YMD.test(end) || start > end) throw new Error("Khoảng ngày không hợp lệ");
    return { clientId, start, end };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<MetaAnalytics> => {
    const ctx = context.access;
    const { assertAccount } = await import("./permissions.server");
    if (ctx.principal.role === "pending") throw new Error("Chưa được cấp quyền.");
    assertAccount(ctx, data.clientId);
    const { readMetaAnalytics } = await import("./meta-analytics.server");
    return readMetaAnalytics(data.clientId, data.start, data.end, ctx.principal.kind === "staff");
  });

export type { MetaStatus } from "./meta-ads.server.ts";

/** Admin: Meta token status (valid / invalid / missing, visible account count). Never returns the token. */
export const getMetaStatusFn = createServerFn({ method: "GET" })
  .middleware([principalMiddleware])
  .handler(async ({ context }) => {
    const { assertEffectiveAdmin } = await import("./permissions.server");
    assertEffectiveAdmin(context.access);
    const { metaStatus } = await import("./meta-ads.server.ts");
    return metaStatus();
  });

/** Admin: pull Facebook accounts + insights now (same as the daily cron's Meta phase). */
export const syncMetaNowFn = createServerFn({ method: "POST" })
  .middleware([principalMiddleware])
  .handler(async ({ context }) => {
    const { assertEffectiveAdmin } = await import("./permissions.server");
    assertEffectiveAdmin(context.access);
    const { acquireLock } = await import("./warehouse.server");
    if (!(await acquireLock("meta:sync-now", 60))) return { ok: false, accounts: 0, done: 0, inserted: 0, errors: ["Đang kéo, thử lại sau 1 phút."] };
    const { refreshAllMeta } = await import("./meta-ads.server.ts");
    return refreshAllMeta(Date.now() + 50_000);
  });
