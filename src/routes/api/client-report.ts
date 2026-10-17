import { createFileRoute } from "@tanstack/react-router";

/**
 * Client report page (print-optimised HTML).
 *   ?t=<token>  public share link: read-only, exactly one report, expiring, revocable.
 *   ?id=<n>     signed-in: report staff (all accounts granted) or a client user (report marked
 *               "Đã gửi" and EVERY account in it granted to that client).
 */
const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
};

async function handle({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url);
  const r = await import("@/lib/adsops/client-report.server");
  const { renderReportHtml, messagePage } = await import("@/lib/adsops/client-report.render");
  const token = (url.searchParams.get("t") || "").trim();
  if (token) {
    const id = await r.resolveToken(token);
    const rep = id ? await r.getReport(id) : null;
    if (!rep || !rep.data) return messagePage("Liên kết không hợp lệ", "Liên kết báo cáo đã hết hạn, đã bị thu hồi hoặc không tồn tại. Vui lòng liên hệ Fago Group để nhận liên kết mới.");
    return new Response(renderReportHtml(rep.data, rep.notes, rep.options, { status: "sent" }), { headers: HEADERS });
  }
  const id = Number(url.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return messagePage("Thiếu báo cáo", "Đường dẫn không đúng.", 400);
  const p = await import("@/lib/adsops/permissions.server");
  let ctx: Awaited<ReturnType<typeof p.resolveAccessFromHeaders>>;
  try {
    await (await import("@/lib/adsops/access.server")).ensureRosterSeeded();
    ctx = await p.resolveAccessFromHeaders(request.headers);
  } catch {
    return messagePage("Cần đăng nhập", "Vui lòng đăng nhập AdsOps để xem báo cáo.", 401);
  }
  let rep = await r.getReport(id);
  const { isReportStaff } = await import("@/lib/adsops/client-report.access");
  const allSeen = rep ? rep.account_ids.length > 0 && rep.account_ids.every((a) => p.canSeeAccount(ctx, a)) : false;
  const staff = isReportStaff(ctx);
  const client = ctx.principal.kind === "client" && ctx.principal.role !== "pending" && rep?.row.status === "sent";
  // Same response for "missing" and "not yours": never reveal another client's report.
  if (!rep || !allSeen || !(staff || client)) return messagePage("Không tìm thấy báo cáo", "Báo cáo không tồn tại hoặc bạn không có quyền xem.");
  if (!rep.data && staff && !ctx.readOnly) rep = await r.generate(id);
  if (!rep?.data) return messagePage("Báo cáo chưa sẵn sàng", "Báo cáo chưa được tạo số liệu.");
  return new Response(renderReportHtml(rep.data, rep.notes, rep.options, { status: client ? "sent" : rep.row.status }), { headers: HEADERS });
}

export const Route = createFileRoute("/api/client-report")({
  server: { handlers: { GET: handle } },
});
