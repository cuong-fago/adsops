import { createFileRoute } from "@tanstack/react-router";

/**
 * Daily Vercel Cron: read-only budget runway check (account_budget + 7-day spend)
 * and the optimization score (customer.optimization_score, stored per day)
 * for roster + MCC-pulled accounts, least recently checked first, inside a time
 * budget. Auth: `Authorization: Bearer $CRON_SECRET` (refuses without it).
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
  const { cronAccounts } = await import("@/lib/adsops/change-log.server");
  const { checkBudgetRunway, runwayCronQueue } = await import("@/lib/adsops/budget-runway.server");
  const { checkOptimizationScore } = await import("@/lib/adsops/optimization-score.server");
  const { checkSharedSetCounts } = await import("@/lib/adsops/change-log.server");
  const { resolveAdsConfig } = await import("@/lib/adsops/google-ads.server");
  const cfg = await resolveAdsConfig();
  if (!cfg.ready) return Response.json({ ok: false, error: "google ads not configured" }, { status: 503, headers });

  const roster = (await listRosterAccounts()).filter((c) => (c.adapter || "live") === "live");
  // cronAccounts adds MCC-pulled Neon accounts to the file roster.
  const queue = await runwayCronQueue(await cronAccounts(roster));
  const results: Array<{ client_id: string; ok: boolean; status: string; score_ok: boolean }> = [];
  for (const id of queue) {
    if (Date.now() - started > BUDGET_MS) break;
    // Same account, same pass: runway (3 queries) and optimization score (1 query) in parallel.
    // + shared negative list member counts (1 query; records additions as change-log events).
    const [r, s] = await Promise.all([
      checkBudgetRunway(id, cfg),
      checkOptimizationScore(id, cfg),
      checkSharedSetCounts(id, cfg).catch(() => null),
    ]);
    results.push({ client_id: id, ok: r.ok, status: r.status, score_ok: s.ok });
  }
  return Response.json({ ok: true, total: queue.length, done: results.length, remaining: queue.length - results.length, results }, { headers });
}

export const Route = createFileRoute("/api/cron/budget-runway")({
  server: {
    handlers: {
      GET: handle,
    },
  },
});
