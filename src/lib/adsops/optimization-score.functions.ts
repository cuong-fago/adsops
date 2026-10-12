import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import type { ScoreCheckResult, ScoreRead, ScoreRow } from "./optimization-score.types.ts";

export type { ScoreCheckResult, ScoreRead, ScoreRow } from "./optimization-score.types.ts";

const STAFF_ONLY = "Chỉ nhân sự xem được điểm tối ưu.";

/** Same account list as the shell picker (file roster + MCC-pulled accounts), viewer's grants only. */
async function scoreAccounts(ctx: import("./permissions.server").AccessContext) {
  const { loadWorkspaceDirectory } = await import("./access.server");
  const { withPulledMccClients } = await import("./mcc-import.server");
  const { canSeeAccount } = await import("./permissions.server");
  const dir = await withPulledMccClients(await loadWorkspaceDirectory(ctx), ctx.allowed);
  return dir.clients
    .filter((c) => canSeeAccount(ctx, c.client_id))
    .map((c) => ({
      client_id: c.client_id,
      label: c.alias ? `${c.alias} — ${c.display_name}` : c.display_name,
      customer_id_dashed: c.customer_id_dashed || "",
    }));
}

function asClient(data: unknown): { clientId: string } {
  const id = data && typeof data === "object" ? (data as { clientId?: unknown }).clientId : null;
  if (typeof id !== "string" || !id.trim()) throw new Error("Thiếu tài khoản");
  return { clientId: id.trim() };
}

async function staffCtx(ctx: import("./permissions.server").AccessContext) {
  const { ForbiddenError } = await import("./permissions.server");
  if (ctx.principal.kind !== "staff" || ctx.principal.role === "pending") throw new ForbiddenError(STAFF_ONLY);
}

/** Stored scores for every account the viewer can see (card). Staff only; no Google call. */
export const readOptimizationScoresFn = createServerFn({ method: "POST" })
  .middleware([principalMiddleware])
  .handler(async ({ context }): Promise<ScoreRead> => {
    await staffCtx(context.access);
    const { readOptimizationScores } = await import("./optimization-score.server");
    return { rows: await readOptimizationScores(await scoreAccounts(context.access)) };
  });

/** Stored score for ONE account (account strip). Staff with this account; no Google call. */
export const readAccountScoreFn = createServerFn({ method: "POST" })
  .validator(asClient)
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<ScoreRow> => {
    await staffCtx(context.access);
    const { assertAccount } = await import("./permissions.server");
    assertAccount(context.access, data.clientId);
    const { readOptimizationScores } = await import("./optimization-score.server");
    const [row] = await readOptimizationScores([{ client_id: data.clientId, label: "", customer_id_dashed: "" }]);
    return row;
  });

/**
 * Background check of ONE account when today's score is missing (read-only cache fill).
 * Any staff role with this account, including Sale and admin view-as; guards in refreshScoreIfStale.
 */
export const refreshAccountScoreFn = createServerFn({ method: "POST" })
  .validator(asClient)
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    await staffCtx(context.access);
    const { assertAccount } = await import("./permissions.server");
    assertAccount(context.access, data.clientId);
    const { refreshScoreIfStale } = await import("./optimization-score.server");
    return refreshScoreIfStale(data.clientId);
  });

/** "Kiểm tra tất cả tài khoản" (one account per call): pull roles; never while viewing-as. */
export const checkOptimizationScoreFn = createServerFn({ method: "POST" })
  .validator(asClient)
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<ScoreCheckResult> => {
    await staffCtx(context.access);
    const { assertCap, assertWritable, assertAccount } = await import("./permissions.server");
    const ctx = context.access;
    assertCap(ctx, "pull", "Chỉ admin / trưởng phòng Ads / người tối ưu được kiểm tra Google Ads.");
    assertWritable(ctx);
    assertAccount(ctx, data.clientId);
    const { checkOptimizationScore } = await import("./optimization-score.server");
    return checkOptimizationScore(data.clientId);
  });
