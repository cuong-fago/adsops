import { createFileRoute } from "@tanstack/react-router";

/**
 * Nightly Vercel Cron: Hóa đơn Google. Read-only (billing_setup GAQL SELECT + InvoiceService.ListInvoices GET)
 * for this and last month. Auth: `Authorization: Bearer $CRON_SECRET`.
 */
const HARD_STOP_MS = 270_000;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  const got = request.headers.get("authorization") || "";
  const want = `Bearer ${secret}`;
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

async function handle({ request }: { request: Request }): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  if (!process.env.CRON_SECRET?.trim()) return Response.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 503, headers });
  if (!authorized(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers });
  const started = Date.now();
  const { listRosterAccounts } = await import("@/lib/adsops/access.server");
  const { activeOnly } = await import("@/lib/adsops/account-activity.server");
  const roster = (await listRosterAccounts()).filter((c) => (c.adapter || "live") === "live");
  const ids = await activeOnly(roster.map((c) => c.client_id));
  const r = await (await import("@/lib/adsops/google-invoices.server")).refreshInvoices(ids, started + HARD_STOP_MS);
  return Response.json({ ok: true, ...r, ms: Date.now() - started }, { headers });
}

export const Route = createFileRoute("/api/cron/google-invoices")({
  server: { handlers: { GET: handle } },
});
