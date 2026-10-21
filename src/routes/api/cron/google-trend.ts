import { createFileRoute } from "@tanstack/react-router";

/**
 * Daily Vercel Cron: Google "Xu hướng 3T" snapshot per active account (read-only GAQL SELECT,
 * reuses the trend3m cache). Auth: `Authorization: Bearer $CRON_SECRET`.
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
  const { cronAccounts } = await import("@/lib/adsops/change-log.server");
  const { activeOnly } = await import("@/lib/adsops/account-activity.server");
  const roster = (await listRosterAccounts()).filter((c) => (c.adapter || "live") === "live");
  const ids = await activeOnly(await cronAccounts(roster));
  const r = await (await import("@/lib/adsops/google-trend-snapshot.server")).refreshSnapshots(ids, started + HARD_STOP_MS);
  return Response.json({ ok: true, ...r, ms: Date.now() - started }, { headers });
}

export const Route = createFileRoute("/api/cron/google-trend")({
  server: { handlers: { GET: handle } },
});
