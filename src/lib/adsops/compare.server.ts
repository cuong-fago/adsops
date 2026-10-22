/**
 * "So sánh tài khoản" (staff only). Reads stored monthly rows (compare_monthly); the nightly Google snapshot
 * fills them from the cached trend3m campaign query + conversion-action leaves (read-only GAQL SELECT).
 * Platform-neutral storage: Meta / TikTok can add rows with platform 'facebook' / 'tiktok' later.
 */
import { getSql } from "@/lib/db";
import { mAdd } from "./google-trend.server.ts";
import { window } from "./google-trend-tree.server.ts";
import { readThresholds } from "./needs-action.server.ts";
import { CONV_GROUPS, type ConvGroup } from "./google-conv-groups.ts";
import { derive, groupLevel, type CompareGroup, type ComparePeriod, type ComparePlatform, type CompareRead, type CompareRow, type Raw } from "./compare.types.ts";

const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
export const platformOf = (id: string): ComparePlatform | null => (id.startsWith("fb_") ? "facebook" : id.startsWith("tt_") ? "tiktok" : id.startsWith("oa_") ? null : "google");

/** Nightly: store month × campaign type × conversion group for one Google account. */
export async function computeGoogleCompare(clientId: string): Promise<{ ok: boolean; error: string | null }> {
  const sql = await getSql();
  const w = window();
  const months = [...w.months, w.cur];
  try {
    const { readCampaignLeaves } = await import("./google-trend-tree.server.ts");
    const leaves = await readCampaignLeaves(clientId);
    type Cell = { clicks: number; cost: number; conversions: number };
    const all = new Map<string, Cell>(); // `${month}|${channel}`
    const chOfCamp = new Map<string, string>();
    for (const l of leaves) {
      if (!months.includes(l.month)) continue;
      chOfCamp.set(l.id, l.channel);
      const k = `${l.month}|${l.channel}`;
      const c = all.get(k) || { clicks: 0, cost: 0, conversions: 0 };
      c.clicks += l.clicks; c.cost += l.cost; c.conversions += l.conversions;
      all.set(k, c);
    }
    // Conversions per group: primary conversions per conversion action, mapped with the #87 mapping (override, else auto).
    let convOk = false;
    const grp = new Map<string, number>(); // `${month}|${channel}|${group}`
    try {
      const { readConvLeaves, readConvActions } = await import("./google-conv-groups.server.ts");
      const [cl, acts] = await Promise.all([readConvLeaves(clientId, "campaign"), readConvActions(clientId, false)]);
      if (!acts.error) {
        const gOf = new Map(acts.actions.map((a) => [a.id, a.group as ConvGroup]));
        for (const [campId, byMonth] of Object.entries(cl.conv)) {
          const ch = chOfCamp.get(campId) || "other";
          for (const [mo, byAct] of Object.entries(byMonth)) {
            if (!months.includes(mo)) continue;
            for (const [act, [conv]] of Object.entries(byAct)) {
              if (!conv) continue;
              const g = gOf.get(act) || "other";
              const k = `${mo}|${ch}|${g}`;
              grp.set(k, (grp.get(k) || 0) + conv);
            }
          }
        }
        convOk = true;
      }
    } catch { /* conversion groups optional: filter shows "-" */ }
    const rows: Array<{ month: string; channel: string; conv_group: string; clicks: number | null; cost: number | null; conversions: number | null }> = [];
    for (const [k, c] of all) { const [month, channel] = k.split("|"); rows.push({ month, channel, conv_group: "_all", clicks: c.clicks, cost: c.cost, conversions: c.conversions }); }
    if (convOk) {
      for (const k of all.keys()) {
        const [month, channel] = k.split("|");
        for (const g of CONV_GROUPS) rows.push({ month, channel, conv_group: g, clicks: null, cost: null, conversions: grp.get(`${month}|${channel}|${g}`) || 0 });
      }
    }
    await sql.query(`delete from compare_monthly where client_id = $1 and platform = 'google'`, [clientId]);
    if (rows.length) await sql.query(
      `insert into compare_monthly (platform, client_id, month, channel, conv_group, clicks, cost, conversions)
       select 'google', $1, x.month, x.channel, x.conv_group, x.clicks, x.cost, x.conversions
         from jsonb_to_recordset($2::jsonb) as x(month text, channel text, conv_group text, clicks double precision, cost double precision, conversions double precision)`,
      [clientId, JSON.stringify(rows)]);
    await sql.query(
      `insert into compare_state (client_id, platform, months, conv_ok, error, computed_at) values ($1, 'google', $2::jsonb, $3, null, now())
       on conflict (client_id) do update set months = excluded.months, conv_ok = excluded.conv_ok, error = null, computed_at = now()`,
      [clientId, JSON.stringify(months), convOk]);
    return { ok: true, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sql.query(
      `insert into compare_state (client_id, platform, error, computed_at) values ($1, 'google', $2, now())
       on conflict (client_id) do update set error = excluded.error, computed_at = now()`, [clientId, msg]).catch(() => null);
    return { ok: false, error: msg };
  }
}

export function periodMonths(p: ComparePeriod): string[] {
  const w = window();
  return p === "this_month" ? [w.cur] : p === "last_month" ? [mAdd(w.cur, -1)] : [...w.months];
}

// ── groups ────────────────────────────────────────────────────────────────────
export async function listGroups(visible: (id: string) => boolean): Promise<CompareGroup[]> {
  const sql = await getSql();
  const gs = await sql.query<{ id: string; name: string }>(`select id, name from compare_groups order by lower(name)`).catch(() => []);
  const ms = await sql.query<{ group_id: string; client_id: string }>(`select group_id, client_id from compare_group_members`).catch(() => []);
  const by = new Map<string, string[]>();
  for (const m of ms) (by.get(String(m.group_id)) || by.set(String(m.group_id), []).get(String(m.group_id))!).push(m.client_id);
  return gs.map((g) => {
    const all = by.get(String(g.id)) || [];
    const mine = all.filter(visible);
    return { id: Number(g.id), name: g.name, members: mine, hidden_count: all.length - mine.length };
  });
}
export async function createGroup(name: string, members: string[], by: string): Promise<number> {
  const sql = await getSql();
  const ex = await sql.query<{ id: string }>(`select id from compare_groups where lower(name) = lower($1)`, [name]);
  let id = ex[0]?.id;
  if (!id) id = (await sql.query<{ id: string }>(`insert into compare_groups (name, created_by) values ($1, $2) returning id`, [name, by]))[0].id;
  if (members.length) await addMembers(Number(id), members, by);
  return Number(id);
}
export async function renameGroup(id: number, name: string) {
  const sql = await getSql();
  const ex = await sql.query<{ id: string }>(`select id from compare_groups where lower(name) = lower($1) and id <> $2`, [name, id]);
  if (ex.length) throw new Error("Đã có nhóm trùng tên.");
  await sql.query(`update compare_groups set name = $2, updated_at = now() where id = $1`, [id, name]);
}
export async function deleteGroup(id: number) {
  const sql = await getSql();
  await sql.query(`delete from compare_groups where id = $1`, [id]);
}
export async function addMembers(id: number, ids: string[], by: string) {
  const sql = await getSql();
  await sql.query(`insert into compare_group_members (group_id, client_id, added_by) select $1, x, $3 from unnest($2::text[]) as x on conflict do nothing`, [id, ids, by]);
}
export async function removeMember(id: number, clientId: string) {
  const sql = await getSql();
  await sql.query(`delete from compare_group_members where group_id = $1 and client_id = $2`, [id, clientId]);
}

// ── comparison ────────────────────────────────────────────────────────────────
export async function readCompare(opts: {
  group: { id: number; name: string } | null; accounts: Array<{ client_id: string; label: string; customer_id_dashed: string | null }>;
  period: ComparePeriod; channels: string[]; convGroups: string[]; canManage: boolean; canCompute: boolean;
}): Promise<CompareRead> {
  const th = await readThresholds();
  const w = window();
  const months = periodMonths(opts.period);
  const trendMonths = [...w.months];
  const ids = opts.accounts.map((a) => a.client_id);
  const sql = await getSql();
  const want = [...new Set([...months, ...trendMonths])];
  const rows = ids.length ? await sql.query<{ client_id: string; month: string; channel: string; conv_group: string; clicks: number | null; cost: number | null; conversions: number | null }>(
    `select client_id, month, channel, conv_group, clicks, cost, conversions from compare_monthly where client_id = any($1::text[]) and month = any($2::text[])`, [ids, want]).catch(() => []) : [];
  const st = ids.length ? await sql.query<{ client_id: string; conv_ok: boolean; error: string | null; computed_at: unknown }>(
    `select client_id, conv_ok, error, computed_at from compare_state where client_id = any($1::text[])`, [ids]).catch(() => []) : [];
  const stBy = new Map(st.map((s) => [s.client_id, s]));
  const chans = new Set<string>();
  for (const r of rows) chans.add(r.channel);
  const chOk = (c: string) => !opts.channels.length || opts.channels.includes(c);
  const useGroups = opts.convGroups.length > 0 && opts.convGroups.length < CONV_GROUPS.length;
  let convNote: string | null = null;
  const agg = (id: string, ms: string[]): Raw & { any: boolean } => {
    let clicks = 0, cost = 0, conv = 0, any = false, convAny = false;
    const s = stBy.get(id);
    for (const r of rows) {
      if (r.client_id !== id || !ms.includes(r.month) || !chOk(r.channel)) continue;
      if (r.conv_group === "_all") {
        any = true; clicks += Number(r.clicks || 0); cost += Number(r.cost || 0);
        if (!useGroups && r.conversions != null) { conv += Number(r.conversions); convAny = true; }
      } else if (useGroups && opts.convGroups.includes(r.conv_group) && r.conversions != null) { conv += Number(r.conversions); convAny = true; }
    }
    if (useGroups && any && !s?.conv_ok) convNote = "Một số tài khoản chưa có số chuyển đổi theo nhóm (chưa đọc được nhóm chuyển đổi): cột chuyển đổi để “-”.";
    if (!any) return { clicks: null, cost: null, conversions: null, any: false };
    return { clicks, cost, conversions: convAny || !useGroups ? conv : null, any: true };
  };
  const out: CompareRow[] = opts.accounts.map((a) => {
    const r = agg(a.client_id, months);
    const m = derive(r);
    const s = stBy.get(a.client_id);
    return {
      client_id: a.client_id, platform: platformOf(a.client_id) || "google", label: a.label, customer_id_dashed: a.customer_id_dashed,
      m, has_data: r.any, low_data: r.any && ((r.conversions ?? 0) < th.conv || (r.clicks ?? 0) < th.clicks),
      computed_at: iso(s?.computed_at), error: s?.error || null,
      trend: trendMonths.map((mo) => ({ month: mo, m: derive(agg(a.client_id, [mo])) })),
    };
  });
  const gl = groupLevel(out);
  return {
    group: opts.group, period: opts.period, months, trend_months: trendMonths, rows: out, median: gl.median, weighted: gl.weighted,
    thresholds: { conv: th.conv, clicks: th.clicks }, channels: [...chans].sort(), can_manage: opts.canManage, can_compute: opts.canCompute, conv_note: convNote,
  };
}
