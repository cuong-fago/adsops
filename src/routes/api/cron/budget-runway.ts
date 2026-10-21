import { createFileRoute } from "@tanstack/react-router";

/**
 * Daily Vercel Cron: read-only budget runway check (account_budget + 7-day spend)
 * and the optimization score (customer.optimization_score, stored per day)
 * for roster + MCC-pulled accounts, least recently checked first, inside a time
 * budget. Auth: `Authorization: Bearer $CRON_SECRET` (refuses without it).
 */
/** Runway + score window (after the spend pass). */
const BUDGET_MS = 45_000;
/** Spend pass: every account, read-only, 8 at a time. ~150 accounts take well under a minute. */
const SPEND_MS = 200_000;
const SPEND_CONCURRENCY = 8;
/** Hard stop below Vercel's 300 s maxDuration (vite.config.ts functionRules). */
const HARD_STOP_MS = 285_000;

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
  // Facebook (Meta) runs alongside the Google phases: account sync + 35-day insights + runway/10-day spend.
  const { refreshAllMeta, metaConfigured } = await import("@/lib/adsops/meta-ads.server");
  const metaRun = metaConfigured()
    ? refreshAllMeta(started + SPEND_MS).catch((e: unknown) => ({ ok: false, accounts: 0, done: 0, inserted: 0, errors: [e instanceof Error ? e.message : String(e)] }))
    : Promise.resolve(null);
  // ChatGPT Ads (OpenAI): account facts + structure + 35-day insights per stored key (read-only GET).
  const openaiRun = (await import("@/lib/adsops/openai-ads.server"))
    .refreshAllOpenAI(started + SPEND_MS)
    .catch((e: unknown) => ({ accounts: 0, done: 0, errors: [e instanceof Error ? e.message : String(e)] }));
  // TikTok Ads: structure + 35-day insights per connected advertiser (read-only GET).
  const tiktokRun = (await import("@/lib/adsops/tiktok-ads.server"))
    .refreshAllTikTok(started + SPEND_MS)
    .catch((e: unknown) => ({ accounts: 0, done: 0, errors: [e instanceof Error ? e.message : String(e)], configured: false }));
  // Scheduled client reports: insert DRAFT placeholders only (a few SQL statements); data is built
  // lazily when staff open the draft. Never sends anything to clients.
  const reportDrafts = await (await import("@/lib/adsops/client-report.server")).ensureScheduledDrafts().catch((e: unknown) => ({ created: 0, error: e instanceof Error ? e.message : String(e) }));
  const { resolveAdsConfig } = await import("@/lib/adsops/google-ads.server");
  const cfg = await resolveAdsConfig();
  if (!cfg.ready) return Response.json({ ok: false, error: "google ads not configured", meta: await metaRun, openai: await openaiRun, tiktok: await tiktokRun }, { status: 503, headers });

  // Once a day: customer_client.status for every MCC (read-only, one query per MCC).
  const { refreshMccStatusIfStale } = await import("@/lib/adsops/account-activity.server");
  const mccStatus = await refreshMccStatusIfStale(cfg).catch((e: unknown) => ({ ran: false, error: e instanceof Error ? e.message : String(e) }));
  const roster = (await listRosterAccounts()).filter((c) => (c.adapter || "live") === "live");
  // cronAccounts adds MCC-pulled Neon accounts to the file roster.
  const queue = await runwayCronQueue(await cronAccounts(roster));
  // 10-day spend for EVERY account (hidden ones too: one cheap read-only query each, at most once
  // per 20 h). This is how an account is hidden after 10 days without spend and comes back on spend.
  const { refreshSpend10 } = await import("@/lib/adsops/spend10.server");
  const spend10 = await refreshSpend10(queue, cfg, { deadline: started + SPEND_MS, n: SPEND_CONCURRENCY }).catch(() => []);
  const phaseStart = Date.now();
  // Everything else (runway, score, shared-list counts) skips hidden accounts to save quota.
  const { activeOnly } = await import("@/lib/adsops/account-activity.server");
  const activeSet = new Set(await activeOnly(queue));
  const runwayQueue = queue.filter((id) => activeSet.has(id));
  const scoreQueue = await scoreCronQueue(runwayQueue);
  const results: Array<{ client_id: string; ok: boolean; status: string }> = [];
  const scores: Array<{ client_id: string; ok: boolean }> = [];
  const inTime = () => Date.now() - phaseStart < BUDGET_MS && Date.now() - started < HARD_STOP_MS;
  // Runway (+ shared list counts), oldest first, one account at a time.
  const runwayLoop = (async () => {
    for (const id of runwayQueue) {
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
  const meta = await metaRun;
  const openai = await openaiRun;
  const tiktok = await tiktokRun;
  return Response.json(
    {
      ok: true,
      meta,
      openai,
      tiktok,
      report_drafts: reportDrafts,
      total: queue.length,
      active: runwayQueue.length,
      spend10_checked: spend10.length,
      spend10_ms: phaseStart - started,
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
