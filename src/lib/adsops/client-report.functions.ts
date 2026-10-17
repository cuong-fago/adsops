import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import type { ReportData, ReportListRow, ReportNotes, ReportOptions, ScopeOption } from "./client-report.types.ts";

export type { ReportData, ReportListRow, ReportNotes, ReportOptions, ScopeOption } from "./client-report.types.ts";

type Ctx = import("./permissions.server").AccessContext;
const DENY = "Chỉ Admin, Trưởng phòng Ads hoặc người tối ưu được giao tài khoản mới dùng được Báo cáo khách hàng.";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const obj = (d: unknown) => (d && typeof d === "object" ? d : {}) as Record<string, unknown>;

async function assertReportStaff(ctx: Ctx) {
  const { ForbiddenError } = await import("./permissions.server");
  const { isReportStaff } = await import("./client-report.access");
  if (!isReportStaff(ctx)) throw new ForbiddenError(DENY);
}
async function visibleIds(ctx: Ctx): Promise<string[]> {
  const { canSeeAccount } = await import("./permissions.server");
  const { loadWorkspaceDirectory } = await import("./access.server");
  const { withPulledMccClients } = await import("./mcc-import.server");
  const dir = await withPulledMccClients(await loadWorkspaceDirectory(ctx), ctx.allowed);
  return dir.clients.filter((c) => canSeeAccount(ctx, c.client_id)).map((c) => c.client_id);
}
/** Load a report the viewer may manage (every account granted); same error when missing. */
async function ownReport(ctx: Ctx, id: number, write: boolean) {
  const { canSeeAccount, ForbiddenError } = await import("./permissions.server");
  const r = await import("./client-report.server.ts");
  const rep = await r.getReport(id);
  if (!rep || !rep.account_ids.length || !rep.account_ids.every((a) => canSeeAccount(ctx, a))) throw new ForbiddenError("Không tìm thấy báo cáo hoặc bạn không có quyền.");
  if (write && ctx.readOnly) throw new ForbiddenError("Đang xem như người khác: chỉ đọc.");
  return rep;
}

/** Scopes (client groups fully visible + single accounts), saved reports, draft count. */
export const listClientReportsFn = createServerFn({ method: "POST" })
  .middleware([principalMiddleware])
  .handler(async ({ context }): Promise<{ scopes: ScopeOption[]; reports: ReportListRow[]; drafts: number; can_write: boolean }> => {
    const ctx = context.access;
    await assertReportStaff(ctx);
    const { canSeeAccount } = await import("./permissions.server");
    const r = await import("./client-report.server.ts");
    const ids = await visibleIds(ctx);
    const [groups, labels, sched, reports] = await Promise.all([r.groupsFor(ids), r.accountLabels(ids), r.readSchedules(), r.listReports((a) => canSeeAccount(ctx, a))]);
    const scopes: ScopeOption[] = [
      ...groups.sort((a, b) => a.name.localeCompare(b.name, "vi")).map((g) => ({ kind: "group" as const, id: g.id, label: g.name, accounts: g.members, schedule: sched.get(`group:${g.id}`) ?? null })),
      ...ids.map((i) => ({ kind: "account" as const, id: i, label: labels.get(i) || i, accounts: [i], schedule: sched.get(`account:${i}`) ?? null })).sort((a, b) => a.label.localeCompare(b.label, "vi")),
    ];
    return { scopes, reports, drafts: reports.filter((x) => x.status === "draft").length, can_write: !ctx.readOnly };
  });

/** Draft count for the nav badge ("Có báo cáo nháp cần duyệt"). Silent 0 for others. */
export const reportDraftCountFn = createServerFn({ method: "POST" })
  .middleware([principalMiddleware])
  .handler(async ({ context }): Promise<{ drafts: number }> => {
    const ctx = context.access;
    const { isReportStaff } = await import("./client-report.access");
    if (!isReportStaff(ctx)) return { drafts: 0 };
    const { canSeeAccount } = await import("./permissions.server");
    const r = await import("./client-report.server.ts");
    const list = await r.listReports((a) => canSeeAccount(ctx, a));
    return { drafts: list.filter((x) => x.status === "draft").length };
  });

export const createClientReportFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = obj(data);
    const kind = d.scopeKind === "group" ? "group" : "account";
    const scopeId = typeof d.scopeId === "string" ? d.scopeId.trim() : "";
    const period = d.period === "week" || d.period === "month" ? d.period : "custom";
    const start = typeof d.start === "string" && DATE.test(d.start) ? d.start : "";
    const end = typeof d.end === "string" && DATE.test(d.end) ? d.end : "";
    if (!scopeId) throw new Error("Chọn khách hàng hoặc tài khoản.");
    if (!start || !end || end < start) throw new Error("Khoảng thời gian không hợp lệ.");
    if ((Date.parse(end) - Date.parse(start)) / 864e5 > 366) throw new Error("Tối đa 1 năm.");
    return { kind, scopeId, period, start, end } as const;
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<{ id: number }> => {
    const ctx = context.access;
    await assertReportStaff(ctx);
    const { canSeeAccount, ForbiddenError, actorLabel } = await import("./permissions.server");
    if (ctx.readOnly) throw new ForbiddenError("Đang xem như người khác: chỉ đọc.");
    const r = await import("./client-report.server.ts");
    const ids = await r.scopeAccounts(data.kind, data.scopeId);
    if (!ids.length || !ids.every((a) => canSeeAccount(ctx, a))) throw new ForbiddenError("Bạn không có quyền với toàn bộ tài khoản của khách hàng này.");
    const id = await r.createReport({ scope_kind: data.kind, scope_id: data.scopeId, ids, period: { kind: data.period, start: data.start, end: data.end } }, actorLabel(ctx.real));
    if (!id) throw new Error("Không tạo được báo cáo.");
    await r.generate(id);
    return { id };
  });

/** Full report for the editor (generates lazily on first open). */
export const readClientReportFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ id: Number(obj(data).id) }))
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<{ row: ReportListRow; data: ReportData | null; notes: ReportNotes; options: ReportOptions; summary: string[] }> => {
    const ctx = context.access;
    await assertReportStaff(ctx);
    let rep = await ownReport(ctx, data.id, false);
    const r = await import("./client-report.server.ts");
    if (!rep.data && !ctx.readOnly) rep = (await r.generate(data.id)) || rep;
    const { summarize } = await import("./client-report.types.ts");
    const list = await r.listReports((a) => rep.account_ids.includes(a));
    return { row: list.find((x) => x.id === data.id) || rep.row, data: rep.data, notes: rep.notes, options: rep.options, summary: rep.data ? summarize(rep.data) : [] };
  });

export const updateClientReportFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = obj(data);
    const action = ["notes", "options", "sent", "draft", "regenerate", "delete", "link", "revoke"].includes(String(d.action)) ? String(d.action) : "";
    if (!action) throw new Error("Thao tác không hợp lệ.");
    const s = (v: unknown) => (typeof v === "string" ? v.slice(0, 4000) : "");
    const n = obj(d.notes), o = obj(d.options);
    const days = Number(d.days);
    return {
      id: Number(d.id), action,
      notes: { good: s(n.good), issues: s(n.issues), plan: s(n.plan) },
      options: { show_work: o.show_work !== false, show_appendix: o.show_appendix === true },
      days: Number.isFinite(days) && days >= 1 && days <= 365 ? Math.round(days) : 30,
      linkId: Number(d.linkId),
    };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<{ ok: true; token?: string; expires_at?: string }> => {
    const ctx = context.access;
    await assertReportStaff(ctx);
    const rep = await ownReport(ctx, data.id, true);
    const { actorLabel } = await import("./permissions.server");
    const r = await import("./client-report.server.ts");
    const by = actorLabel(ctx.real);
    switch (data.action) {
      case "notes": await r.updateReport(data.id, { notes: data.notes }, by); break;
      case "options": await r.updateReport(data.id, { options: data.options }, by); break;
      case "sent":
        if (!rep.data) throw new Error("Báo cáo chưa có số liệu.");
        await r.updateReport(data.id, { status: "sent" }, by); break;
      case "draft": await r.updateReport(data.id, { status: "draft" }, by); break;
      case "regenerate": await r.generate(data.id); break;
      case "delete": await r.deleteReport(data.id); break;
      case "link": {
        if (!rep.data) throw new Error("Báo cáo chưa có số liệu.");
        const l = await r.createLink(data.id, data.days, by);
        return { ok: true, token: l.token, expires_at: l.expires_at };
      }
      case "revoke": await r.revokeLink(data.id, data.linkId); break;
    }
    return { ok: true };
  });

/** Weekly / monthly auto-draft per scope (draft only; never emails anyone). */
export const setReportScheduleFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = obj(data);
    return { kind: d.scopeKind === "group" ? ("group" as const) : ("account" as const), scopeId: String(d.scopeId || ""), freq: (d.freq === "weekly" || d.freq === "monthly" ? d.freq : null) as "weekly" | "monthly" | null };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const ctx = context.access;
    await assertReportStaff(ctx);
    const { canSeeAccount, ForbiddenError, actorLabel } = await import("./permissions.server");
    if (ctx.readOnly) throw new ForbiddenError("Đang xem như người khác: chỉ đọc.");
    const r = await import("./client-report.server.ts");
    const ids = await r.scopeAccounts(data.kind, data.scopeId);
    if (!ids.length || !ids.every((a) => canSeeAccount(ctx, a))) throw new ForbiddenError("Bạn không có quyền với toàn bộ tài khoản của khách hàng này.");
    await r.setSchedule(data.kind, data.scopeId, data.freq, actorLabel(ctx.real));
    return { ok: true };
  });

/** Client portal: reports marked "Đã gửi" whose accounts are ALL granted to this client user. */
export const listPortalReportsFn = createServerFn({ method: "POST" })
  .middleware([principalMiddleware])
  .handler(async ({ context }): Promise<{ reports: { id: number; title: string; start_date: string; end_date: string; sent_at: string | null }[] }> => {
    const ctx = context.access;
    if (ctx.principal.kind !== "client" || ctx.principal.role === "pending") return { reports: [] };
    const { canSeeAccount } = await import("./permissions.server");
    const r = await import("./client-report.server.ts");
    const list = await r.listReports((a) => canSeeAccount(ctx, a), { status: "sent" });
    return { reports: list.map((x) => ({ id: x.id, title: x.title, start_date: x.start_date, end_date: x.end_date, sent_at: x.sent_at })) };
  });
