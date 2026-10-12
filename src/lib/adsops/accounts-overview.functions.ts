import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import type { OverviewRead } from "./accounts-overview.types.ts";

export type { OverviewRead, OverviewRow } from "./accounts-overview.types.ts";

/**
 * Stored overview for every account the viewer can see (same directory as the picker).
 * Staff only (all staff roles, view-as included). No Google call. Only the date of the
 * last keyword optimization leaves the change log; change details stay behind changeLog.
 */
export const readAccountsOverviewFn = createServerFn({ method: "POST" })
  .middleware([principalMiddleware])
  .handler(async ({ context }): Promise<OverviewRead> => {
    const ctx = context.access;
    const { ForbiddenError, canSeeAccount } = await import("./permissions.server");
    if (ctx.principal.kind !== "staff" || ctx.principal.role === "pending") throw new ForbiddenError("Chỉ nhân sự xem được tổng quan tài khoản.");
    const { loadWorkspaceDirectory } = await import("./access.server");
    const { withPulledMccClients } = await import("./mcc-import.server");
    const dir = await withPulledMccClients(await loadWorkspaceDirectory(ctx), ctx.allowed);
    const accounts = dir.clients
      .filter((c) => canSeeAccount(ctx, c.client_id))
      .map((c) => ({
        client_id: c.client_id,
        label: c.alias ? `${c.alias} — ${c.display_name}` : c.display_name,
        customer_id_dashed: c.customer_id_dashed || "",
      }));
    const { readAccountsOverview } = await import("./accounts-overview.server");
    return { rows: await readAccountsOverview(accounts) };
  });
