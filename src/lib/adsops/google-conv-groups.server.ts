/**
 * Conversion-type breakdown for the Google 3-month trend. Read-only GAQL SELECT only.
 * segments.conversion_action can only carry conversions / all_conversions, so cost/clicks come from the trend query.
 */
import { getSql } from "@/lib/db";
import { resolveAdsConfig } from "./google-ads.server.ts";
import { asRec, customerIdFor, searchLeaf } from "./warehouse.server.ts";
import { num } from "./google-trend.server.ts";
import { cached, window } from "./google-trend-tree.server.ts";
import { autoGroup, CONV_GROUPS, type ConvActionRow, type ConvActionsRead, type ConvByMonth, type ConvGroup } from "./google-conv-groups.ts";

const strip = (s: unknown, p: string) => { const v = String(s || "").replace(p, ""); return v && v !== "UNSPECIFIED" && v !== "UNKNOWN" ? v : null; };
const actionId = (r: unknown) => { const m = /conversionActions\/(\d+)/.exec(String(r || "")); return m ? m[1] : ""; };

async function cfgReady() {
  const cfg = await resolveAdsConfig();
  if (!cfg.ready) throw new Error("Chưa cấu hình Google Ads API.");
  return cfg;
}

export async function readConvActions(clientId: string, canEdit: boolean): Promise<ConvActionsRead> {
  const customerId = customerIdFor(clientId);
  if (customerId.length !== 10) return { actions: [], can_edit: false, fetched_at: null, error: "Không phải tài khoản Google." };
  const w = window();
  type A = { id: string; name: string; category: string | null; type: string | null; status: string | null; primary: boolean };
  let list: A[]; let at: string;
  try {
    ({ v: list, at } = await cached(clientId, "convact", w.start, w.today, async () => {
      const rows = await searchLeaf(await cfgReady(), customerId,
        `SELECT conversion_action.id, conversion_action.name, conversion_action.category, conversion_action.type, conversion_action.status, conversion_action.primary_for_goal FROM conversion_action`);
      return rows.map((r) => {
        const a = asRec(r.conversionAction);
        return { id: String(a.id ?? ""), name: String(a.name ?? a.id ?? ""), category: strip(a.category, "CONVERSION_ACTION_CATEGORY_"), type: strip(a.type, "CONVERSION_ACTION_TYPE_"), status: strip(a.status, "CONVERSION_ACTION_STATUS_"), primary: a.primaryForGoal === true };
      }).filter((a) => a.id);
    }));
  } catch (e) {
    return { actions: [], can_edit: canEdit, fetched_at: null, error: e instanceof Error ? e.message : String(e) };
  }
  const sql = await getSql();
  const ov = await sql.query<{ conversion_action_id: string; group_key: string }>(
    `select conversion_action_id, group_key from google_conv_group_map where client_id = $1`, [clientId]).catch(() => []);
  const om = new Map(ov.map((o) => [o.conversion_action_id, o.group_key as ConvGroup]));
  const actions: ConvActionRow[] = list.map((a) => {
    const auto = autoGroup(a.name, a.category, a.type);
    const g = om.get(a.id);
    return { ...a, auto_group: auto, group: g && CONV_GROUPS.includes(g) ? g : auto, overridden: !!g && CONV_GROUPS.includes(g) };
  }).sort((x, y) => Number(y.primary) - Number(x.primary) || x.name.localeCompare(y.name, "vi"));
  return { actions, can_edit: canEdit, fetched_at: at, error: null };
}

export async function setConvGroup(clientId: string, actionIdV: string, group: ConvGroup | null, by: string): Promise<{ ok: true }> {
  const sql = await getSql();
  if (group == null) await sql.query(`delete from google_conv_group_map where client_id = $1 and conversion_action_id = $2`, [clientId, actionIdV]);
  else await sql.query(
    `insert into google_conv_group_map (client_id, conversion_action_id, group_key, updated_by) values ($1, $2, $3, $4)
     on conflict (client_id, conversion_action_id) do update set group_key = excluded.group_key, updated_by = excluded.updated_by, updated_at = now()`,
    [clientId, actionIdV, group, by]);
  return { ok: true };
}

export type ConvLeaves = { conv: Record<string, ConvByMonth>; vtc: Record<string, Record<string, number>> };

/** Per entity id: month → action → [conversions, all_conversions]; plus view-through per month (campaign only). */
export async function readConvLeaves(clientId: string, level: "campaign" | "ad_group" | "asset_group", campaignId?: string): Promise<ConvLeaves & { at: string }> {
  const customerId = customerIdFor(clientId);
  const w = window();
  const range = `segments.date BETWEEN '${w.start}' AND '${w.today}'`;
  const ent = level === "campaign" ? "campaign" : level === "ad_group" ? "adGroup" : "assetGroup";
  const scope = campaignId ? ` AND campaign.id = ${campaignId}` : "";
  const key = level === "campaign" ? "trend3m_conv" : `trend3m_${level === "ad_group" ? "agconv" : "asgconv"}_${campaignId}`;
  const { v, at } = await cached<ConvLeaves>(clientId, key, w.start, w.today, async () => {
    const cfg = await cfgReady();
    const rows = await searchLeaf(cfg, customerId,
      `SELECT ${level}.id, segments.month, segments.conversion_action, metrics.conversions, metrics.all_conversions FROM ${level} WHERE ${range}${scope} AND metrics.all_conversions > 0`);
    const conv: Record<string, ConvByMonth> = {};
    for (const r of rows) {
      const id = String(asRec((r as Record<string, unknown>)[ent]).id ?? "");
      const m = String(asRec(r.segments).month || "").slice(0, 7);
      const a = actionId(asRec(r.segments).conversionAction);
      if (!id || !a || !/^\d{4}-\d{2}$/.test(m)) continue;
      const x = asRec(r.metrics);
      const cell = ((conv[id] ||= {})[m] ||= {});
      const p = cell[a] || [0, 0];
      cell[a] = [p[0] + (num(x.conversions) || 0), p[1] + (num(x.allConversions) || 0)];
    }
    const vtc: Record<string, Record<string, number>> = {};
    if (level === "campaign") {
      try {
        const vr = await searchLeaf(cfg, customerId, `SELECT campaign.id, segments.month, metrics.view_through_conversions FROM campaign WHERE ${range}`);
        for (const r of vr) {
          const id = String(asRec(r.campaign).id ?? ""), m = String(asRec(r.segments).month || "").slice(0, 7);
          const n = num(asRec(r.metrics).viewThroughConversions);
          if (id && m && n != null) (vtc[id] ||= {})[m] = ((vtc[id] ||= {})[m] || 0) + n;
        }
      } catch { /* optional */ }
    }
    return { conv, vtc };
  });
  return { ...v, at };
}
