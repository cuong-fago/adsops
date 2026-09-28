import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import type { AdminDirectory, AuditRow, PrincipalKind, RequestDirectory } from "./permissions.types.ts";

type Obj = Record<string, unknown>;

function obj(data: unknown): Obj {
  if (!data || typeof data !== "object") throw new Error("Thiếu dữ liệu");
  return data as Obj;
}
function str(d: Obj, k: string, required = true): string {
  const v = typeof d[k] === "string" ? String(d[k]).trim() : "";
  if (required && !v) throw new Error(`Thiếu ${k}`);
  return v;
}
function optStr(d: Obj, k: string): string | null | undefined {
  if (!(k in d)) return undefined;
  const v = d[k];
  if (v === null) return null;
  return typeof v === "string" ? v : undefined;
}
function strArr(d: Obj, k: string): string[] {
  return Array.isArray(d[k]) ? (d[k] as unknown[]).filter((x): x is string => typeof x === "string") : [];
}
function kind(d: Obj): PrincipalKind {
  const v = d.kind;
  if (v !== "staff" && v !== "client") throw new Error("Sai loại người dùng");
  return v;
}

const srv = () => import("./admin.server.ts");

export const getAdminDirectory = createServerFn({ method: "GET" })
  .middleware([principalMiddleware])
  .handler(async ({ context }) => (await srv()).adminDirectory(context.access) as Promise<AdminDirectory>);

export const adminUpsertStaff = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = obj(data);
    return { email: str(d, "email"), role: str(d, "role"), display_name: optStr(d, "display_name") ?? null };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    await (await srv()).upsertStaff(context.access, data);
    return { ok: true };
  });

export const adminRemoveStaff = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ id: str(obj(data), "id") }))
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    await (await srv()).removeStaff(context.access, data.id);
    return { ok: true };
  });

export const adminCreateClientUser = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = obj(data);
    return {
      username: str(d, "username"),
      password: typeof d.password === "string" ? d.password : "",
      display_name: optStr(d, "display_name") ?? null,
      email: optStr(d, "email") ?? null,
      role: str(d, "role", false) || "client_staff",
      customer_id: optStr(d, "customer_id") ?? null,
      accountIds: strArr(d, "accountIds"),
    };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const s = await srv();
    const { id } = await s.createClientUser(context.access, data);
    if (data.accountIds.length) await s.setGrants(context.access, { kind: "client", id, accountIds: data.accountIds });
    return { ok: true, id };
  });

export const adminUpdateClientUser = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = obj(data);
    return {
      id: str(d, "id"),
      role: str(d, "role", false) || undefined,
      display_name: optStr(d, "display_name"),
      email: optStr(d, "email"),
      customer_id: optStr(d, "customer_id"),
    };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    await (await srv()).updateClientUser(context.access, data);
    return { ok: true };
  });

export const adminResetClientPassword = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = obj(data);
    return { id: str(d, "id"), password: typeof d.password === "string" ? d.password : "" };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    await (await srv()).resetClientPassword(context.access, data.id, data.password);
    return { ok: true };
  });

export const adminRevokeClientSessions = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ id: str(obj(data), "id") }))
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => ({ ok: true, ended: await (await srv()).revokeClientSessions(context.access, data.id) }));

export const adminDeleteClientUser = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ id: str(obj(data), "id") }))
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    await (await srv()).deleteClientUser(context.access, data.id);
    return { ok: true };
  });

export const adminSetGrants = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = obj(data);
    return { kind: kind(d), id: str(d, "id"), accountIds: strArr(d, "accountIds") };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => (await srv()).setGrants(context.access, data));

export const adminUpsertCustomer = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = obj(data);
    return { id: str(d, "id", false) || null, name: str(d, "name"), note: optStr(d, "note") ?? null };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => (await srv()).upsertCustomer(context.access, data));

export const adminDeleteCustomer = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ id: str(obj(data), "id") }))
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    await (await srv()).deleteCustomer(context.access, data.id);
    return { ok: true };
  });

export const adminUpdateAdAccount = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = obj(data);
    return { id: str(d, "id"), customer_id: optStr(d, "customer_id"), sale_staff_id: optStr(d, "sale_staff_id") };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    await (await srv()).updateAdAccount(context.access, data);
    return { ok: true };
  });

export const adminDecideRequest = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = obj(data);
    return { id: str(d, "id"), approve: d.approve === true, note: optStr(d, "note") ?? null };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    await (await srv()).decideRequest(context.access, data);
    return { ok: true };
  });

export const getAuditLog = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data && typeof data === "object" ? (data as Obj) : {};
    const limit = typeof d.limit === "number" ? d.limit : 200;
    const beforeId = typeof d.beforeId === "number" ? d.beforeId : undefined;
    return { limit, beforeId };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => (await srv()).auditLog(context.access, data.limit, data.beforeId) as Promise<AuditRow[]>);

/** "Xem như người dùng này": admin only, read-only, audited. */
export const adminStartViewAs = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = obj(data);
    return { kind: kind(d), id: str(d, "id") };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const p = await import("./permissions.server.ts");
    const ctx = context.access;
    p.assertRealAdmin(ctx);
    if (!ctx.real.userId) throw new p.ForbiddenError("Thiếu phiên admin.");
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows =
      data.kind === "client"
        ? await sql<{ label: string }>`select username as label from client_users where id = ${data.id} limit 1`
        : await sql<{ label: string }>`select email as label from staff_users where id = ${data.id} limit 1`;
    if (!rows.length) throw new Error("Không tìm thấy người dùng.");
    const { setCookie } = await import("@tanstack/react-start/server");
    setCookie(p.VIEW_AS_COOKIE, p.signViewAs(ctx.real.userId, data.kind, data.id), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: p.VIEW_AS_COOKIE_MAX_AGE_S,
    });
    await p.audit(p.actorLabel(ctx.real), "view_as.start", data.kind, data.id, { target: rows[0].label });
    return { ok: true };
  });

export const stopViewAs = createServerFn({ method: "POST" })
  .middleware([principalMiddleware])
  .handler(async ({ context }) => {
    const p = await import("./permissions.server.ts");
    const ctx = context.access;
    const { deleteCookie } = await import("@tanstack/react-start/server");
    deleteCookie(p.VIEW_AS_COOKIE, { path: "/", secure: true, httpOnly: true, sameSite: "lax" });
    if (ctx.viewAs) {
      await p.audit(p.actorLabel(ctx.real), "view_as.stop", ctx.viewAs.kind, ctx.viewAs.id, { target: ctx.viewAs.label });
    }
    return { ok: true };
  });

// ── sale / head_ads: two-step grant requests ────────────────────────────────────────

export const getRequestDirectory = createServerFn({ method: "GET" })
  .middleware([principalMiddleware])
  .handler(async ({ context }) => (await srv()).requestDirectory(context.access) as Promise<RequestDirectory>);

export const submitGrantRequestFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = obj(data);
    return { clientUserId: str(d, "clientUserId"), accountIds: strArr(d, "accountIds"), note: optStr(d, "note") ?? null };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => (await srv()).submitGrantRequest(context.access, data));

export const cancelGrantRequestFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ id: str(obj(data), "id") }))
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    await (await srv()).cancelGrantRequest(context.access, data.id);
    return { ok: true };
  });
