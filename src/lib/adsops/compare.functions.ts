import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import type { CompareGroup, ComparePeriod, CompareRead, GroupSuggestion } from "./compare.types.ts";

export type { CompareGroup, ComparePeriod, CompareRead, CompareRow, GroupSuggestion, MetricKey, Metrics } from "./compare.types.ts";

type Ctx = import("./permissions.server").AccessContext;
const rec = (d: unknown) => (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
const PERIODS: ComparePeriod[] = ["this_month", "last_month", "last3", "months", "days"];

async function staffOnly(ctx: Ctx) {
  const { ForbiddenError } = await import("./permissions.server");
  if (ctx.principal.kind !== "staff" || ctx.principal.role === "pending") throw new ForbiddenError("Chỉ nhân sự.");
}
/** Admin / Trưởng phòng, not in Xem như, not read-only. */
const canManage = (ctx: Ctx) => ctx.principal.kind === "staff" && (ctx.principal.role === "admin" || ctx.principal.role === "head_ads") && !ctx.viewAs && !ctx.readOnly;
const canCompute = (ctx: Ctx) => ctx.real.isSuperAdmin && ctx.real.role === "admin" && !ctx.viewAs && !ctx.readOnly;
async function assertManage(ctx: Ctx) {
  const { ForbiddenError } = await import("./permissions.server");
  if (!canManage(ctx)) throw new ForbiddenError(ctx.viewAs ? "Đang Xem như — thoát chế độ xem để sửa nhóm." : "Chỉ Admin / Trưởng phòng sửa được nhóm so sánh.");
}
/** Accounts this user may see (Sale: assigned only; Xem như: the target's scope). */
async function visibleAccounts(ctx: Ctx) {
  const { canSeeAccount } = await import("./permissions.server");
  const { loadWorkspaceDirectory } = await import("./access.server");
  const { withPulledMccClients } = await import("./mcc-import.server");
  const dir = await withPulledMccClients(await loadWorkspaceDirectory(ctx), ctx.allowed);
  return dir.clients.filter((c) => canSeeAccount(ctx, c.client_id) && !c.client_id.startsWith("oa_"));
}
/** Personal-group owner: the real signed-in staff user (never the Xem như target). */
const meOf = (ctx: Ctx) => (ctx.real.kind === "staff" ? (ctx.real.email || ctx.real.id).toLowerCase() : null);
/** Personal groups: any staff role, but not in Xem như / read-only. */
const canSavePersonal = (ctx: Ctx) => ctx.principal.kind === "staff" && ctx.principal.role !== "pending" && !ctx.viewAs && !ctx.readOnly;
const label = (c: { alias?: string | null; display_name: string }) => (c.alias && c.alias.trim()) || c.display_name;
const actor = async (ctx: Ctx) => (await import("./permissions.server")).actorLabel(ctx.real);

export const listCompareGroupsFn = createServerFn({ method: "POST" })
  .middleware([principalMiddleware])
  .handler(async ({ context }) => {
    const ctx = context.access;
    await staffOnly(ctx);
    const acc = await visibleAccounts(ctx);
    const vis = new Set(acc.map((c) => c.client_id));
    const groups: CompareGroup[] = await (await import("./compare.server.ts")).listGroups((id) => vis.has(id), meOf(ctx));
    return {
      groups, can_manage: canManage(ctx), can_save_personal: canSavePersonal(ctx), view_as: Boolean(ctx.viewAs),
      accounts: acc.map((c) => ({ client_id: c.client_id, label: label(c), customer_id_dashed: c.customer_id_dashed || null, platform: c.client_id.startsWith("fb_") ? "facebook" : c.client_id.startsWith("tt_") ? "tiktok" : "google" })),
    };
  });

export const readCompareFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = rec(data);
    const groupId = Number(d.groupId);
    const period = PERIODS.includes(d.period as ComparePeriod) ? (d.period as ComparePeriod) : "last_month";
    const arr = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && /^[a-z_]{1,20}$/.test(s)).slice(0, 20) : []);
    const clientIds = Array.isArray(d.clientIds) ? d.clientIds.filter((s): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(s)).slice(0, 60) : null;
    let range: { from: string; to: string } | null = null;
    const from = typeof d.from === "string" ? d.from : "", to = typeof d.to === "string" ? d.to : "";
    if (period === "months") {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(from) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(to) || from > to) throw new Error("Khoảng tháng không hợp lệ.");
      const n = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5)) - Number(from.slice(5)) + 1;
      if (n > 12) throw new Error("Tối đa 12 tháng.");
      range = { from, to };
    } else if (period === "days") {
      const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
      if (!ok(from) || !ok(to) || from > to) throw new Error("Khoảng ngày không hợp lệ.");
      const n = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
      if (n > 366) throw new Error("Tối đa khoảng 1 năm (366 ngày).");
      range = { from, to };
    }
    if (period === "days" && clientIds && clientIds.length > 60) throw new Error("Tối đa 60 tài khoản.");
    return { groupId: Number.isInteger(groupId) && groupId > 0 ? groupId : 0, period, range, channels: arr(d.channels), convGroups: arr(d.convGroups), clientIds };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<CompareRead> => {
    const ctx = context.access;
    await staffOnly(ctx);
    const acc = await visibleAccounts(ctx);
    const by = new Map(acc.map((c) => [c.client_id, c]));
    const srv = await import("./compare.server.ts");
    // "Tự chọn tài khoản": ad-hoc selection, limited to the caller's scope (server-side; Xem như = target's scope).
    const custom = Array.isArray(data.clientIds);
    const g = custom ? null : (await srv.listGroups((id) => by.has(id), meOf(ctx))).find((x) => x.id === data.groupId) || null;
    const ids = custom ? [...new Set(data.clientIds!)] : g?.members || [];
    // Google first: other platforms are listed once they store compare_monthly rows.
    const members = ids.map((id) => by.get(id)!).filter((c) => c && srv.platformOf(c.client_id) === "google");
    return srv.readCompare({
      group: g ? { id: g.id, name: g.name, personal: g.personal } : null, custom,
      accounts: members.map((c) => ({ client_id: c.client_id, label: label(c), customer_id_dashed: c.customer_id_dashed || null })),
      period: data.period, range: data.range, channels: data.channels, convGroups: data.convGroups, canManage: canManage(ctx), canCompute: canCompute(ctx),
    });
  });

export const saveCompareGroupFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = rec(data);
    const op = String(d.op || "");
    if (!["create", "rename", "delete", "add", "remove"].includes(op)) throw new Error("Thao tác không hợp lệ");
    const name = typeof d.name === "string" ? d.name.trim().slice(0, 80) : "";
    const id = Number(d.id) || 0;
    const ids = Array.isArray(d.clientIds) ? d.clientIds.filter((s): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(s)).slice(0, 500) : [];
    if ((op === "create" || op === "rename") && !name) throw new Error("Cần tên nhóm.");
    return { op: op as "create" | "rename" | "delete" | "add" | "remove", name, id, ids, personal: d.personal === true };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const ctx = context.access;
    await staffOnly(ctx);
    const { ForbiddenError } = await import("./permissions.server");
    const srv = await import("./compare.server.ts");
    const me = meOf(ctx);
    // Personal ("Nhóm của tôi"): only its owner, never in Xem như. Shared: Admin / Trưởng phòng.
    const personal = data.op === "create" ? data.personal : data.id ? (await srv.groupOwner(data.id)) != null : false;
    if (data.op !== "create" && data.id) {
      const owner = await srv.groupOwner(data.id);
      if (owner === undefined) throw new Error("Không tìm thấy nhóm.");
      if (owner != null && owner !== me) throw new ForbiddenError("Không tìm thấy nhóm.");
    }
    if (personal) { if (!canSavePersonal(ctx) || !me) throw new ForbiddenError("Đang Xem như — không lưu / sửa nhóm."); }
    else await assertManage(ctx);
    const vis = new Set((await visibleAccounts(ctx)).map((c) => c.client_id));
    const ids = data.ids.filter((i) => vis.has(i));
    const by = await actor(ctx);
    if (data.op === "create") return { id: await srv.createGroup(data.name, ids, by, personal ? me : null) };
    if (!data.id) throw new Error("Thiếu nhóm.");
    if (data.op === "rename") await srv.renameGroup(data.id, data.name);
    else if (data.op === "delete") await srv.deleteGroup(data.id);
    else if (data.op === "add") await srv.addMembers(data.id, ids, by);
    else for (const i of ids) await srv.removeMember(data.id, i);
    return { id: data.id };
  });

/** "Gợi ý nhóm": proposals by client / company name over the visible accounts. Only a suggestion. */
export const suggestCompareGroupsFn = createServerFn({ method: "POST" })
  .middleware([principalMiddleware])
  .handler(async ({ context }): Promise<{ suggestions: GroupSuggestion[] }> => {
    const ctx = context.access;
    await staffOnly(ctx);
    await assertManage(ctx);
    const acc = await visibleAccounts(ctx);
    const vis = new Set(acc.map((c) => c.client_id));
    const groups = (await (await import("./compare.server.ts")).listGroups((id) => vis.has(id))).filter((g) => !g.personal);
    const { suggestGroups } = await import("./compare.types.ts");
    return { suggestions: suggestGroups(acc.map((c) => ({ client_id: c.client_id, names: [c.alias || "", c.display_name] })), groups) };
  });

/** Admin: compute the stored monthly rows now for group members that have none / are stale (read-only GAQL). */
export const computeCompareFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ groupId: Number(rec(data).groupId) || 0 }))
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const ctx = context.access;
    await staffOnly(ctx);
    const { ForbiddenError } = await import("./permissions.server");
    if (!canCompute(ctx)) throw new ForbiddenError("Chỉ Admin.");
    const acc = await visibleAccounts(ctx);
    const vis = new Set(acc.map((c) => c.client_id));
    const srv = await import("./compare.server.ts");
    const g = (await srv.listGroups((id) => vis.has(id), meOf(ctx))).find((x) => x.id === data.groupId);
    if (!g) throw new Error("Không tìm thấy nhóm.");
    const ids = g.members.filter((id) => srv.platformOf(id) === "google");
    const deadline = Date.now() + 50_000;
    let next = 0, done = 0, failed = 0;
    const errors: string[] = [];
    const worker = async () => {
      while (Date.now() < deadline && next < ids.length) {
        const id = ids[next++];
        const r = await srv.computeGoogleCompare(id);
        done += 1; if (!r.ok) { failed += 1; if (errors.length < 3 && r.error) errors.push(r.error); }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return { total: ids.length, done, failed, remaining: ids.length - done, errors };
  });
