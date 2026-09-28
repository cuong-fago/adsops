import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import type { ConnectPublic, InstallAndProbeResult, PullKpisResult, PullAnalyticsWarehouseResult } from "./connect.types.ts";

export type { ConnectPublic, InstallAndProbeResult, InstallMeta, PullKpisResult, PullAnalyticsWarehouseResult } from "./connect.types.ts";

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

/** Non-admin callers never receive other MCC accounts in a probe result. */
function scopeConnect(
  connect: ConnectPublic | null | undefined,
  canSee: (id: string) => boolean,
  isAll: boolean,
): ConnectPublic | null {
  if (!connect) return null;
  if (isAll || !Array.isArray(connect.mcc_accounts)) return connect;
  const mcc_accounts = connect.mcc_accounts.filter((a) => !a.is_manager && canSee(a.client_id));
  return { ...connect, mcc_accounts, accessible_count: mcc_accounts.length };
}

/** Installing Google Ads API credentials for the MCC: admin only. */
export const saveYamlAndProbe = createServerFn({ method: "POST" })
  .validator(asIntake)
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { assertRealAdmin, assertWritable, assertAccount } = await import("./permissions.server");
    const ctx = context.access;
    assertRealAdmin(ctx);
    assertWritable(ctx);
    assertAccount(ctx, data.clientId);
    const { installAndProbe } = await import("./connect.server.ts");
    return (await installAndProbe({
      clientId: data.clientId,
      yamlText: data.yamlText,
      pieces: {
        developer_token: data.developerToken,
        oauth_client_id: data.oauthClientId,
        oauth_client_secret: data.oauthClientSecret,
        refresh_token: data.refreshToken,
      },
      save: data.save,
    })) as InstallAndProbeResult;
  });

/** Pull / refresh KPIs (read-only Google Ads pull): admin, head_ads, optimizer. */
export const pullClientKpis = createServerFn({ method: "POST" })
  .validator(asClientId)
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { assertCap, assertWritable, assertAccount, canSeeAccount } = await import("./permissions.server");
    const ctx = context.access;
    assertCap(ctx, "pull", "Chỉ admin / trưởng phòng Ads / người tối ưu được kéo số.");
    assertWritable(ctx);
    assertAccount(ctx, data.clientId);
    const { pullKpis } = await import("./connect.server.ts");
    const result = (await pullKpis(data.clientId)) as PullKpisResult;
    return {
      ...result,
      connect: scopeConnect(result.connect, (id) => canSeeAccount(ctx, id), ctx.allowed === "all"),
    } as PullKpisResult;
  });

function asWarehousePull(data: unknown): { clientId: string; lookbackDays?: number } {
  if (!data || typeof data !== "object") {
    throw new Error("Thiếu khách");
  }
  const d = data as { clientId?: unknown; lookbackDays?: unknown };
  const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
  if (!clientId) throw new Error("Thiếu khách");
  const lookbackDays =
    typeof d.lookbackDays === "number" && Number.isFinite(d.lookbackDays)
      ? d.lookbackDays
      : undefined;
  return { clientId, lookbackDays };
}

/** "Kéo kho phân tích (180 ngày)": admin, head_ads, optimizer. */
export const pullAnalyticsWarehouseFn = createServerFn({ method: "POST" })
  .validator(asWarehousePull)
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { assertCap, assertWritable, assertAccount } = await import("./permissions.server");
    const ctx = context.access;
    assertCap(ctx, "pull", "Chỉ admin / trưởng phòng Ads / người tối ưu được kéo số.");
    assertWritable(ctx);
    assertAccount(ctx, data.clientId);
    const { pullAnalyticsWarehouse } = await import("./warehouse.server.ts");
    return pullAnalyticsWarehouse(data.clientId, data.lookbackDays) as Promise<PullAnalyticsWarehouseResult>;
  });
