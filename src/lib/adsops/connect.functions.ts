import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { InstallAndProbeResult, PullKpisResult } from "./connect.types.ts";

export type { ConnectPublic, InstallAndProbeResult, InstallMeta, PullKpisResult } from "./connect.types.ts";

type Intake = {
  clientId: string;
  yamlText: string;
  developerToken: string;
  oauthClientId: string;
  oauthClientSecret: string;
  refreshToken: string;
  save: boolean;
};

function asIntake(data: unknown): Intake {
  if (!data || typeof data !== "object") {
    throw new Error("Thiếu dữ liệu");
  }
  const d = data as Record<string, unknown>;
  const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
  if (!clientId) throw new Error("Thiếu khách");
  return {
    clientId,
    yamlText: typeof d.yamlText === "string" ? d.yamlText : "",
    developerToken: typeof d.developerToken === "string" ? d.developerToken : "",
    oauthClientId: typeof d.oauthClientId === "string" ? d.oauthClientId : "",
    oauthClientSecret: typeof d.oauthClientSecret === "string" ? d.oauthClientSecret : "",
    refreshToken: typeof d.refreshToken === "string" ? d.refreshToken : "",
    save: d.save === true,
  };
}

function asClientId(data: unknown): { clientId: string } {
  if (!data || typeof data !== "object") {
    throw new Error("Thiếu khách");
  }
  const clientId = typeof (data as { clientId?: unknown }).clientId === "string"
    ? String((data as { clientId: string }).clientId).trim()
    : "";
  if (!clientId) throw new Error("Thiếu khách");
  return { clientId };
}

export const saveYamlAndProbe = createServerFn({ method: "POST" })
  .validator(asIntake)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { assertOps } = await import("./access.server.ts");
    await assertOps(context.userId);
    const { installAndProbe } = await import("./connect.server.ts");
    return installAndProbe({
      clientId: data.clientId,
      yamlText: data.yamlText,
      pieces: {
        developer_token: data.developerToken,
        oauth_client_id: data.oauthClientId,
        oauth_client_secret: data.oauthClientSecret,
        refresh_token: data.refreshToken,
      },
      save: data.save,
    });
  });

export const pullClientKpis = createServerFn({ method: "POST" })
  .validator(asClientId)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { assertOps } = await import("./access.server.ts");
    await assertOps(context.userId);
    const { pullKpis } = await import("./connect.server.ts");
    return pullKpis(data.clientId) as Promise<PullKpisResult>;
  });
