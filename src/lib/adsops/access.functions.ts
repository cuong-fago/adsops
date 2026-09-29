import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import type { AccessSnap, WorkspaceDirectory, WorkspacePack, WorkspaceScene } from "./access.types.ts";

export type {
  AccessClient,
  AccessRole,
  AccessSnap,
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
      ? (data as { modules: unknown[] }).modules
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
  .middleware([principalMiddleware])
  .handler(async ({ context }) => {
    const { loadAccess } = await import("./access.server.ts");
    return loadAccess(context.access) as Promise<AccessSnap>;
  });

export const getWorkspaceDirectory = createServerFn({ method: "GET" })
  .middleware([principalMiddleware])
  .handler(async ({ context }) => {
    const { loadWorkspaceDirectory } = await import("./access.server.ts");
    const dir = (await loadWorkspaceDirectory(context.access)) as WorkspaceDirectory;
    const { withPulledMccClients } = await import("./mcc-import.server.ts");
    return withPulledMccClients(dir, context.access.allowed);
  });

export const getWorkspacePack = createServerFn({ method: "POST" })
  .validator(asWorkspacePackRequest)
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { loadWorkspacePack } = await import("./access.server.ts");
    return loadWorkspacePack(context.access, data.clientId, data.modules) as Promise<WorkspacePack>;
  });

export const setMyLanguage = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const lang = data && typeof data === "object" ? (data as { lang?: unknown }).lang : null;
    if (lang !== "vi" && lang !== "en") throw new Error("Ngôn ngữ không hợp lệ");
    return { lang: lang as "vi" | "en" };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    // Viewing-as is read-only: never write the impersonated user's prefs.
    if (context.access.readOnly || context.access.principal.role === "pending") return { ok: false as const };
    const { saveLangPref } = await import("./access.server.ts");
    await saveLangPref(context.access, data.lang);
    return { ok: true as const };
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
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { loadWorkspaceScene } = await import("./access.server.ts");
    return loadWorkspaceScene(context.access, data.clientId, data.scenario) as Promise<WorkspaceScene>;
  });
