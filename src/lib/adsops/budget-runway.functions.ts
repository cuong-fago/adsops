import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import type { RunwayCheckResult, RunwayRead } from "./budget-runway.types.ts";

export type { RunwayCheckResult, RunwayRead, RunwayRow } from "./budget-runway.types.ts";

const SEE = "Vai trò này không xem được Cảnh báo.";

/** Same account list as the shell picker (file roster + MCC-pulled Neon accounts), viewer's grants only. */
async function runwayAccounts(ctx: import("./permissions.server").AccessContext) {
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

/** Cached results (no Google call). Roles that see Cảnh báo (optimize capability); staff only. */
export const readBudgetRunwayFn = createServerFn({ method: "POST" })
  .middleware([principalMiddleware])
  .handler(async ({ context }): Promise<RunwayRead> => {
    const { assertCap, ForbiddenError } = await import("./permissions.server");
    const ctx = context.access;
    assertCap(ctx, "optimize", SEE);
    if (ctx.principal.kind !== "staff") throw new ForbiddenError(SEE);
    const { readBudgetRunway } = await import("./budget-runway.server");
    return { rows: await readBudgetRunway(await runwayAccounts(ctx)) };
  });

function asClient(data: unknown): { clientId: string } {
  const id = data && typeof data === "object" ? (data as { clientId?: unknown }).clientId : null;
  if (typeof id !== "string" || !id.trim()) throw new Error("Thiếu tài khoản");
  return { clientId: id.trim() };
}

/** Read-only Google check for one account: same roles as other Google pulls; never while viewing-as. */
export const checkBudgetRunwayFn = createServerFn({ method: "POST" })
  .validator(asClient)
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<RunwayCheckResult> => {
    const { assertCap, assertWritable, assertAccount } = await import("./permissions.server");
    const ctx = context.access;
    assertCap(ctx, "optimize", SEE);
    assertCap(ctx, "pull", "Chỉ admin / trưởng phòng Ads / người tối ưu được kiểm tra Google Ads.");
    assertWritable(ctx);
    assertAccount(ctx, data.clientId);
    const { checkBudgetRunway } = await import("./budget-runway.server");
    return checkBudgetRunway(data.clientId);
  });
