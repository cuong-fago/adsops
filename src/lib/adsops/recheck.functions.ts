import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";

export type RecheckResult = {
  state: "done" | "cooldown";
  runway_ok: boolean | null;
  score_ok: boolean | null;
  error_vi: string | null;
};

/**
 * "Kiểm tra lại" on the account strip: budget runway + optimization score + shared-list counts
 * for ONE account, now (read-only GAQL; skips the 30-min freshness rule). Any staff role with the
 * account, Sale and view-as included; never customers. The Neon row `<client>:recheck` is held
 * for 2 minutes and not released early: it is both the per-account lock and the manual cooldown.
 */
export const recheckAccountFn = createServerFn({ method: "POST" })
  .validator((data: unknown): { clientId: string } => {
    const id = data && typeof data === "object" ? (data as { clientId?: unknown }).clientId : null;
    if (typeof id !== "string" || !id.trim()) throw new Error("Thiếu tài khoản");
    return { clientId: id.trim() };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<RecheckResult> => {
    const ctx = context.access;
    const { ForbiddenError, assertAccount } = await import("./permissions.server");
    if (ctx.principal.kind !== "staff" || ctx.principal.role === "pending") throw new ForbiddenError("Chỉ nhân sự.");
    assertAccount(ctx, data.clientId);
    const { acquireLock } = await import("./warehouse.server");
    if (!(await acquireLock(`${data.clientId}:recheck`, 120))) {
      return { state: "cooldown", runway_ok: null, score_ok: null, error_vi: null };
    }
    const { resolveAdsConfig } = await import("./google-ads.server");
    const { checkBudgetRunway } = await import("./budget-runway.server");
    const { checkOptimizationScore } = await import("./optimization-score.server");
    const { checkSharedSetCounts } = await import("./change-log.server");
    const { checkSpend10 } = await import("./spend10.server");
    const cfg = await resolveAdsConfig();
    if (!cfg.ready) return { state: "done", runway_ok: false, score_ok: false, error_vi: "Chưa cấu hình Google Ads API." };
    const [r, s] = await Promise.all([
      checkBudgetRunway(data.clientId, cfg, { keepOnError: true }).catch((e: unknown) => ({ ok: false, error_vi: e instanceof Error ? e.message : String(e) })),
      checkOptimizationScore(data.clientId, cfg).catch((e: unknown) => ({ ok: false, error_vi: e instanceof Error ? e.message : String(e) })),
      checkSharedSetCounts(data.clientId, cfg).catch(() => null),
      // Re-evaluates the 10-day spend rule (hide / bring back).
      checkSpend10(data.clientId, cfg).catch(() => null),
    ]);
    const errs = [!r.ok ? `Ngân sách: ${r.error_vi || "lỗi"}` : "", !s.ok ? `Điểm tối ưu: ${s.error_vi || "lỗi"}` : ""].filter(Boolean);
    return { state: "done", runway_ok: r.ok, score_ok: s.ok, error_vi: errs.length ? errs.join(" · ") : null };
  });
