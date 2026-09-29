import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import { importMccAccounts } from "./mcc-import.server.ts";
import { listAllMccChildren, managerCustomerIds } from "./mcc-list.server.ts";

/** Admin-only Google Ads connection card (tab "Phân quyền"). Read-only toward Google Ads. */

export type GoogleAdsStatus = {
  ready: boolean;
  missing: { id: string; label_vi: string }[];
  notes: string[];
  client_source: string | null;
  refresh_source: string | null;
  login_customer_id_dashed: string;
  manager_customer_ids_dashed: string[];
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

export type GoogleAdsAccountRow = {
  customer_id_dashed: string;
  name: string;
  status: string;
  manager: boolean;
  test_account: boolean;
  level: number;
  mcc_id_dashed: string;
};

export type GoogleAdsTestResult = {
  ok: boolean;
  message_vi: string;
  api_version?: string | null;
  accessible?: string[];
  accounts?: GoogleAdsAccountRow[];
  imported?: number;
};

async function currentRequest(): Promise<Request | undefined> {
  const { getRequest } = await import("@tanstack/react-start/server");
  return getRequest() ?? undefined;
}

function summarizeMccs(
  ids: string[],
  dashed: (id: string) => string,
  children: { mcc_customer_id: string; manager: boolean }[],
  errors: { mcc_customer_id: string; message_vi: string }[],
): string {
  return ids
    .map((id) => {
      const err = errors.find((e) => e.mcc_customer_id === id);
      if (err) return `MCC ${dashed(id)}: không đọc được (${err.message_vi})`;
      const n = children.filter((c) => c.mcc_customer_id === id && !c.manager).length;
      return `MCC ${dashed(id)}: ${n} tài khoản quảng cáo`;
    })
    .join(". ");
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
      const listed = await listAllMccChildren(cfg);
      const accounts = listed.children.map((c) => ({
        customer_id_dashed: c.customer_id_dashed,
        name: c.name,
        status: c.status,
        manager: c.manager,
        test_account: c.test_account,
        level: c.level,
        mcc_id_dashed: c.mcc_customer_id_dashed,
      }));
      const summary = summarizeMccs(managerCustomerIds(cfg), g.dashedId, listed.children, listed.errors);
      const ok = listed.children.length > 0 || listed.errors.length === 0;
      const msg = `${ok ? "Kết nối OK" : "Kết nối lỗi"} (API ${g.currentApiVersion() || "?"}): tài khoản Google đăng nhập truy cập trực tiếp ${accessible.length} tài khoản. ${summary}. Bấm “Kéo tài khoản MCC” để đưa vào danh sách trên đầu trang.`;
      await g.recordTestResult(ok, msg);
      return { ok, message_vi: msg, api_version: g.currentApiVersion(), accessible: accessible.map(g.dashedId), accounts };
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

/** Read both MCCs and store child ad accounts in Neon. Does not mutate Google Ads. */
export const pullMccAccounts = createServerFn({ method: "POST" })
  .middleware([principalMiddleware])
  .handler(async ({ context }): Promise<GoogleAdsTestResult> => {
    const p = await import("./permissions.server");
    p.assertRealAdmin(context.access);
    p.assertWritable(context.access);
    const g = await import("./google-ads.server.ts");
    const cfg = await g.resolveAdsConfig();
    if (!cfg.ready) {
      return { ok: false, message_vi: `Chưa đủ cấu hình. Thiếu: ${cfg.missing.map((m) => m.label_vi).join(" ")}` };
    }
    try {
      const listed = await listAllMccChildren(cfg);
      const ads = listed.children.filter((c) => !c.manager && c.customer_id !== c.mcc_customer_id);
      const imported = await importMccAccounts(
        ads.map((c) => ({
          customer_id: c.customer_id,
          display_name: c.name,
          status: c.status,
          manager_customer_id: c.mcc_customer_id,
        })),
      );
      const summary = summarizeMccs(managerCustomerIds(cfg), g.dashedId, listed.children, listed.errors);
      const ok = ads.length > 0 || listed.errors.length < managerCustomerIds(cfg).length;
      const msg = `${summary}. Đã thêm ${imported.inserted.length} tài khoản mới (không đổi tên tắt). Tải lại trang để thấy trên danh sách đầu trang.`;
      await g.recordTestResult(ok, msg);
      await p.audit(p.actorLabel(context.access.real), "google_ads.pull_mcc", "google_ads", "mcc", {
        inserted: imported.inserted.length,
        touched: imported.touched.length,
        errors: listed.errors.map((e) => g.dashedId(e.mcc_customer_id)),
      });
      return {
        ok,
        message_vi: msg,
        api_version: g.currentApiVersion(),
        imported: imported.inserted.length,
        accounts: ads.map((c) => ({
          customer_id_dashed: c.customer_id_dashed,
          name: c.name,
          status: c.status,
          manager: c.manager,
          test_account: c.test_account,
          level: c.level,
          mcc_id_dashed: c.mcc_customer_id_dashed,
        })),
      };
    } catch (err) {
      const msg =
        err instanceof g.AdsApiError ? err.adminMessage : "Không kéo được danh sách MCC (xem log server [google-ads]).";
      if (!(err instanceof g.AdsApiError)) {
        console.error(`[google-ads] pull mcc failed: ${err instanceof Error ? err.message.slice(0, 300) : "unknown"}`);
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
