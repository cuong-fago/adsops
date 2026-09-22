import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { AccessRole, AccessSnap, MemberRow, WorkspaceDirectory, WorkspacePack, WorkspaceScene } from "./access.types.ts";

export type {
  AccessClient,
  AccessRole,
  AccessSnap,
  MemberRow,
  MccRosterSnap,
  WorkspaceDirectory,
  WorkspacePack,
  WorkspaceScene,
} from "./access.types.ts";

const WORKSPACE_MODULE_ALLOW = new Set([
  "report",
  "alerts",
  "guard",
  "hub",
  "proposals",
  "classify",
  "final",
  "connect",
  "sop",
  "analytics",
  "pace",
  "compare",
]);

function asClientId(data: unknown): { clientId: string } {
  const clientId =
    data && typeof data === "object" && typeof (data as { clientId?: unknown }).clientId === "string"
      ? String((data as { clientId: string }).clientId).trim()
      : "";
  if (!clientId) throw new Error("Thiếu khách");
  return { clientId };
}

function asWorkspacePackRequest(data: unknown): { clientId: string; modules?: string[] } {
  const { clientId } = asClientId(data);
  const raw =
    data && typeof data === "object" && Array.isArray((data as { modules?: unknown }).modules)
      ? ((data as { modules: unknown[] }).modules)
      : null;
  if (!raw || !raw.length) return { clientId };
  const modules = [
    ...new Set(
      raw
        .filter((m): m is string => typeof m === "string")
        .map((m) => m.trim())
        .filter((m) => WORKSPACE_MODULE_ALLOW.has(m)),
    ),
  ];
  return modules.length ? { clientId, modules } : { clientId };
}

export const getMyAccess = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { loadAccess } = await import("./access.server.ts");
    return loadAccess(context.userId) as Promise<AccessSnap>;
  });

export const getWorkspaceDirectory = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { loadWorkspaceDirectory } = await import("./access.server.ts");
    return loadWorkspaceDirectory(context.userId) as Promise<WorkspaceDirectory>;
  });

export const getWorkspacePack = createServerFn({ method: "POST" })
  .validator(asWorkspacePackRequest)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { loadWorkspacePack } = await import("./access.server.ts");
    return loadWorkspacePack(context.userId, data.clientId, data.modules) as Promise<WorkspacePack>;
  });

export const getWorkspaceScene = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("Thiếu dữ liệu");
    const d = data as { clientId?: unknown; scenario?: unknown };
    const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
    const scenario = typeof d.scenario === "string" ? d.scenario.trim() : "";
    if (!clientId) throw new Error("Thiếu khách");
    return { clientId, scenario };
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { loadWorkspaceScene } = await import("./access.server.ts");
    return loadWorkspaceScene(context.userId, data.clientId, data.scenario) as Promise<WorkspaceScene>;
  });

export const listAccessMembers = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listMembers } = await import("./access.server.ts");
    return listMembers(context.userId) as Promise<MemberRow[]>;
  });

export const grantAccessMember = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("Thiếu dữ liệu");
    const d = data as Record<string, unknown>;
    const email = typeof d.email === "string" ? d.email.trim() : "";
    const role = d.role === "ops" || d.role === "sale" || d.role === "client" ? d.role : "";
    const clientIds = Array.isArray(d.clientIds)
      ? d.clientIds.filter((id): id is string => typeof id === "string")
      : [];
    if (!email || !role) throw new Error("Thiếu email hoặc vai trò.");
    return { email, role: role as AccessRole, clientIds };
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { grantAccess } = await import("./access.server.ts");
    return grantAccess(context.userId, data) as Promise<MemberRow[]>;
  });

export const revokeAccessMember = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const id =
      data && typeof data === "object" && typeof (data as { id?: unknown }).id === "string"
        ? String((data as { id: string }).id).trim()
        : "";
    if (!id) throw new Error("Thiếu quyền.");
    return { id };
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { revokeAccess } = await import("./access.server.ts");
    return revokeAccess(context.userId, data.id) as Promise<MemberRow[]>;
  });
