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
import { derive, groupLevel, monthList, type CompareGroup, type ComparePeriod, type ComparePlatform, type CompareRange, type CompareRead, type CompareRow, type Raw } from "./compare.types.ts";

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

export function periodMonths(p: ComparePeriod, range?: CompareRange | null): string[] {
  const w = window();
  if (p === "months" && range) return monthList(range.from, range.to);
  return p === "this_month" ? [w.cur] : p === "last_month" ? [mAdd(w.cur, -1)] : [...w.months];
}

type MRow = { client_id: string; month: string; channel: string; conv_group: string; clicks: number | null; cost: number | null; conversions: number | null };
const DAY = "_d"; // pseudo month for a live day range

/**
 * Live day range for one Google account (read-only GAQL SELECT, segments.date BETWEEN): campaign type totals +
 * primary conversions per conversion action mapped to groups (#87). Cached 1 h per account × range.
 */
async function liveDayRows(clientId: string, start: string, end: string): Promise<MRow[]> {
  const { cached } = await import("./google-trend-tree.server.ts");
  const { resolveAdsConfig } = await import("./google-ads.server.ts");
  const { asRec, customerIdFor, searchLeaf } = await import("./warehouse.server.ts");
  const { num } = await import("./google-trend.server.ts");
  const customerId = customerIdFor(clientId);
  if (customerId.length !== 10) throw new Error("Không phải tài khoản Google.");
  const CH: Record<string, string> = { SEARCH: "search", PERFORMANCE_MAX: "pmax", SHOPPING: "shopping", VIDEO: "video", DISPLAY: "display", DEMAND_GEN: "demand_gen", DISCOVERY: "demand_gen" };
  type V = { all: Array<[string, number, number, number]>; conv: Array<[string, string, number]> | null };
  const { v } = await cached<V>(clientId, "compare_days", start, end, async () => {
    const cfg = await resolveAdsConfig();
    if (!cfg.ready) throw new Error("Chưa cấu hình Google Ads API.");
    const range = `segments.date BETWEEN '${start}' AND '${end}'`;
    const rows = await searchLeaf(cfg, customerId, `SELECT campaign.id, campaign.advertising_channel_type, metrics.clicks, metrics.conversions, metrics.cost_micros FROM campaign WHERE ${range}`);
    const camp = new Map<string, string>();
    const by = new Map<string, [number, number, number]>();
    for (const r of rows) {
      const c = asRec(r.campaign), x = asRec(r.metrics);
      const ch = CH[String(c.advertisingChannelType ?? "")] || "other";
      camp.set(String(c.id ?? ""), ch);
      const p = by.get(ch) || [0, 0, 0];
      by.set(ch, [p[0] + (num(x.clicks) || 0), p[1] + (num(x.costMicros) || 0) / 1_000_000, p[2] + (num(x.conversions) || 0)]);
    }
    let conv: V["conv"] = null;
    try {
      const cr = await searchLeaf(cfg, customerId, `SELECT campaign.id, segments.conversion_action, metrics.conversions FROM campaign WHERE ${range} AND metrics.conversions > 0`);
      conv = [];
      for (const r of cr) {
        const id = String(asRec(r.campaign).id ?? "");
        const a = /conversionActions\/(\d+)/.exec(String(asRec(r.segments).conversionAction || ""))?.[1];
        const n = num(asRec(r.metrics).conversions) || 0;
        if (a && n) conv.push([camp.get(id) || "other", a, n]);
      }
    } catch { /* groups optional */ }
    return { all: [...by.entries()].map(([ch, [c, s, v2]]) => [ch, c, s, v2] as [string, number, number, number]), conv };
  }, 3600_000);
  const out: MRow[] = v.all.map(([channel, clicks, cost, conversions]) => ({ client_id: clientId, month: DAY, channel, conv_group: "_all", clicks, cost, conversions }));
  if (v.conv) {
    const { readConvActions } = await import("./google-conv-groups.server.ts");
    const acts = await readConvActions(clientId, false);
    if (!acts.error) {
      const gOf = new Map(acts.actions.map((a) => [a.id, a.group as string]));
      const sum = new Map<string, number>();
      for (const [ch, a, n] of v.conv) { const k = `${ch}|${gOf.get(a) || "other"}`; sum.set(k, (sum.get(k) || 0) + n); }
      for (const [channel] of v.all) for (const g of CONV_GROUPS) out.push({ client_id: clientId, month: DAY, channel, conv_group: g, clicks: null, cost: null, conversions: sum.get(`${channel}|${g}`) || 0 });
    }
  }
  return out;
}

// ── groups ────────────────────────────────────────────────────────────────────
/** Shared groups + the caller's own personal groups (never another user's). */
export async function listGroups(visible: (id: string) => boolean, me: string | null = null): Promise<CompareGroup[]> {
  const sql = await getSql();
  const gs = await sql.query<{ id: string; name: string; owner: string | null }>(
    `select id, name, owner from compare_groups where owner is null or owner = $1 order by owner nulls first, lower(name)`, [me || ""]).catch(() => []);
  const ms = await sql.query<{ group_id: string; client_id: string }>(`select group_id, client_id from compare_group_members`).catch(() => []);
  const by = new Map<string, string[]>();
  for (const m of ms) (by.get(String(m.group_id)) || by.set(String(m.group_id), []).get(String(m.group_id))!).push(m.client_id);
  return gs.map((g) => {
    const all = by.get(String(g.id)) || [];
    const mine = all.filter(visible);
    return { id: Number(g.id), name: g.name, members: mine, hidden_count: all.length - mine.length, personal: g.owner != null };
  });
}
export async function createGroup(name: string, members: string[], by: string, owner: string | null = null): Promise<number> {
  const sql = await getSql();
  const ex = await sql.query<{ id: string }>(`select id from compare_groups where lower(name) = lower($1) and coalesce(owner, '') = coalesce($2, '')`, [name, owner]);
  let id = ex[0]?.id;
  if (!id) id = (await sql.query<{ id: string }>(`insert into compare_groups (name, created_by, owner) values ($1, $2, $3) returning id`, [name, by, owner]))[0].id;
  if (members.length) await addMembers(Number(id), members, by);
  return Number(id);
}
/** Owner of a group (null = shared); undefined when it does not exist. */
export async function groupOwner(id: number): Promise<string | null | undefined> {
  const sql = await getSql();
  const r = await sql.query<{ owner: string | null }>(`select owner from compare_groups where id = $1`, [id]);
  return r.length ? r[0].owner : undefined;
}
export async function renameGroup(id: number, name: string) {
  const sql = await getSql();
  const ex = await sql.query<{ id: string }>(`select id from compare_groups g where lower(name) = lower($1) and id <> $2
    and coalesce(owner, '') = coalesce((select owner from compare_groups where id = $2), '')`, [name, id]);
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
  group: { id: number; name: string; personal?: boolean } | null; custom?: boolean; accounts: Array<{ client_id: string; label: string; customer_id_dashed: string | null }>;
  period: ComparePeriod; range?: CompareRange | null; channels: string[]; convGroups: string[]; canManage: boolean; canCompute: boolean;
}): Promise<CompareRead> {
  const th = await readThresholds();
  const w = window();
  const days = opts.period === "days" && opts.range ? opts.range : null;
  const months = days ? [DAY] : periodMonths(opts.period, opts.range);
  const trendMonths = [...w.months];
  const ids = opts.accounts.map((a) => a.client_id);
  const sql = await getSql();
  const want = [...new Set([...months.filter((m) => m !== DAY), ...trendMonths])];
  const rows: MRow[] = ids.length ? await sql.query<MRow>(
    `select client_id, month, channel, conv_group, clicks, cost, conversions from compare_monthly where client_id = any($1::text[]) and month = any($2::text[])`, [ids, want]).catch(() => []) : [];
  const st = ids.length ? await sql.query<{ client_id: string; conv_ok: boolean; error: string | null; computed_at: unknown }>(
    `select client_id, conv_ok, error, computed_at from compare_state where client_id = any($1::text[])`, [ids]).catch(() => []) : [];
  const stBy = new Map<string, { client_id: string; conv_ok: boolean; error: string | null; computed_at: unknown }>(st.map((s) => [s.client_id, s]));
  // Day range: live per account (only accounts already scope-filtered by the caller), 4 at a time, ~50 s budget.
  const liveErr = new Map<string, string>();
  if (days) {
    const deadline = Date.now() + 50_000;
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++];
        if (Date.now() > deadline) { liveErr.set(id, "Hết thời gian tải, thử lại."); continue; }
        try {
          const rs = await liveDayRows(id, days.from, days.to);
          rows.push(...rs);
          const prev = stBy.get(id);
          stBy.set(id, { client_id: id, conv_ok: rs.some((r) => r.conv_group !== "_all"), error: null, computed_at: prev?.computed_at ?? null });
        } catch (e) { liveErr.set(id, e instanceof Error ? e.message : String(e)); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
  }
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
  const present = new Map<string, Set<string>>();
  for (const r of rows) if (r.conv_group === "_all") (present.get(r.client_id) || present.set(r.client_id, new Set()).get(r.client_id)!).add(r.month);
  const mL = (m: string) => `T${Number(m.slice(5))}/${m.slice(2, 4)}`;
  const out: CompareRow[] = opts.accounts.map((a) => {
    // Sums of spend / clicks / conversions over the range; ratios are derived from the sums (never averaged).
    const r = agg(a.client_id, months);
    const m = derive(r);
    const s = stBy.get(a.client_id);
    const have = present.get(a.client_id) || new Set<string>();
    const lack = days ? [] : months.filter((mo) => !have.has(mo));
    const note = days ? liveErr.get(a.client_id) || null : lack.length && lack.length < months.length ? `Thiếu số ${lack.map(mL).join(", ")}` : null;
    return {
      client_id: a.client_id, platform: platformOf(a.client_id) || "google", label: a.label, customer_id_dashed: a.customer_id_dashed,
      m, has_data: r.any, low_data: r.any && ((r.conversions ?? 0) < th.conv || (r.clicks ?? 0) < th.clicks),
      computed_at: iso(s?.computed_at), error: days ? liveErr.get(a.client_id) || null : s?.error || null, note,
      trend: trendMonths.map((mo) => ({ month: mo, m: derive(agg(a.client_id, [mo])) })),
    };
  });
  const gl = groupLevel(out);
  return {
    group: opts.group, custom: opts.custom || false, period: opts.period, months: days ? [] : months, trend_months: trendMonths,
    range: opts.range || null, fetched_at: days ? new Date().toISOString() : null,
    period_note: days ? `Số liệu trực tiếp từ Google Ads (chỉ đọc), lưu đệm 1 giờ.` : opts.period === "months" ? `Chỉ có số liệu tháng đã tính sẵn (${[...w.months, w.cur].map(mL).join(", ")}); tháng khác hiện “-”.` : null, rows: out, median: gl.median, weighted: gl.weighted,
    thresholds: { conv: th.conv, clicks: th.clicks }, channels: [...chans].sort(), can_manage: opts.canManage, can_compute: opts.canCompute, conv_note: convNote,
  };
}
