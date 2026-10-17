import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import type { PacingRow } from "./budget-plan.types.ts";

export type { BudgetPlan, PacingRow } from "./budget-plan.types.ts";

type Ctx = import("./permissions.server").AccessContext;
const SEE = "Chỉ nhân sự xem được kế hoạch ngân sách.";

/** Staff only (clients never see plan vs actual). */
async function assertStaff(ctx: Ctx) {
  const { ForbiddenError } = await import("./permissions.server");
  if (ctx.principal.kind !== "staff" || ctx.principal.role === "pending") throw new ForbiddenError(SEE);
}
/**
 * Edit: Admin, Trưởng phòng Ads, or an Optimizer granted this account (the grant is the assignment).
 * Never while viewing-as.
 */
async function editorFor(ctx: Ctx): Promise<(id: string) => boolean> {
  return (await import("./plan-access.server")).planEditor(ctx);
}

function monthOf(v: unknown, fallback: string): string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : fallback;
}

/** One account (overview card) or every visible account (accounts overview / Cảnh báo). */
export const readPacingFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    return { clientId: typeof d.clientId === "string" && d.clientId.trim() ? d.clientId.trim() : null, month: typeof d.month === "string" ? d.month : null };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<{ month: string; rows: PacingRow[] }> => {
    const ctx = context.access;
    await assertStaff(ctx);
    const { assertAccount, canSeeAccount } = await import("./permissions.server");
    const m = await import("./budget-plan.server.ts");
    const month = monthOf(data.month, m.currentMonth());
    let ids: string[];
    if (data.clientId) {
      assertAccount(ctx, data.clientId);
      ids = [data.clientId];
    } else {
      const { loadWorkspaceDirectory } = await import("./access.server");
      const { withPulledMccClients } = await import("./mcc-import.server");
      const dir = await withPulledMccClients(await loadWorkspaceDirectory(ctx), ctx.allowed);
      ids = dir.clients.filter((c) => canSeeAccount(ctx, c.client_id)).map((c) => c.client_id);
    }
    return { month, rows: await m.pacingFor(ids, month, await editorFor(ctx)) };
  });

/** Save / clear / copy-last-month for one account and month. AdsOps DB only. */
export const savePlanFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
    const action = d.action === "copy_prev" || d.action === "delete" ? d.action : "save";
    const pos = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : NaN);
    const planned = pos(d.plannedBudget);
    const tconv = pos(d.targetConv);
    const tcpl = pos(d.targetCpl);
    const tcac = pos(d.targetCac);
    const troas = pos(d.targetRoas);
    if (!clientId || typeof d.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(d.month)) throw new Error("Thiếu tài khoản / tháng");
    if (action === "save" && (planned == null || Number.isNaN(planned) || planned <= 0)) throw new Error("Ngân sách kế hoạch phải là số dương (VND).");
    if (Number.isNaN(tconv) || Number.isNaN(tcpl) || Number.isNaN(tcac) || Number.isNaN(troas)) throw new Error("Mục tiêu phải là số không âm.");
    return { clientId, month: d.month, action, planned: planned as number, tconv, tcpl, tcac, troas } as const;
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<{ ok: boolean; message: string | null }> => {
    const ctx = context.access;
    await assertStaff(ctx);
    const { assertAccount, ForbiddenError, actorLabel } = await import("./permissions.server");
    assertAccount(ctx, data.clientId);
    if (!(await editorFor(ctx))(data.clientId)) throw new ForbiddenError("Chỉ Admin, Trưởng phòng Ads hoặc người tối ưu được giao tài khoản mới sửa được kế hoạch.");
    const m = await import("./budget-plan.server.ts");
    const by = actorLabel(ctx.real);
    if (data.action === "delete") { await m.deletePlan(data.clientId, data.month); return { ok: true, message: null }; }
    if (data.action === "copy_prev") {
      const ok = await m.copyPrevPlan(data.clientId, data.month, by);
      return { ok, message: ok ? null : "Tháng trước chưa có kế hoạch." };
    }
    await m.savePlan({ client_id: data.clientId, month: data.month, planned_budget: data.planned, target_conv: data.tconv, target_cpl: data.tcpl, target_cac: data.tcac, target_roas: data.troas }, by);
    return { ok: true, message: null };
  });
