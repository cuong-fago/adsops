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
  const { checkOptimizationScore, scoreCronQueue } = await import("@/lib/adsops/optimization-score.server");
  const { checkSharedSetCounts } = await import("@/lib/adsops/change-log.server");
  const { resolveAdsConfig } = await import("@/lib/adsops/google-ads.server");
  const cfg = await resolveAdsConfig();
  if (!cfg.ready) return Response.json({ ok: false, error: "google ads not configured" }, { status: 503, headers });

  // Once a day: customer_client.status for every MCC (read-only, one query per MCC).
  const { refreshMccStatusIfStale } = await import("@/lib/adsops/account-activity.server");
  const mccStatus = await refreshMccStatusIfStale(cfg).catch((e: unknown) => ({ ran: false, error: e instanceof Error ? e.message : String(e) }));
  const roster = (await listRosterAccounts()).filter((c) => (c.adapter || "live") === "live");
  // cronAccounts adds MCC-pulled Neon accounts to the file roster.
  const queue = await runwayCronQueue(await cronAccounts(roster));
  // Runway still runs for every account (its spend figure is how an account becomes active again);
  // score and shared-list counts skip known-inactive accounts.
  const { activeOnly } = await import("@/lib/adsops/account-activity.server");
  const activeSet = new Set(await activeOnly(queue));
  const scoreQueue = await scoreCronQueue(queue.filter((id) => activeSet.has(id)));
  const results: Array<{ client_id: string; ok: boolean; status: string }> = [];
  const scores: Array<{ client_id: string; ok: boolean }> = [];
  const inTime = () => Date.now() - started < BUDGET_MS;
  // Runway (+ shared list counts), oldest first, one account at a time.
  const runwayLoop = (async () => {
    for (const id of queue) {
      if (!inTime()) break;
      const r = await checkBudgetRunway(id, cfg);
      results.push({ client_id: id, ok: r.ok, status: r.status });
    }
  })();
  // Optimization score is one cheap query: its own queue (never-checked first), 4 at a time,
  // in the same 45 s, so it reaches far more accounts than the runway loop.
  let next = 0;
  const scoreWorker = async () => {
    while (inTime() && next < scoreQueue.length) {
      const id = scoreQueue[next++];
      // Score + shared negative list member counts: both one cheap query, same fast pool.
      const [s] = await Promise.all([
        checkOptimizationScore(id, cfg).catch(() => ({ ok: false })),
        checkSharedSetCounts(id, cfg).catch(() => null),
      ]);
      scores.push({ client_id: id, ok: s.ok });
    }
  };
  await Promise.all([runwayLoop, scoreWorker(), scoreWorker(), scoreWorker(), scoreWorker()]);
  return Response.json(
    {
      ok: true,
      total: queue.length,
      done: results.length,
      remaining: queue.length - results.length,
      mcc_status: mccStatus,
      score_done: scores.length,
      score_remaining: scoreQueue.length - scores.length,
      results,
      scores,
    },
    { headers },
  );
}

export const Route = createFileRoute("/api/cron/budget-runway")({
  server: {
    handlers: {
      GET: handle,
    },
  },
});
