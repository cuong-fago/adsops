import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";

/** Admin-only Google Ads connection card (tab "Phân quyền"). Read-only toward Google Ads. */

export type GoogleAdsStatus = {
  ready: boolean;
  missing: { id: string; label_vi: string }[];
  notes: string[];
  client_source: string | null;
  refresh_source: string | null;
  login_customer_id_dashed: string;
  login_source: string;
  developer_token_set: boolean;
  google_email: string | null;
  connected_at: string | null;
  connected_by: string | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_message: string | null;
  redirect_uri: string;
  api_version: string | null;
  encryption_ready: boolean;
};

export type GoogleAdsTestResult = {
  ok: boolean;
  message_vi: string;
  api_version?: string | null;
  accessible?: string[];
  accounts?: {
    customer_id_dashed: string;
    name: string;
    status: string;
    manager: boolean;
    test_account: boolean;
    level: number;
  }[];
};

async function currentRequest(): Promise<Request | undefined> {
  const { getRequest } = await import("@tanstack/react-start/server");
  return getRequest() ?? undefined;
}

export const getGoogleAdsStatus = createServerFn({ method: "GET" })
  .middleware([principalMiddleware])
  .handler(async ({ context }): Promise<GoogleAdsStatus> => {
    const { assertRealAdmin } = await import("./permissions.server");
    assertRealAdmin(context.access);
    const g = await import("./google-ads.server.ts");
    const cfg = await g.resolveAdsConfig();
    return g.publicStatus(cfg, g.redirectUriFor(await currentRequest())) as GoogleAdsStatus;
  });

export const testGoogleAdsConnection = createServerFn({ method: "POST" })
  .middleware([principalMiddleware])
  .handler(async ({ context }): Promise<GoogleAdsTestResult> => {
    const { assertRealAdmin } = await import("./permissions.server");
    assertRealAdmin(context.access);
    const g = await import("./google-ads.server.ts");
    const cfg = await g.resolveAdsConfig();
    if (!cfg.ready) {
      return { ok: false, message_vi: `Chưa đủ cấu hình. Thiếu: ${cfg.missing.map((m) => m.label_vi).join(" ")}` };
    }
    try {
      const accessible = await g.listAccessibleCustomers(cfg);
      const children = await g.listMccChildren(cfg);
      const accounts = children.map((c) => ({
        customer_id_dashed: c.customer_id_dashed,
        name: c.name,
        status: c.status,
        manager: c.manager,
        test_account: c.test_account,
        level: c.level,
      }));
      const nonManager = accounts.filter((a) => !a.manager).length;
      const msg = `Kết nối OK (API ${g.currentApiVersion() || "?"}): tài khoản Google đăng nhập truy cập trực tiếp ${accessible.length} tài khoản; MCC ${g.dashedId(cfg.loginCustomerId)} có ${nonManager} tài khoản quảng cáo.`;
      await g.recordTestResult(true, msg);
      return { ok: true, message_vi: msg, api_version: g.currentApiVersion(), accessible: accessible.map(g.dashedId), accounts };
    } catch (err) {
      const msg =
        err instanceof g.AdsApiError ? err.adminMessage : "Lỗi không xác định khi gọi Google Ads API (xem log server [google-ads]).";
      if (!(err instanceof g.AdsApiError)) {
        console.error(`[google-ads] test connection failed: ${err instanceof Error ? err.message.slice(0, 300) : "unknown"}`);
      }
      await g.recordTestResult(false, msg);
      return { ok: false, message_vi: msg };
    }
  });

export const disconnectGoogleAds = createServerFn({ method: "POST" })
  .middleware([principalMiddleware])
  .handler(async ({ context }) => {
    const p = await import("./permissions.server");
    p.assertRealAdmin(context.access);
    p.assertWritable(context.access);
    const g = await import("./google-ads.server.ts");
    await g.deleteStoredCredential();
    await p.audit(p.actorLabel(context.access.real), "google_ads.disconnect", "google_ads", "credential", {});
    return { ok: true };
  });
