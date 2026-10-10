import { createFileRoute } from "@tanstack/react-router";

/**
 * Daily Vercel Cron: pulls the keyword change log (read-only Google Ads GAQL)
 * for roster accounts, least recently pulled first, inside a time budget so the
 * function never runs past its limit. Accounts not reached today are first in
 * line on the next run; manual "Kéo tất cả tài khoản" covers the rest.
 *
 * Auth: Vercel sends `Authorization: Bearer $CRON_SECRET`. Without CRON_SECRET
 * configured the route refuses to run.
 */
const BUDGET_MS = 45_000;

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
  if (!process.env.CRON_SECRET?.trim()) {
    return Response.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 503, headers });
  }
  if (!authorized(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers });

  const started = Date.now();
  const { listRosterAccounts } = await import("@/lib/adsops/access.server");
  const { cronAccounts, pullChangeLog } = await import("@/lib/adsops/change-log.server");
  const { resolveAdsConfig } = await import("@/lib/adsops/google-ads.server");
  const cfg = await resolveAdsConfig();
  if (!cfg.ready) return Response.json({ ok: false, error: "google ads not configured" }, { status: 503, headers });

  const roster = (await listRosterAccounts()).filter((c) => (c.adapter || "live") === "live");
  const queue = await cronAccounts(roster);
  const results: Array<{ client_id: string; ok: boolean; rows: number; error?: string | null }> = [];
  for (const id of queue) {
    if (Date.now() - started > BUDGET_MS) break;
    const r = await pullChangeLog(id, { trigger: "cron", actor: "cron", cfg });
    results.push({ client_id: id, ok: r.ok, rows: r.row_count, error: r.error_vi });
  }
  return Response.json(
    { ok: true, total: queue.length, done: results.length, remaining: queue.length - results.length, results },
    { headers },
  );
}

export const Route = createFileRoute("/api/cron/change-log")({
  server: {
    handlers: {
      GET: handle,
    },
  },
});
