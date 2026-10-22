import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import { isGoogleId, parseOcid } from "./google-ads-link.ts";

async function visibleGoogle(ctx: import("./permissions.server").AccessContext) {
  const { canSeeAccount } = await import("./permissions.server");
  const { loadWorkspaceDirectory } = await import("./access.server");
  const { withPulledMccClients } = await import("./mcc-import.server");
  const dir = await withPulledMccClients(await loadWorkspaceDirectory(ctx), ctx.allowed);
  const out = new Map<string, string>();
  for (const c of dir.clients) {
    if (!isGoogleId(c.client_id) || !canSeeAccount(ctx, c.client_id)) continue;
    const cid = String(c.customer_id_dashed || c.client_id).replace(/\D/g, "");
    if (/^\d{10}$/.test(cid)) out.set(c.client_id, cid);
  }
  return out;
}

/** Saved ocids for the Google accounts this staff user can see: { client_id: ocid }. */
export const readGoogleAdsLinksFn = createServerFn({ method: "POST" })
  .middleware([principalMiddleware])
  .handler(async ({ context }) => {
    const ctx = context.access;
    if (ctx.principal.kind !== "staff" || ctx.principal.role === "pending") return { links: {} as Record<string, string> };
    const vis = await visibleGoogle(ctx);
    if (!vis.size) return { links: {} as Record<string, string> };
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql.query<{ cid: string; ocid: string }>(`select cid, ocid from google_ads_links where cid = any($1::text[])`, [[...new Set(vis.values())]]).catch(() => []);
    const by = new Map(rows.map((r) => [r.cid, r.ocid]));
    const links: Record<string, string> = {};
    for (const [id, cid] of vis) { const o = by.get(cid); if (o) links[id] = o; }
    return { links };
  });

/** Admin only: save (from a pasted Google Ads URL) or clear the ocid of one Google account. */
export const setGoogleAdsLinkFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
    if (!clientId || !isGoogleId(clientId)) throw new Error("Tài khoản Google không hợp lệ");
    const url = typeof d.url === "string" ? d.url.slice(0, 2000) : null;
    return { clientId, url };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const ctx = context.access;
    const { assertEffectiveAdmin, assertAccount } = await import("./permissions.server");
    assertEffectiveAdmin(ctx);
    assertAccount(ctx, data.clientId);
    const cid = (await visibleGoogle(ctx)).get(data.clientId);
    if (!cid) throw new Error("Không tìm thấy mã khách hàng Google của tài khoản này.");
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    if (!data.url || !data.url.trim()) {
      await sql.query(`delete from google_ads_links where cid = $1`, [cid]);
      return { ocid: null as string | null };
    }
    const ocid = parseOcid(data.url);
    if (!ocid) throw new Error("Link không hợp lệ: cần link ads.google.com có tham số ocid=… (hoặc dán riêng số ocid).");
    await sql.query(
      `insert into google_ads_links (cid, ocid, updated_by, updated_at) values ($1, $2, $3, now())
       on conflict (cid) do update set ocid = excluded.ocid, updated_by = excluded.updated_by, updated_at = now()`,
      [cid, ocid, ctx.principal.email || ctx.principal.id],
    );
    return { ocid };
  });
