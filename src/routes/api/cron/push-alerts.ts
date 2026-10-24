import { createFileRoute } from "@tanstack/react-router";


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

/**
 * Daily Vercel Cron (after budget-runway): web push for opted-in users only.
 * budget < 3 days (from ads_budget_runway) + sharp Google conversion drop (read-only GAQL).
 * Recipients are re-checked against current role + account grants. Auth: Bearer CRON_SECRET.
 */
const HARD_STOP_MS = 270_000;

async function handle({ request }: { request: Request }): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  if (!process.env.CRON_SECRET?.trim()) {
    return Response.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 503, headers });
  }
  if (!authorized(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers });
  const started = Date.now();
  const push = await import("@/lib/adsops/push.server");
  if (!push.vapid()) return Response.json({ ok: false, error: "VAPID not configured" }, { status: 503, headers });
  const budget = await push.runBudgetAlerts().catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
  const conv = await push.runConvDropAlerts(started + HARD_STOP_MS).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
  const { getSql } = await import("@/lib/db");
  await (await getSql()).query(`delete from push_sent where sent_at < now() - interval '60 days'`).catch(() => undefined);
  return Response.json({ ok: true, budget, conv, ms: Date.now() - started }, { headers });
}

export const Route = createFileRoute("/api/cron/push-alerts")({
  server: { handlers: { GET: handle } },
});
