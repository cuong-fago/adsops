import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import type { BizMetrics, BizRead, ImportResult, ImportRowIn, ImportRowResult } from "./outcomes.types.ts";

export type { BizMetrics, BizRead, ImportResult, ImportRowIn } from "./outcomes.types.ts";

type Ctx = import("./permissions.server").AccessContext;
const SEE = "Chỉ nhân sự xem được hiệu quả kinh doanh.";
const EDIT = "Chỉ Admin, Trưởng phòng Ads hoặc người tối ưu được giao tài khoản mới nhập được số liệu kinh doanh.";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

async function assertStaff(ctx: Ctx) {
  const { ForbiddenError } = await import("./permissions.server");
  if (ctx.principal.kind !== "staff" || ctx.principal.role === "pending") throw new ForbiddenError(SEE);
}
async function visibleClients(ctx: Ctx) {
  const { canSeeAccount } = await import("./permissions.server");
  const { loadWorkspaceDirectory } = await import("./access.server");
  const { withPulledMccClients } = await import("./mcc-import.server");
  const dir = await withPulledMccClients(await loadWorkspaceDirectory(ctx), ctx.allowed);
  return dir.clients.filter((c) => canSeeAccount(ctx, c.client_id));
}
const labelOf = (c: { display_name: string; alias?: string | null }) => (c.alias && c.alias.trim()) || c.display_name;
function curMonth(): string {
  const d = new Date(Date.now() + 7 * 3600e3);
  return d.toISOString().slice(0, 7);
}
function prevMonth(m: string): string {
  let [y, mo] = m.split("-").map(Number);
  mo -= 1; if (!mo) { mo = 12; y -= 1; }
  return `${y}-${String(mo).padStart(2, "0")}`;
}

/** One account: 6-month series, entries, plan targets, and its client group (visible accounts only). */
export const readBusinessFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
    if (!clientId) throw new Error("Thiếu tài khoản");
    return { clientId, month: typeof d.month === "string" && MONTH.test(d.month) ? d.month : null };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<BizRead> => {
    const ctx = context.access;
    await assertStaff(ctx);
    const { assertAccount, canSeeAccount } = await import("./permissions.server");
    assertAccount(ctx, data.clientId);
    const o = await import("./outcomes.server.ts");
    const end = data.month || curMonth();
    const months = o.lastMonths(end, 6);
    const g = await o.groupOf(data.clientId);
    const members = g ? g.members.filter((id) => canSeeAccount(ctx, id)) : [];
    const ids = [...new Set([data.clientId, ...members])];
    const s = await o.seriesFor(ids, months);
    const canEdit = (await (await import("./plan-access.server")).planEditor(ctx))(data.clientId);
    let group: BizRead["group"] = null;
    if (g && members.length > 1) {
      const vis = await visibleClients(ctx);
      const byId = new Map(vis.map((c) => [c.client_id, c]));
      const b = s.blended(members);
      group = { id: g.id, name: g.name, accounts: members.map((id) => ({ client_id: id, label: byId.get(id) ? labelOf(byId.get(id)!) : id })), series: b.series, missing: b.missing };
    }
    return {
      client_id: data.clientId, months, series: s.per(data.clientId),
      entries: s.entries.filter((e) => e.client_id === data.clientId),
      targets: await o.targetsFor(data.clientId, end), can_edit: canEdit, group,
    };
  });

/** Accounts overview columns: previous month (the month whose outcomes are usually complete). */
export const readBusinessAllFn = createServerFn({ method: "POST" })
  .middleware([principalMiddleware])
  .handler(async ({ context }): Promise<{ month: string; rows: Record<string, BizMetrics> }> => {
    const ctx = context.access;
    await assertStaff(ctx);
    const o = await import("./outcomes.server.ts");
    const month = prevMonth(curMonth());
    const ids = (await visibleClients(ctx)).map((c) => c.client_id);
    const s = await o.seriesFor(ids, [month]);
    const rows: Record<string, BizMetrics> = {};
    for (const id of ids) rows[id] = s.per(id)[0];
    return { month, rows };
  });

function parseNum(v: unknown): number | null | "bad" {
  if (v == null) return null;
  const t = String(v).trim().replace(/[\s.,](?=\d{3}(\D|$))/g, "").replace(/\s|₫|vnd|đ/gi, "");
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : "bad";
}

/** Manual entry (account total or one campaign). */
export const saveOutcomeFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
    if (!clientId || typeof d.month !== "string" || !MONTH.test(d.month)) throw new Error("Thiếu tài khoản / tháng (YYYY-MM)");
    const v = parseNum(d.validLeads), c = parseNum(d.closed), r = parseNum(d.revenue);
    if (v === "bad" || c === "bad" || r === "bad") throw new Error("Số liệu phải là số không âm.");
    if (d.action !== "delete" && v == null && c == null && r == null) throw new Error("Nhập ít nhất một số liệu.");
    return {
      clientId, month: d.month, campaign: typeof d.campaign === "string" ? d.campaign.trim().slice(0, 200) : "",
      v, c, r, note: typeof d.note === "string" && d.note.trim() ? d.note.trim().slice(0, 1000) : null, del: d.action === "delete",
    };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<{ ok: boolean }> => {
    const ctx = context.access;
    await assertStaff(ctx);
    const { assertAccount, ForbiddenError, actorLabel } = await import("./permissions.server");
    assertAccount(ctx, data.clientId);
    if (!(await import("./plan-access.server")).planEditor(ctx)(data.clientId)) throw new ForbiddenError(EDIT);
    const o = await import("./outcomes.server.ts");
    if (data.del) { await o.deleteOutcome(data.clientId, data.month, data.campaign); return { ok: true }; }
    await o.upsertOutcome({ client_id: data.clientId, month: data.month, campaign: data.campaign, valid_leads: data.v, closed_customers: data.c, revenue: data.r, note: data.note }, actorLabel(ctx.real));
    return { ok: true };
  });

/** CSV / XLSX import (parsed in the browser). dryRun = validate + preview only. Only editable accounts accepted. */
export const importOutcomesFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const rows = Array.isArray(d.rows) ? (d.rows as unknown[]).slice(0, 2000) : [];
    const str = (v: unknown) => (v == null ? "" : String(v));
    return {
      dryRun: d.dryRun !== false,
      rows: rows.map((x) => { const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>; return { account_id: str(r.account_id), month: str(r.month), campaign: str(r.campaign), valid_leads: str(r.valid_leads), closed_customers: str(r.closed_customers), revenue: str(r.revenue), note: str(r.note) } satisfies ImportRowIn; }),
    };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<ImportResult> => {
    const ctx = context.access;
    await assertStaff(ctx);
    const { actorLabel } = await import("./permissions.server");
    const editable = (await import("./plan-access.server")).planEditor(ctx);
    const o = await import("./outcomes.server.ts");
    const vis = await visibleClients(ctx);
    // Resolver over visible accounts only (an unseen account resolves to "unknown", never leaks existence).
    const key = new Map<string, (typeof vis)[number]>();
    for (const c of vis) {
      key.set(c.client_id.toLowerCase(), c);
      if (c.platform === "facebook") { const n = c.client_id.replace(/^fb_/, ""); key.set(n, c); key.set(`act_${n}`, c); }
      else if (c.platform === "openai") { const n = c.client_id.replace(/^oa_/, ""); key.set(n, c); key.set(`adacct_${n}`, c); }
      else { const dg = c.customer_id_dashed.replace(/\D/g, ""); if (dg.length === 10) key.set(dg, c); }
    }
    const resolve = (raw: string) => {
      const t = raw.trim().toLowerCase();
      return key.get(t) || key.get(t.replace(/\D/g, "")) || null;
    };
    const parsed = data.rows.map((r, i) => {
      const errors: string[] = [];
      const c = r.account_id.trim() ? resolve(r.account_id) : null;
      if (!r.account_id.trim()) errors.push("Thiếu account_id");
      else if (!c) errors.push("Không tìm thấy tài khoản (hoặc bạn không có quyền)");
      else if (!editable(c.client_id)) errors.push("Bạn không có quyền nhập cho tài khoản này");
      let month = r.month.trim().replace(/\//g, "-");
      const mm = /^(\d{1,2})-(\d{4})$/.exec(month);
      if (mm) month = `${mm[2]}-${mm[1].padStart(2, "0")}`;
      if (!MONTH.test(month)) errors.push("Tháng sai định dạng (YYYY-MM)");
      const v = parseNum(r.valid_leads), cl = parseNum(r.closed_customers), rev = parseNum(r.revenue);
      if (v === "bad") errors.push("valid_leads không phải số");
      if (cl === "bad") errors.push("closed_customers không phải số");
      if (rev === "bad") errors.push("revenue không phải số");
      if (v == null && cl == null && rev == null && !errors.some((e) => e.includes("số"))) errors.push("Không có số liệu");
      return { line: i + 2, c, month, campaign: (r.campaign || "").trim().slice(0, 200), v, cl, rev, note: r.note.trim().slice(0, 1000) || null, errors };
    });
    // Duplicate keys inside the file.
    const seen = new Map<string, number>();
    for (const p of parsed) {
      if (!p.c || p.errors.length) continue;
      const k = `${p.c.client_id}|${p.month}|${p.campaign}`;
      if (seen.has(k)) p.errors.push(`Trùng với dòng ${seen.get(k)}`); else seen.set(k, p.line);
    }
    const ok = parsed.filter((p) => !p.errors.length);
    const exist = await o.existingKeys(ok.map((p) => ({ client_id: p.c!.client_id, month: p.month, campaign: p.campaign })));
    const by = actorLabel(ctx.real);
    let inserted = 0, updated = 0;
    const rows: ImportRowResult[] = [];
    for (const p of parsed) {
      let action: ImportRowResult["action"] = null;
      if (!p.errors.length) {
        action = exist.has(`${p.c!.client_id}|${p.month}|${p.campaign}`) ? "update" : "insert";
        if (!data.dryRun && !ctx.readOnly) action = await o.upsertOutcome({ client_id: p.c!.client_id, month: p.month, campaign: p.campaign, valid_leads: p.v as number | null, closed_customers: p.cl as number | null, revenue: p.rev as number | null, note: p.note }, by);
        if (action === "insert") inserted++; else updated++;
      }
      rows.push({ line: p.line, client_id: p.c?.client_id ?? null, label: p.c ? labelOf(p.c) : null, month: p.month, campaign: p.campaign, errors: p.errors, action });
    }
    return { dry_run: data.dryRun, rows, inserted, updated, rejected: parsed.length - ok.length };
  });
