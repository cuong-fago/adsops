import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import type { ManagerRead } from "./manager.types.ts";

export type { ManagerRead } from "./manager.types.ts";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "Bảng điều hành": Admin and Trưởng phòng Ads only (their own grants). Stored data only. */
export const readManagerFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const s = typeof d.start === "string" && DATE.test(d.start) ? d.start : null;
    const e = typeof d.end === "string" && DATE.test(d.end) ? d.end : null;
    if (s && e && (e < s || (Date.parse(e) - Date.parse(s)) / 864e5 > 366)) throw new Error("Khoảng thời gian không hợp lệ (tối đa 1 năm).");
    return { start: s, end: e };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<ManagerRead> => {
    const ctx = context.access;
    const { ForbiddenError, canSeeAccount } = await import("./permissions.server");
    if (ctx.principal.kind !== "staff" || (ctx.principal.role !== "admin" && ctx.principal.role !== "head_ads")) throw new ForbiddenError("Chỉ Admin và Trưởng phòng Ads xem được Bảng điều hành.");
    const { loadWorkspaceDirectory } = await import("./access.server");
    const { withPulledMccClients } = await import("./mcc-import.server");
    const dir = await withPulledMccClients(await loadWorkspaceDirectory(ctx), ctx.allowed);
    const accounts = dir.clients.filter((c) => canSeeAccount(ctx, c.client_id)).map((c) => ({ client_id: c.client_id, label: (c.alias && c.alias.trim()) || c.display_name, customer_id_dashed: c.customer_id_dashed }));
    const m = await import("./manager.server.ts");
    return m.readManager(accounts, data.start, data.end);
  });
