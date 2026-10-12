import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import { DRILL_BUCKETS, type ChangeDrill, type ChangeLogPullResult, type ChangeLogRead, type DrillBucket } from "./change-log.types.ts";

export type { ChangeLogPullResult, ChangeLogRead } from "./change-log.types.ts";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DENY = "Chỉ Admin / Trưởng phòng Ads xem được Nhật ký tối ưu.";

function asRead(data: unknown): { clientIds: string[] | null; start: string; end: string; drill: ChangeDrill | null } {
  if (!data || typeof data !== "object") throw new Error("Thiếu dữ liệu");
  const d = data as Record<string, unknown>;
  const start = typeof d.start === "string" ? d.start : "";
  const end = typeof d.end === "string" ? d.end : "";
  if (!YMD.test(start) || !YMD.test(end) || end < start) throw new Error("Khoảng ngày không hợp lệ");
  if (Date.parse(end) - Date.parse(start) > 400 * 86400000) throw new Error("Khoảng ngày tối đa 400 ngày");
  let clientIds: string[] | null = null;
  if (Array.isArray(d.clientIds)) {
    clientIds = d.clientIds.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()).slice(0, 500);
  }
  let drill: ChangeDrill | null = null;
  const dr = d.drill && typeof d.drill === "object" ? (d.drill as Record<string, unknown>) : null;
  if (dr && typeof dr.client_id === "string" && DRILL_BUCKETS.includes(dr.bucket as DrillBucket)) {
    drill = { client_id: dr.client_id.trim(), bucket: dr.bucket as DrillBucket };
  }
  return { clientIds, start, end, drill };
}

function asClient(data: unknown): { clientId: string } {
  const id = data && typeof data === "object" ? (data as { clientId?: unknown }).clientId : null;
  if (typeof id !== "string" || !id.trim()) throw new Error("Thiếu tài khoản");
  return { clientId: id.trim() };
}

/**
 * Accounts the viewer can see, from the SAME source as the shell picker
 * (getWorkspaceDirectory): file roster + accounts pulled from every MCC into
 * Neon ad_accounts. The file roster alone misses MCC-pulled accounts.
 */
async function changeLogAccounts(ctx: import("./permissions.server").AccessContext) {
  const { loadWorkspaceDirectory } = await import("./access.server");
  const { withPulledMccClients } = await import("./mcc-import.server");
  const dir = await withPulledMccClients(await loadWorkspaceDirectory(ctx), ctx.allowed);
  return dir.clients;
}

/** Read the stored change log. Admin / head_ads only; only accounts the viewer can see. */
export const readChangeLogFn = createServerFn({ method: "POST" })
  .validator(asRead)
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<ChangeLogRead> => {
    const { assertCap, assertAccount } = await import("./permissions.server");
    const ctx = context.access;
    assertCap(ctx, "changeLog", DENY);
    if (data.clientIds) for (const id of data.clientIds) assertAccount(ctx, id);
    if (data.drill) assertAccount(ctx, data.drill.client_id);
    const visible = await changeLogAccounts(ctx);
    const wanted = data.clientIds ? new Set(data.clientIds) : null;
    const accounts = visible
      .filter((c) => !wanted || wanted.has(c.client_id))
      .map((c) => ({
        client_id: c.client_id,
        label: c.alias ? `${c.alias} — ${c.display_name}` : c.display_name,
        customer_id_dashed: c.customer_id_dashed || "",
      }));
    const { readChangeLog } = await import("./change-log.server");
    // A drill account outside the listed accounts yields no rows (the reader filters by both).
    return readChangeLog(accounts, data.start, data.end, data.drill);
  });

/** "Kéo nhật ký 30 ngày" for one account (read-only Google Ads pull). Never while viewing-as. */
export const pullChangeLogFn = createServerFn({ method: "POST" })
  .validator(asClient)
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<ChangeLogPullResult> => {
    const { assertCap, assertWritable, assertAccount, actorLabel } = await import("./permissions.server");
    const ctx = context.access;
    assertCap(ctx, "changeLog", DENY);
    assertWritable(ctx);
    assertAccount(ctx, data.clientId);
    const { pullChangeLog } = await import("./change-log.server");
    return pullChangeLog(data.clientId, { trigger: "manual", actor: actorLabel(ctx.real) });
  });

/**
 * On-view refresh of ONE account's change log (overview tab). Read-only Google pull used as a
 * cache fill, so any staff role with the account may trigger it (Sale and view-as included);
 * the guards (6 h freshness, lock, 30 min error cooldown) live in autoPullChangeLog.
 * Returns no change details: those stay behind the changeLog capability.
 */
export const autoPullChangeLogFn = createServerFn({ method: "POST" })
  .validator((data: unknown): { clientId: string } => {
    const id = data && typeof data === "object" ? (data as { clientId?: unknown }).clientId : null;
    if (typeof id !== "string" || !id.trim()) throw new Error("Thiếu tài khoản");
    return { clientId: id.trim() };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const ctx = context.access;
    const { ForbiddenError, assertAccount, actorLabel } = await import("./permissions.server");
    if (ctx.principal.kind !== "staff" || ctx.principal.role === "pending") throw new ForbiddenError("Chỉ nhân sự.");
    assertAccount(ctx, data.clientId);
    const { autoPullChangeLog } = await import("./change-log.server");
    return autoPullChangeLog(data.clientId, `auto:${actorLabel(ctx.real)}`);
  });
