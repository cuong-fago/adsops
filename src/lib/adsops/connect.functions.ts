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
    const { assertEffectiveAdmin, assertWritable, assertAccount } = await import("./permissions.server");
    const ctx = context.access;
    assertEffectiveAdmin(ctx);
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

function asAutoFill(data: unknown): { clientId: string; start: string; end: string; retry: boolean } {
  if (!data || typeof data !== "object") throw new Error("Thiếu dữ liệu");
  const d = data as Record<string, unknown>;
  const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
  const start = typeof d.start === "string" ? d.start : "";
  const end = typeof d.end === "string" ? d.end : "";
  if (!clientId || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) {
    throw new Error("Thiếu khách / ngày");
  }
  return { clientId, start, end, retry: d.retry === true };
}

/**
 * Read-only cache fill of the deep layers for the range being viewed. Any role that may
 * see Phân tích for THIS account (staff or customer); no pull capability needed and it is
 * allowed during view-as (it writes only AdsOps' own cache). Explicit pull buttons keep
 * their own rules (pullDeepChunkFn: pull capability, not in view-as).
 */
export const autoFillDeepFn = createServerFn({ method: "POST" })
  .validator(asAutoFill)
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { assertCap, assertAccount } = await import("./permissions.server");
    const ctx = context.access;
    assertCap(ctx, "analytics", "Không có quyền xem Phân tích.");
    assertAccount(ctx, data.clientId);
    const { autoFillDeep } = await import("./deep-store.server.ts");
    const r = await autoFillDeep(data.clientId, { start: data.start, end: data.end, retry: data.retry });
    // Customers never see Google Ads error details.
    return ctx.principal.kind === "client" ? { ...r, error_vi: null } : r;
  });

function asWarehouseFill(data: unknown): { clientId: string; start: string } {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
  const start = typeof d.start === "string" ? d.start : "";
  if (!clientId || !/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error("Thiếu khách / ngày");
  return { clientId, start };
}

/**
 * "So kỳ trước" (staff only: client roles never get previous-period data): extend the
 * account + campaign warehouse back to the previous period's start. Read-only cache fill;
 * any staff role with this account, view-as included; no pull capability needed.
 */
export const autoFillWarehouseFn = createServerFn({ method: "POST" })
  .validator(asWarehouseFill)
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { assertCap, assertAccount, ForbiddenError } = await import("./permissions.server");
    const ctx = context.access;
    if (ctx.principal.kind !== "staff") throw new ForbiddenError("Không có so sánh kỳ trước cho vai trò này.");
    assertCap(ctx, "compare", "Không có so sánh kỳ trước cho vai trò này.");
    assertAccount(ctx, data.clientId);
    const { autoFillWarehouseRange } = await import("./warehouse.server.ts");
    return autoFillWarehouseRange(data.clientId, data.start);
  });

/**
 * Per-conversion-action breakdown for the Google Phân tích tables (campaign / ad group / keyword).
 * Same visibility as the Conv column (analytics cap + account grant). Previous period: staff only.
 * Missing days are fetched read-only on demand (one GAQL round, per-account lock).
 */
export const readConvActionsFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const ymd = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
    const layer = d.layer === "campaign" || d.layer === "ad_group" || d.layer === "keyword" ? (d.layer as "campaign" | "ad_group" | "keyword") : null;
    const start = ymd(d.start), end = ymd(d.end);
    if (!clientId || !layer || !start || !end || end < start) throw new Error("Thiếu khách / lớp / ngày");
    const prevStart = ymd(d.prevStart), prevEnd = ymd(d.prevEnd);
    const id = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? v : null);
    return { clientId, layer, start, end, prevStart, prevEnd: prevStart && prevEnd && prevEnd >= prevStart ? prevEnd : null, campaignId: id(d.campaignId), adGroupId: id(d.adGroupId) };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { assertCap, assertAccount } = await import("./permissions.server");
    const ctx = context.access;
    assertCap(ctx, "analytics", "Không có quyền xem Phân tích.");
    assertAccount(ctx, data.clientId);
    const staffPrev = ctx.principal.kind === "staff" && ctx.caps.compare && data.prevStart && data.prevEnd;
    const m = await import("./google-conv-actions.server.ts");
    const from = staffPrev && data.prevStart! < data.start ? data.prevStart! : data.start;
    await m.ensureConvActions(data.clientId, from, data.end).catch(() => null);
    return m.readConvActions(data.clientId, data.layer, {
      start: data.start,
      end: data.end,
      campaignId: data.campaignId,
      adGroupId: data.adGroupId,
      prevStart: staffPrev ? data.prevStart : null,
      prevEnd: staffPrev ? data.prevEnd : null,
    });
  });

/**
 * Google impression-share metrics (range aggregate, cached per range) for the Phân tích tables.
 * Same visibility as readConvActionsFn. Previous period: staff only. Read-only GAQL.
 */
export const readSharesFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const ymd = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
    const layer = d.layer === "campaign" || d.layer === "ad_group" || d.layer === "keyword" ? (d.layer as "campaign" | "ad_group" | "keyword") : null;
    const start = ymd(d.start), end = ymd(d.end);
    if (!clientId || !layer || !start || !end || end < start) throw new Error("Thiếu khách / lớp / ngày");
    const prevStart = ymd(d.prevStart), prevEnd = ymd(d.prevEnd);
    return { clientId, layer, start, end, prevStart, prevEnd: prevStart && prevEnd && prevEnd >= prevStart ? prevEnd : null };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { assertCap, assertAccount } = await import("./permissions.server");
    const ctx = context.access;
    assertCap(ctx, "analytics", "Không có quyền xem Phân tích.");
    assertAccount(ctx, data.clientId);
    const staffPrev = ctx.principal.kind === "staff" && ctx.caps.compare && data.prevStart && data.prevEnd;
    const m = await import("./google-share.server.ts");
    return m.readShares(data.clientId, data.layer, {
      start: data.start,
      end: data.end,
      prevStart: staffPrev ? data.prevStart : null,
      prevEnd: staffPrev ? data.prevEnd : null,
    });
  });

function qsInput(data: unknown) {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const ymd = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
  const start = ymd(d.start), end = ymd(d.end);
  if (!clientId || !start || !end || end < start) throw new Error("Thiếu khách / ngày");
  const prevStart = ymd(d.prevStart), prevEnd = ymd(d.prevEnd);
  return { clientId, start, end, prevStart, prevEnd: prevStart && prevEnd && prevEnd >= prevStart ? prevEnd : null };
}

/** Keyword Quality Score (latest daily snapshot; snapshots today on demand). Same visibility as Phân tích. */
export const readQsFn = createServerFn({ method: "POST" })
  .validator(qsInput)
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { assertCap, assertAccount } = await import("./permissions.server");
    const ctx = context.access;
    assertCap(ctx, "analytics", "Không có quyền xem Phân tích.");
    assertAccount(ctx, data.clientId);
    const m = await import("./google-qs.server.ts");
    await m.ensureQs(data.clientId).catch(() => null);
    return m.readQs(data.clientId, data.start, data.end);
  });

/** Wasted search-term spend (range aggregate, cached per range). Previous period: staff only. */
export const readWasteFn = createServerFn({ method: "POST" })
  .validator(qsInput)
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { assertCap, assertAccount } = await import("./permissions.server");
    const ctx = context.access;
    assertCap(ctx, "analytics", "Không có quyền xem Phân tích.");
    assertAccount(ctx, data.clientId);
    const staffPrev = ctx.principal.kind === "staff" && ctx.caps.compare && data.prevStart && data.prevEnd;
    const m = await import("./google-qs.server.ts");
    return m.readWaste(data.clientId, data.start, data.end, staffPrev ? { start: data.prevStart!, end: data.prevEnd! } : null);
  });

function bdInput(data: unknown) {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const ymd = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
  const start = ymd(d.start), end = ymd(d.end);
  if (!clientId || !start || !end || end < start) throw new Error("Thiếu khách / ngày");
  const campaignId = typeof d.campaignId === "string" && /^\d+$/.test(d.campaignId) ? d.campaignId : null;
  return { clientId, start, end, campaignId };
}

/** Device / hour / weekday / geo breakdown (range aggregate, cached per range + campaign). Same visibility as Phân tích. */
export const readBreakdownFn = createServerFn({ method: "POST" })
  .validator(bdInput)
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { assertCap, assertAccount } = await import("./permissions.server");
    const ctx = context.access;
    assertCap(ctx, "analytics", "Không có quyền xem Phân tích.");
    assertAccount(ctx, data.clientId);
    const m = await import("./google-breakdown.server.ts");
    return m.readBreakdown(data.clientId, data.start, data.end, data.campaignId);
  });

/** Call details from call_view (area code only) + phone-call conversions. Same visibility as Phân tích. */
export const readCallsFn = createServerFn({ method: "POST" })
  .validator(bdInput)
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { assertCap, assertAccount } = await import("./permissions.server");
    const ctx = context.access;
    assertCap(ctx, "analytics", "Không có quyền xem Phân tích.");
    assertAccount(ctx, data.clientId);
    const m = await import("./google-breakdown.server.ts");
    return m.readCalls(data.clientId, data.start, data.end, data.campaignId);
  });

/** "Xu hướng 3 tháng" for one Google account. Staff only (never client roles). Read-only GAQL, cached 6 h. */
export const readGoogleTrendFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
    if (!/^[a-z0-9_]+$/.test(clientId) || clientId.startsWith("fb_") || clientId.startsWith("oa_")) throw new Error("Tài khoản Google không hợp lệ");
    return { clientId };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { assertAccount, ForbiddenError } = await import("./permissions.server");
    const ctx = context.access;
    if (ctx.principal.kind !== "staff" || ctx.principal.role === "pending") throw new ForbiddenError("Chỉ nhân sự.");
    assertAccount(ctx, data.clientId);
    return (await import("./google-trend.server.ts")).readTrend(data.clientId);
  });

const trendIdOk = (s: string) => /^[a-z0-9_]+$/.test(s) && !s.startsWith("fb_") && !s.startsWith("oa_");
async function assertTrendStaff(ctx: Parameters<typeof import("./permissions.server").assertAccount>[0], clientId: string) {
  const { assertAccount, ForbiddenError } = await import("./permissions.server");
  if (ctx.principal.kind !== "staff" || ctx.principal.role === "pending") throw new ForbiddenError("Chỉ nhân sự.");
  assertAccount(ctx, clientId);
}

/** Trend by Loại chiến dịch → Chiến dịch (Google, staff only, read-only GAQL, cached 6 h). */
export const readGoogleTrendTreeFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
    if (!trendIdOk(clientId)) throw new Error("Tài khoản Google không hợp lệ");
    return { clientId };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    await assertTrendStaff(context.access, data.clientId);
    return (await import("./google-trend-tree.server.ts")).readTrendTree(data.clientId);
  });

/** Lazy ad groups / asset groups (PMax) of one campaign for the trend table. Staff only. */
export const readGoogleTrendChildrenFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
    const campaignId = typeof d.campaignId === "string" ? d.campaignId.trim() : "";
    if (!trendIdOk(clientId)) throw new Error("Tài khoản Google không hợp lệ");
    if (!/^\d{1,20}$/.test(campaignId)) throw new Error("Chiến dịch không hợp lệ");
    return { clientId, campaignId, pmax: d.pmax === true };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    await assertTrendStaff(context.access, data.clientId);
    return (await import("./google-trend-tree.server.ts")).readTrendChildren(data.clientId, data.campaignId, data.pmax);
  });

/** Conversion actions of a Google account with standard group (auto + manual override). Staff only; edit flag for Admin / Trưởng phòng Ads. */
export const readConvGroupsFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
    if (!trendIdOk(clientId)) throw new Error("Tài khoản Google không hợp lệ");
    return { clientId };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const ctx = context.access;
    await assertTrendStaff(ctx, data.clientId);
    const canEdit = (ctx.principal.role === "admin" || ctx.principal.role === "head_ads") && !ctx.readOnly;
    return (await import("./google-conv-groups.server.ts")).readConvActions(data.clientId, canEdit);
  });

/** Set / clear the manual conversion group (AdsOps DB only; never written to Google). Admin / Trưởng phòng Ads only. */
export const setConvGroupFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
    const actionId = typeof d.actionId === "string" ? d.actionId.trim() : "";
    const g = d.group;
    if (!trendIdOk(clientId)) throw new Error("Tài khoản Google không hợp lệ");
    if (!/^\d{1,20}$/.test(actionId)) throw new Error("Hành động chuyển đổi không hợp lệ");
    if (g !== null && !["call", "zalo", "messenger", "form", "purchase", "other"].includes(String(g))) throw new Error("Nhóm không hợp lệ");
    return { clientId, actionId, group: g as import("./google-conv-groups.ts").ConvGroup | null };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { ForbiddenError, actorLabel } = await import("./permissions.server");
    const ctx = context.access;
    await assertTrendStaff(ctx, data.clientId);
    if (!(ctx.principal.role === "admin" || ctx.principal.role === "head_ads") || ctx.readOnly) throw new ForbiddenError("Chỉ Admin / Trưởng phòng Ads được sửa nhóm chuyển đổi.");
    return (await import("./google-conv-groups.server.ts")).setConvGroup(data.clientId, data.actionId, data.group, actorLabel(ctx.principal));
  });

/** Nightly "Xu hướng 3T" snapshots for every Google account this staff member can see. Staff only. */
export const readTrendSnapshotsFn = createServerFn({ method: "POST" })
  .middleware([principalMiddleware])
  .handler(async ({ context }) => {
    const { ForbiddenError, canSeeAccount } = await import("./permissions.server");
    const ctx = context.access;
    if (ctx.principal.kind !== "staff" || ctx.principal.role === "pending") throw new ForbiddenError("Chỉ nhân sự.");
    const { loadWorkspaceDirectory } = await import("./access.server");
    const { withPulledMccClients } = await import("./mcc-import.server");
    const dir = await withPulledMccClients(await loadWorkspaceDirectory(ctx), ctx.allowed);
    const ids = dir.clients.map((c) => c.client_id).filter((id) => canSeeAccount(ctx, id) && trendIdOk(id));
    return { rows: await (await import("./google-trend-snapshot.server.ts")).readSnapshots(ids) };
  });

/** "Tính lại" one account's 3T snapshot now (read-only GAQL; uses the 6 h cache). Admin only. */
export const recomputeTrendFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
    if (!trendIdOk(clientId)) throw new Error("Tài khoản Google không hợp lệ");
    return { clientId };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { ForbiddenError } = await import("./permissions.server");
    const ctx = context.access;
    await assertTrendStaff(ctx, data.clientId);
    if (ctx.principal.role !== "admin" || ctx.readOnly) throw new ForbiddenError("Chỉ Admin được tính lại.");
    return (await import("./google-trend-snapshot.server.ts")).computeSnapshot(data.clientId);
  });
