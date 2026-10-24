import { createFileRoute } from "@tanstack/react-router";

/** GET /api/bot/optimize-summary?name=&date=YYYY-MM-DD (Bearer BOT_READ_TOKEN). Read-only, app DB only. */
async function handle({ request }: { request: Request }): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  const { botAuthorized, optimizeSummary } = await import("@/lib/adsops/bot-summary.server");
  if (!botAuthorized(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers });
  const u = new URL(request.url);
  const name = (u.searchParams.get("name") || "").trim();
  let date = u.searchParams.get("date") || "";
  if (!date) {
    const t = new Date(Date.now() + 7 * 3_600_000 - 86_400_000);
    date = t.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return Response.json({ ok: false, error: "date=YYYY-MM-DD" }, { status: 400, headers });
  if (!name) return Response.json({ ok: false, error: "name required" }, { status: 400, headers });
  const accounts = await optimizeSummary(name, date);
  return Response.json({ ok: true, date, timezone: "Asia/Saigon", name, count: accounts.length, accounts }, { headers });
}

export const Route = createFileRoute("/api/bot/optimize-summary")({
  server: { handlers: { GET: handle } },
});
