import { createFileRoute } from "@tanstack/react-router";
import { ingestAuthorized } from "./ingest";

/**
 * GET /api/invoices/accounts?month=YYYY-MM (Bearer INVOICE_INGEST_TOKEN): Google accounts with
 * spend > 0 that month, MCC chain and documents already stored — tells the box which zips to fetch.
 */
async function handle({ request }: { request: Request }): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  if (!process.env.INVOICE_INGEST_TOKEN?.trim()) return Response.json({ ok: false, error: "INVOICE_INGEST_TOKEN not configured" }, { status: 503, headers });
  if (!ingestAuthorized(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers });
  const month = new URL(request.url).searchParams.get("month") || "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return Response.json({ ok: false, error: "month=YYYY-MM required" }, { status: 400, headers });
  const { downloadGuide } = await import("@/lib/adsops/google-invoices.server");
  const accounts = await downloadGuide(month);
  return Response.json({ ok: true, month, count: accounts.length, accounts }, { headers });
}

export const Route = createFileRoute("/api/invoices/accounts")({
  server: { handlers: { GET: handle } },
});
