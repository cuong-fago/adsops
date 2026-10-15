import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import type { ActivityRead } from "./account-activity.types.ts";

export type { AccountActivity, ActivityRead } from "./account-activity.types.ts";

/** Activity of every account the viewer can see (same directory as the picker). Stored data only. */
export const readAccountActivityFn = createServerFn({ method: "POST" })
  .middleware([principalMiddleware])
  .handler(async ({ context }): Promise<ActivityRead> => {
    const ctx = context.access;
    // Staff lists only: client portals keep showing every account they were granted.
    if (ctx.principal.role === "pending" || ctx.principal.kind !== "staff") return { accounts: {} };
    const { loadWorkspaceDirectory } = await import("./access.server");
    const { withPulledMccClients } = await import("./mcc-import.server");
    const { canSeeAccount } = await import("./permissions.server");
    const dir = await withPulledMccClients(await loadWorkspaceDirectory(ctx), ctx.allowed);
    const ids = dir.clients.filter((c) => canSeeAccount(ctx, c.client_id)).map((c) => c.client_id);
    const { readActivity } = await import("./account-activity.server");
    return { accounts: Object.fromEntries(await readActivity(ids)) };
  });
