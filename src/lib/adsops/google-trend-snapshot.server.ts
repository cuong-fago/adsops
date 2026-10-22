/**
 * Nightly "Xu hướng 3T" snapshot per Google account. Reuses the trend3m campaign query + cache
 * (read-only GAQL SELECT). Like-for-like: per channel type, campaigns with data in all 3 months only.
 * Conversions = primary actions (equal to all standard groups selected, the default of the mapping).
 */
import { getSql } from "@/lib/db";
import { readAllChildren, readTrendTree } from "./google-trend-tree.server.ts";
import type { TreeRow, TrendTreeRead } from "./google-trend.types.ts";
import type { TrendMonth } from "./google-trend.types.ts";
import { ALERT_STEP, VERDICT_BAND, type SnapChannel, type TrendAlert, type TrendSnapshot, type TrendVerdict } from "./google-trend-snapshot.types.ts";

const MET = [["cpc", true], ["cpa", true], ["cvr", false]] as const;
const bad = (a: number | null, b: number | null, upBad: boolean) => (a == null || b == null || a === 0 ? null : ((b - a) / a) * (upBad ? 1 : -1));
const snapM = (m: TrendMonth) => ({ month: m.month, cpc: m.cpc, cpa: m.cpa, cvr: m.cvr, clicks: m.clicks, conversions: m.conversions, spend: m.spend, low_data: m.low_data });

export async function computeSnapshot(clientId: string): Promise<TrendSnapshot> {
  const now = new Date().toISOString();
  const base: TrendSnapshot = { client_id: clientId, month: null, verdict: "none", score: null, primary_channel: null, channels: [], alerts: [], error: null, computed_at: now };
  let snap: TrendSnapshot;
  let entityError: string | null = null;
  try {
    const t = await readTrendTree(clientId, { conv: false });
    if (t.error) snap = { ...base, verdict: "error", error: t.error };
    else {
      const channels: SnapChannel[] = t.groups.filter((g) => g.like_count > 0).map((g) => ({ channel: g.channel, like_count: g.like_count, total_count: g.total_count, months: g.like.map(snapM) }));
      const alerts: TrendAlert[] = [];
      for (const c of channels) {
        const [a, b, d] = c.months;
        if (!a || !b || !d || a.low_data || b.low_data || d.low_data) continue;
        for (const [k, upBad] of MET) {
          const d1 = bad(a[k], b[k], upBad), d2 = bad(b[k], d[k], upBad);
          if (d1 != null && d2 != null && d1 > ALERT_STEP && d2 > ALERT_STEP) alerts.push({ channel: c.channel, metric: k, d1, d2, months: [a.month, b.month, d.month] });
        }
      }
      // Headline channel: Search when it has a like-for-like set, else the biggest spend in T.
      const prim = channels.find((c) => c.channel === "search") || [...channels].sort((x, y) => (y.months[2]?.spend ?? 0) - (x.months[2]?.spend ?? 0))[0];
      let verdict: TrendVerdict = "none", score: number | null = null;
      if (prim) {
        const b = prim.months[1], d = prim.months[2];
        if (b.low_data || d.low_data) verdict = "low";
        else {
          const xs = MET.map(([k, u]) => bad(b[k], d[k], u)).filter((v): v is number => v != null);
          if (xs.length) { score = xs.reduce((s, v) => s + v, 0) / xs.length; verdict = score > VERDICT_BAND ? "worse" : score < -VERDICT_BAND ? "better" : "stable"; }
        }
      }
      snap = { ...base, month: t.months[2] ?? null, verdict, score, primary_channel: prim?.channel ?? null, channels, alerts };
      entityError = await storeEntities(clientId, t).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
      // "So sánh tài khoản": month × campaign type × conversion group (same cached query; conversion leaves read-only).
      await (await import("./compare.server.ts")).computeGoogleCompare(clientId).catch(() => null);
    }
  } catch (e) {
    snap = { ...base, verdict: "error", error: e instanceof Error ? e.message : String(e) };
  }
  const sql = await getSql();
  // A failed run stores the error so staff see "lỗi" with the reason (no stale verdict presented as current).
  await sql.query(
    `insert into google_trend_snapshot (client_id, month, verdict, score, payload, error, entity_error, computed_at) values ($1, $2, $3, $4, $5::jsonb, $6, $7, now())
     on conflict (client_id) do update set month = excluded.month, verdict = excluded.verdict, score = excluded.score, payload = excluded.payload, error = excluded.error, entity_error = excluded.entity_error, computed_at = now()`,
    [clientId, snap.month, snap.verdict, snap.score, JSON.stringify({ primary_channel: snap.primary_channel, channels: snap.channels, alerts: snap.alerts }), snap.error, entityError],
  );
  return snap;
}

export async function readSnapshots(ids: string[]): Promise<Record<string, TrendSnapshot>> {
  if (!ids.length) return {};
  const sql = await getSql();
  const rows = await sql.query<{ client_id: string; month: string | null; verdict: string; score: number | null; payload: unknown; error: string | null; computed_at: unknown }>(
    `select client_id, month, verdict, score, payload, error, computed_at from google_trend_snapshot where client_id = any($1::text[])`, [ids]).catch(() => []);
  const out: Record<string, TrendSnapshot> = {};
  for (const r of rows) {
    const p = (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload || {}) as Partial<TrendSnapshot>;
    out[r.client_id] = {
      client_id: r.client_id, month: r.month, verdict: r.verdict as TrendVerdict, score: r.score == null ? null : Number(r.score),
      primary_channel: p.primary_channel ?? null, channels: p.channels || [], alerts: p.alerts || [], error: r.error,
      computed_at: r.computed_at instanceof Date ? r.computed_at.toISOString() : String(r.computed_at),
    };
  }
  return out;
}

/** Cron: Google accounts whose snapshot is missing or older than 20 h, oldest first, within a deadline. */
export async function refreshSnapshots(ids: string[], deadline: number, n = 4) {
  const google = ids.filter((id) => !id.startsWith("fb_") && !id.startsWith("oa_") && !id.startsWith("tt_"));
  const sql = await getSql();
  const have = await sql.query<{ client_id: string; computed_at: unknown }>(`select client_id, computed_at from google_trend_snapshot where client_id = any($1::text[])`, [google]).catch(() => []);
  const at = new Map(have.map((h) => [h.client_id, Date.parse(h.computed_at instanceof Date ? h.computed_at.toISOString() : String(h.computed_at))]));
  const queue = google.filter((id) => !at.has(id) || Date.now() - at.get(id)! > 20 * 3600_000).sort((a, b) => (at.get(a) ?? 0) - (at.get(b) ?? 0));
  let next = 0, done = 0, failed = 0;
  const worker = async () => {
    while (Date.now() < deadline && next < queue.length) {
      const id = queue[next++];
      const s = await computeSnapshot(id).catch(() => null);
      done += 1; if (!s || s.verdict === "error") failed += 1;
    }
  };
  await Promise.all(Array.from({ length: n }, worker));
  return { queued: queue.length, done, failed, remaining: queue.length - done };
}

/** Replace the account's entity rows (account channel aggregates, campaigns, ad groups, asset groups). Returns a partial error or null. */
async function storeEntities(clientId: string, t: TrendTreeRead): Promise<string | null> {
  const kids = await readAllChildren(clientId).catch((e: unknown) => ({ ad_groups: [] as TreeRow[], asset_groups: [] as TreeRow[], error: e instanceof Error ? e.message : String(e) }));
  const camp = new Map<string, TreeRow>();
  for (const g of t.groups) for (const c of g.campaigns) camp.set(c.id, c);
  type E = { level: string; entity_id: string; campaign_id: string | null; name: string; channel: string; like_set: boolean; months: unknown };
  const rows: E[] = [];
  for (const g of t.groups) rows.push({ level: "account", entity_id: g.channel, campaign_id: null, name: "", channel: g.channel, like_set: g.like_count > 0, months: g.like.map(snapM) });
  for (const c of camp.values()) rows.push({ level: "campaign", entity_id: c.id, campaign_id: c.id, name: c.name, channel: c.channel, like_set: !c.excluded_label, months: c.months.map(snapM) });
  const kid = (level: string, r: TreeRow) => {
    const p = r.parent_id ? camp.get(r.parent_id) : undefined;
    rows.push({ level, entity_id: r.id, campaign_id: r.parent_id ?? null, name: r.name, channel: p?.channel ?? r.channel, like_set: !r.excluded_label, months: r.months.map(snapM) });
  };
  for (const r of kids.ad_groups) if (!(r.parent_id && camp.get(r.parent_id)?.channel === "pmax")) kid("ad_group", r);
  for (const r of kids.asset_groups) kid("asset_group", r);
  const sql = await getSql();
  // Keep the previous children when their query failed (stale beats empty).
  const levels = kids.error ? ["account", "campaign"] : ["account", "campaign", "ad_group", "asset_group"];
  await sql.query(`delete from google_trend_entity where client_id = $1 and level = any($2::text[])`, [clientId, levels]);
  const put = rows.filter((r) => levels.includes(r.level));
  for (let i = 0; i < put.length; i += 500) {
    await sql.query(
      `insert into google_trend_entity (client_id, level, entity_id, campaign_id, name, channel, like_set, months)
       select $1, x.level, x.entity_id, x.campaign_id, x.name, x.channel, x.like_set, x.months
         from jsonb_to_recordset($2::jsonb) as x(level text, entity_id text, campaign_id text, name text, channel text, like_set boolean, months jsonb)
       on conflict (client_id, level, entity_id) do update set campaign_id = excluded.campaign_id, name = excluded.name, channel = excluded.channel, like_set = excluded.like_set, months = excluded.months, computed_at = now()`,
      [clientId, JSON.stringify(put.slice(i, i + 500))],
    );
  }
  return kids.error;
}
