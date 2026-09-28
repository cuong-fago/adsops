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

function asDeepChunk(data: unknown): { clientId: string; targetStart?: string; refreshRecent?: boolean } {
  if (!data || typeof data !== "object") throw new Error("Thiếu khách");
  const d = data as { clientId?: unknown; targetStart?: unknown; refreshRecent?: unknown };
  const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
  if (!clientId) throw new Error("Thiếu khách");
  const targetStart = typeof d.targetStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.targetStart) ? d.targetStart : undefined;
  return { clientId, targetStart, refreshRecent: d.refreshRecent === true };
}

function asDeepLayerRead(data: unknown): {
  clientId: string;
  layer: "ad_group" | "keyword" | "search_term";
  start: string;
  end: string;
  campaignId?: string | null;
  adGroupId?: string | null;
  onlyWithConv?: boolean;
} {
  if (!data || typeof data !== "object") throw new Error("Thiếu dữ liệu");
  const d = data as Record<string, unknown>;
  const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
  const layer = d.layer === "ad_group" || d.layer === "keyword" || d.layer === "search_term" ? d.layer : null;
  const start = typeof d.start === "string" ? d.start : "";
  const end = typeof d.end === "string" ? d.end : "";
  if (!clientId || !layer || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error("Thiếu khách / lớp / ngày");
  }
  return {
    clientId,
    layer,
    start,
    end,
    campaignId: typeof d.campaignId === "string" ? d.campaignId : null,
    adGroupId: typeof d.adGroupId === "string" ? d.adGroupId : null,
    onlyWithConv: d.onlyWithConv === true,
  };
}

/** Month-by-month ad group / keyword / search term pull: admin, head_ads, optimizer. */
export const pullDeepChunkFn = createServerFn({ method: "POST" })
  .validator(asDeepChunk)
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { assertCap, assertWritable, assertAccount } = await import("./permissions.server");
    const ctx = context.access;
    assertCap(ctx, "pull", "Chỉ admin / trưởng phòng Ads / người tối ưu được kéo số.");
    assertWritable(ctx);
    assertAccount(ctx, data.clientId);
    const { pullDeepChunk } = await import("./deep-store.server.ts");
    return pullDeepChunk(data.clientId, { targetStart: data.targetStart, refreshRecent: data.refreshRecent });
  });

/** Read aggregated deep layer for the selected range (any role with analytics). */
export const readDeepLayerFn = createServerFn({ method: "POST" })
  .validator(asDeepLayerRead)
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { assertCap, assertAccount } = await import("./permissions.server");
    const ctx = context.access;
    assertCap(ctx, "analytics", "Không có quyền xem Phân tích.");
    assertAccount(ctx, data.clientId);
    const { readDeepLayer } = await import("./deep-store.server.ts");
    return readDeepLayer(data.clientId, data.layer, {
      start: data.start,
      end: data.end,
      campaignId: data.campaignId,
      adGroupId: data.adGroupId,
      onlyWithConv: data.onlyWithConv,
    });
  });
