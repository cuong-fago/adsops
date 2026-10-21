/**
 * "Cần xử lý (3 tháng)": reads ONLY the nightly google_trend_entity rows (no Google calls).
 * Like-for-like entities only (active all 3 complete months), per channel type; primary conversions.
 */
import { getSql } from "@/lib/db";
import { diagnose } from "./google-trend.server.ts";
import type { ChannelKey, TrendMonth } from "./google-trend.types.ts";
import type { SnapMonth } from "./google-trend-snapshot.types.ts";
import { NEED_DEFAULTS, type NeedAccount, type NeedLevel, type NeedMetric, type NeedRow, type NeedsRead, type NeedThresholds } from "./needs-action.types.ts";

const KEY = "needs_action_thresholds";
const MET: Array<[NeedMetric, boolean]> = [["cpc", true], ["cpa", true], ["cvr", false]];
const DIAG: Record<NeedMetric, string> = { cpc: "cpc_up", cvr: "cvr_down", cpa: "cpa_after_click" };

export async function readThresholds(): Promise<NeedThresholds> {
  const sql = await getSql();
  const r = await sql.query<{ value: unknown }>(`select value from adsops_settings where key = $1`, [KEY]).catch(() => []);
  const v = (r[0] ? (typeof r[0].value === "string" ? JSON.parse(r[0].value) : r[0].value) : {}) as Partial<NeedThresholds>;
  const ok = (x: unknown, lo: number, hi: number, d: number) => (typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi ? x : d);
  return { step: ok(v.step, 0.01, 1, NEED_DEFAULTS.step), conv: ok(v.conv, 0, 1000, NEED_DEFAULTS.conv), clicks: ok(v.clicks, 0, 100000, NEED_DEFAULTS.clicks) };
}
export async function saveThresholds(t: NeedThresholds, by: string) {
  const sql = await getSql();
  await sql.query(`insert into adsops_settings (key, value, updated_by) values ($1, $2::jsonb, $3)
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`, [KEY, JSON.stringify(t), by]);
  return readThresholds();
}

function toTM(m: SnapMonth, th: NeedThresholds): TrendMonth {
  const c = m.clicks, v = m.conversions, s = m.spend;
  return {
    month: m.month, partial: false, days: 30, clicks: c, conversions: v, spend: s,
    cpc: c && s != null ? s / c : null, cpa: v && s != null ? s / v : null, cvr: c && v != null ? v / c : null,
    lost_rank_is: null, low_data: c == null || v == null || v < th.conv || c < th.clicks,
  };
}

export async function readNeeds(accounts: Array<{ client_id: string; label: string }>, opts: { canFilterOwner: boolean; canEdit: boolean }): Promise<NeedsRead> {
  const th = await readThresholds();
  const ids = accounts.map((a) => a.client_id).filter((id) => !id.startsWith("fb_") && !id.startsWith("oa_"));
  const sql = await getSql();
  const [ents, snaps, grants, staff] = await Promise.all([
    sql.query<{ client_id: string; level: NeedLevel; entity_id: string; campaign_id: string | null; name: string | null; channel: string; like_set: boolean; months: unknown }>(
      `select client_id, level, entity_id, campaign_id, name, channel, like_set, months from google_trend_entity where client_id = any($1::text[])`, [ids]).catch(() => []),
    sql.query<{ client_id: string; error: string | null; entity_error: string | null; computed_at: unknown }>(
      `select client_id, error, entity_error, computed_at from google_trend_snapshot where client_id = any($1::text[])`, [ids]).catch(() => []),
    opts.canFilterOwner ? sql.query<{ principal_id: string; ad_account_id: string }>(`select principal_id, ad_account_id from account_grants where principal_kind = 'staff' and ad_account_id = any($1::text[])`, [ids]).catch(() => []) : Promise.resolve([]),
    opts.canFilterOwner ? sql.query<{ id: string; email: string; display_name: string | null; role: string }>(`select id, email, display_name, role from staff_users`).catch(() => []) : Promise.resolve([]),
  ]);
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
  const snapBy = new Map(snaps.map((s) => [s.client_id, s]));
  const ownersBy = new Map<string, string[]>();
  for (const g of grants) (ownersBy.get(g.ad_account_id) || ownersBy.set(g.ad_account_id, []).get(g.ad_account_id)!).push(g.principal_id);
  const campName = new Map<string, string>();
  for (const e of ents) if (e.level === "campaign") campName.set(`${e.client_id}|${e.entity_id}`, e.name || e.entity_id);
  let months: string[] = [];
  const rowsBy = new Map<string, NeedRow[]>();
  for (const e of ents) {
    if (!e.like_set) continue;
    const ms = ((typeof e.months === "string" ? JSON.parse(e.months) : e.months) as SnapMonth[]).map((m) => toTM(m, th));
    if (ms.length !== 3) continue;
    if (!months.length) months = ms.map((m) => m.month);
    const diags = diagnose(ms);
    for (const [k, upBad] of MET) {
      const v = ms.map((m) => m[k]);
      const step = (i: number) => (ms[i].low_data || ms[i + 1].low_data || v[i] == null || v[i + 1] == null || v[i] === 0 ? null : (v[i + 1]! - v[i]!) / v[i]!);
      const steps = [step(0), step(1)];
      const badS = steps.map((s) => (s == null ? null : upBad ? s : -s));
      const worse = badS.some((s) => s != null && s > th.step);
      const better = badS.some((s) => s != null && s < -th.step);
      if (!worse && !better) continue;
      const kind = worse ? "worse" : "better";
      const mag = Math.max(...badS.map((s) => (s == null ? 0 : kind === "worse" ? s : -s)));
      const spend = ms[2].spend;
      const d = diags.find((x) => x.kind === DIAG[k]);
      const r: NeedRow = {
        level: e.level, entity_id: e.entity_id, campaign_id: e.campaign_id, campaign_name: e.level === "ad_group" || e.level === "asset_group" ? campName.get(`${e.client_id}|${e.campaign_id}`) ?? null : null,
        name: e.level === "account" ? "Toàn tài khoản (cùng loại)" : e.name || e.entity_id, channel: e.channel as ChannelKey,
        metric: k, values: v, low: ms.map((m) => m.low_data), steps, kind, spend, weight: mag * (spend ?? 0), diag: d ? d.title : null,
      };
      (rowsBy.get(e.client_id) || rowsBy.set(e.client_id, []).get(e.client_id)!).push(r);
    }
  }
  const out: NeedAccount[] = accounts.filter((a) => ids.includes(a.client_id)).map((a) => {
    const s = snapBy.get(a.client_id);
    return {
      client_id: a.client_id, label: a.label, owners: ownersBy.get(a.client_id) || [], computed_at: s ? iso(s.computed_at) : null,
      error: s?.error ?? null, entity_error: s?.entity_error ?? null, rows: (rowsBy.get(a.client_id) || []).sort((x, y) => y.weight - x.weight),
    };
  });
  const ownerIds = new Set(grants.map((g) => g.principal_id));
  const last = snaps.map((s) => iso(s.computed_at)).filter((x): x is string => !!x).sort().pop() ?? null;
  return {
    months, accounts: out, thresholds: th, can_filter_owner: opts.canFilterOwner, can_edit_settings: opts.canEdit,
    owners: staff.filter((s) => ownerIds.has(s.id)).map((s) => ({ id: s.id, name: s.display_name || s.email })).sort((x, y) => x.name.localeCompare(y.name, "vi")),
    not_computed: out.filter((a) => !a.computed_at).length, last_run: last,
  };
}
