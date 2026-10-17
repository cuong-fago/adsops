import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import type { MetaAnalytics } from "./meta-ads.types.ts";

export type { MetaAnalytics, MetaMetrics, MetaDay, MetaRow } from "./meta-ads.types.ts";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Facebook analytics for one account the viewer may see. Previous period: staff only. */
export const readMetaAnalyticsFn = createServerFn({ method: "POST" })
  .validator((data: unknown): { clientId: string; start: string; end: string; compare: boolean } => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const clientId = String(d.clientId || "").trim();
    const start = String(d.start || "");
    const end = String(d.end || "");
    if (!/^fb_\d+$/.test(clientId)) throw new Error("Tài khoản Facebook không hợp lệ");
    if (!YMD.test(start) || !YMD.test(end) || start > end) throw new Error("Khoảng ngày không hợp lệ");
    return { clientId, start, end, compare: d.compare === true };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<MetaAnalytics> => {
    const ctx = context.access;
    const { assertAccount } = await import("./permissions.server");
    if (ctx.principal.role === "pending") throw new Error("Chưa được cấp quyền.");
    assertAccount(ctx, data.clientId);
    // Comparison is staff-only; clients never get previous-period data.
    const withPrev = ctx.principal.kind === "staff" && data.compare;
    if (withPrev) {
      // Previous period not stored yet: fetch the missing days from Meta now (GET only, ~40 s cap).
      const days = Math.round((Date.parse(data.end) - Date.parse(data.start)) / 86_400_000) + 1;
      const { addDaysYmd } = await import("./warehouse.server");
      const prevStart = addDaysYmd(data.start, -days);
      const m = await import("./meta-ads.server.ts");
      if (m.metaConfigured() && (await m.metaHistoryFrom(data.clientId)) > prevStart) {
        const { acquireLock } = await import("./warehouse.server");
        if (await acquireLock(`${data.clientId}:meta-history`, 90)) {
          await m.backfillMeta(data.clientId, "Asia/Ho_Chi_Minh", Date.now() + 40_000, prevStart).catch(() => null);
        }
      }
    }
    const { readMetaAnalytics } = await import("./meta-analytics.server");
    return readMetaAnalytics(data.clientId, data.start, data.end, withPrev);
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

/**
 * Facebook staff alerts (fatigue / high frequency / learning). Staff with Cảnh báo (optimize) only;
 * every account is filtered by the viewer's grants. Optional clientId = one account (FB tab badges).
 */
export const readMetaAlertsFn = createServerFn({ method: "POST" })
  .validator((data: unknown): { clientId: string | null } => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const id = typeof d.clientId === "string" && d.clientId.startsWith("fb_") ? d.clientId.trim() : null;
    return { clientId: id };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<import("./meta-alerts.types.ts").MetaAlertsRead> => {
    const { assertCap, assertAccount, canSeeAccount, ForbiddenError } = await import("./permissions.server");
    const ctx = context.access;
    const SEE = "Vai trò này không xem được Cảnh báo.";
    assertCap(ctx, "optimize", SEE);
    if (ctx.principal.kind !== "staff") throw new ForbiddenError(SEE);
    let accounts: { client_id: string; label: string }[];
    if (data.clientId) {
      assertAccount(ctx, data.clientId);
      accounts = [{ client_id: data.clientId, label: data.clientId }];
    } else {
      const { loadWorkspaceDirectory } = await import("./access.server");
      const { withPulledMccClients } = await import("./mcc-import.server");
      const dir = await withPulledMccClients(await loadWorkspaceDirectory(ctx), ctx.allowed);
      accounts = dir.clients
        .filter((c) => c.client_id.startsWith("fb_") && canSeeAccount(ctx, c.client_id))
        .map((c) => ({ client_id: c.client_id, label: c.alias ? `${c.alias} — ${c.display_name}` : c.display_name }));
    }
    const { metaAlertsFor } = await import("./meta-alerts.server.ts");
    const alerts: import("./meta-alerts.types.ts").MetaAlert[] = [];
    const errors: { client_id: string; account_label: string; error: string }[] = [];
    let next = 0;
    const worker = async () => {
      while (next < accounts.length) {
        const a = accounts[next++];
        try {
          alerts.push(...(await metaAlertsFor(a.client_id, a.label)));
        } catch (e) {
          errors.push({ client_id: a.client_id, account_label: a.label, error: e instanceof Error ? e.message.slice(0, 300) : "Lỗi" });
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    const rank = { danger: 0, warn: 1, info: 2 } as const;
    alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || a.account_label.localeCompare(b.account_label, "vi"));
    return { alerts, accounts: accounts.length, errors, generated_at: new Date().toISOString() };
  });
