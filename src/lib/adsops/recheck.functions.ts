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

export type Spend10BatchResult = { checked: number; skipped: number; failed: number };

/**
 * "Kiểm tra lại tất cả": 10-day spend check for accounts not in the shown list (hidden ones),
 * so an account that started spending comes back right away. Read-only, staff only, 8 at a time,
 * same 2-minute per-account cooldown.
 */
export const recheckSpend10Fn = createServerFn({ method: "POST" })
  .validator((data: unknown): { clientIds: string[] } => {
    const ids = data && typeof data === "object" ? (data as { clientIds?: unknown }).clientIds : null;
    if (!Array.isArray(ids)) throw new Error("Thiếu danh sách tài khoản");
    return { clientIds: [...new Set(ids.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()))].slice(0, 500) };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<Spend10BatchResult> => {
    const ctx = context.access;
    const { ForbiddenError, canSeeAccount } = await import("./permissions.server");
    if (ctx.principal.kind !== "staff" || ctx.principal.role === "pending") throw new ForbiddenError("Chỉ nhân sự.");
    const ids = data.clientIds.filter((id) => canSeeAccount(ctx, id));
    const { resolveAdsConfig } = await import("./google-ads.server");
    const cfg = await resolveAdsConfig();
    if (!cfg.ready) return { checked: 0, skipped: ids.length, failed: 0 };
    const { acquireLock } = await import("./warehouse.server");
    const { checkSpend10 } = await import("./spend10.server");
    const deadline = Date.now() + 50_000;
    let next = 0;
    const out: Spend10BatchResult = { checked: 0, skipped: 0, failed: 0 };
    const worker = async () => {
      while (next < ids.length && Date.now() < deadline) {
        const id = ids[next++];
        if (!(await acquireLock(`${id}:spend10`, 120))) { out.skipped += 1; continue; }
        const r = await checkSpend10(id, cfg).catch(() => null);
        if (r?.ok) out.checked += 1; else out.failed += 1;
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    out.skipped += Math.max(0, ids.length - next);
    return out;
  });
