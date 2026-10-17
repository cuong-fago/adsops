import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import type { OAConnection, OAView } from "./openai-ads.types.ts";

export type { OAView, OAConnection, OAMetrics, OACampaign, OAAdGroup, OANode } from "./openai-ads.types.ts";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const OA_RE = /^oa_[a-z0-9]+$/;

/** ChatGPT Ads view for one account the viewer may see. Previous period: staff only. Reads Neon only. */
export const readOpenAIViewFn = createServerFn({ method: "POST" })
  .validator((data: unknown): { clientId: string; start: string; end: string; compare: boolean } => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const clientId = String(d.clientId || "").trim();
    const start = String(d.start || "");
    const end = String(d.end || "");
    if (!OA_RE.test(clientId)) throw new Error("Tài khoản ChatGPT Ads không hợp lệ");
    if (!YMD.test(start) || !YMD.test(end) || start > end) throw new Error("Khoảng ngày không hợp lệ");
    return { clientId, start, end, compare: d.compare === true };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<OAView> => {
    const ctx = context.access;
    const { assertAccount } = await import("./permissions.server");
    if (ctx.principal.role === "pending") throw new Error("Chưa được cấp quyền.");
    assertAccount(ctx, data.clientId);
    const withPrev = ctx.principal.kind === "staff" && data.compare;
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const st = await sql.query<{ insights_through: unknown }>(`select insights_through from openai_account_state where client_id = $1`, [data.clientId]).catch(() => []);
    // Re-pull metadata once when any entity still lacks its parent (pre-#79 data, or a new ad group/ad).
    const orphan = await sql.query<{ n: number }>(
      `select count(*)::int as n from openai_entities where client_id = $1 and ((level = 'ad' and ad_group_id is null) or (level = 'ad_group' and campaign_id is null) or raw is null or raw->'obj' is null)`,
      [data.clientId],
    ).catch(() => [{ n: 0 }]);
    if (!st[0]?.insights_through || (orphan[0]?.n ?? 0) > 0) {
      // Never pulled yet: one read-only pull now (locked so parallel viewers don't stampede).
      const { acquireLock } = await import("./warehouse.server");
      if (await acquireLock(`${data.clientId}:oa-first`, 900)) {
        await (await import("./openai-ads.server")).refreshOpenAIAccount(data.clientId).catch(() => null);
      }
    }
    return (await import("./openai-analytics.server")).readOpenAIView(data.clientId, data.start, data.end, withPrev);
  });

async function assertAdmin(ctx: { principal: { kind: string; role: string }; readOnly?: boolean }) {
  const { ForbiddenError } = await import("./permissions.server");
  if (ctx.principal.kind !== "staff" || ctx.principal.role !== "admin" || ctx.readOnly) throw new ForbiddenError("Chỉ Admin.");
}

/** Admin: connected ChatGPT Ads accounts. Never includes key material. */
export const listOpenAIConnectionsFn = createServerFn({ method: "POST" })
  .middleware([principalMiddleware])
  .handler(async ({ context }): Promise<{ connections: OAConnection[]; enc_ready: boolean }> => {
    await assertAdmin(context.access);
    const m = await import("./openai-ads.server");
    await m.seedFromEnv().catch(() => null);
    return { connections: await m.listConnections(), enc_ready: Boolean((process.env.OPENAI_ADS_ENC_KEY || "").trim()) };
  });

/** Admin: paste a key → validated with GET /ad_account → stored encrypted → first pull. The key is never echoed back. */
export const connectOpenAIKeyFn = createServerFn({ method: "POST" })
  .validator((data: unknown): { key: string } => {
    const key = data && typeof data === "object" ? String((data as { key?: unknown }).key || "") : "";
    if (!key.trim()) throw new Error("Hãy dán API key.");
    if (key.length > 400) throw new Error("API key quá dài.");
    return { key };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }): Promise<{ client_id: string; ad_account_id: string; name: string; currency: string | null; timezone: string | null; pulled: boolean; error_vi: string | null }> => {
    await assertAdmin(context.access);
    const { actorLabel } = await import("./permissions.server");
    const m = await import("./openai-ads.server");
    let acc;
    try {
      acc = await m.connectKey(data.key, actorLabel(context.access.principal));
    } catch (e) {
      throw new Error(`Không kết nối được: ${m.errVi(e)}`);
    }
    const r = await m.refreshOpenAIAccount(acc.client_id).catch((e: unknown) => ({ ok: false, error_vi: m.errVi(e) }));
    return { ...acc, pulled: r.ok, error_vi: r.error_vi };
  });
