/**
 * "Báo cáo khách hàng": builds a snapshot from data AdsOps already stores (warehouse, Meta insights,
 * outcomes, plan, change log) plus cached hint reads. Read-only towards Google / Meta.
 */
import { createHash, randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { addDaysYmd, ymdInTz } from "./warehouse.server.ts";
import { dailySpend, readPlans, pacingFor } from "./budget-plan.server.ts";
import { accountOutcome, readEntries } from "./outcomes.server.ts";
import type { CampRow, Channel, ReportData, ReportListRow, ReportNotes, ReportOptions, Totals } from "./client-report.types.ts";

const TZ = "Asia/Ho_Chi_Minh";
const iso = (d: unknown) => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));
const ymd = (d: unknown) => (d == null ? null : d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const isFb = (id: string) => id.startsWith("fb_");
const isOa = (id: string) => id.startsWith("oa_");
const isTt = (id: string) => id.startsWith("tt_");
const isG = (id: string) => !isFb(id) && !isOa(id) && !isTt(id);
const platOf = (id: string): "google" | "facebook" | "chatgpt" | "tiktok" => (isFb(id) ? "facebook" : isOa(id) ? "chatgpt" : isTt(id) ? "tiktok" : "google");
const daysIn = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
const dmy = (s: string) => s.split("-").reverse().join("/");
const monthLast = (m: string) => `${m}-${String(daysIn(m)).padStart(2, "0")}`;
function prevMonthOf(m: string) { let [y, mo] = m.split("-").map(Number); mo -= 1; if (!mo) { mo = 12; y -= 1; } return `${y}-${String(mo).padStart(2, "0")}`; }
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

export type Period = { kind: "week" | "month" | "custom"; start: string; end: string };

/** Last complete week (Mon–Sun) or month in Vietnam time. */
export function lastComplete(kind: "week" | "month"): Period {
  const today = ymdInTz(TZ);
  if (kind === "month") { const m = prevMonthOf(today.slice(0, 7)); return { kind, start: `${m}-01`, end: monthLast(m) }; }
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0
  const end = addDaysYmd(today, -dow - 1);
  return { kind, start: addDaysYmd(end, -6), end };
}

export function periodLabel(p: Period): string {
  if (p.kind === "month" || (p.start.endsWith("-01") && p.end === monthLast(p.start.slice(0, 7)))) return `tháng ${p.start.slice(5, 7)}/${p.start.slice(0, 4)}`;
  if (p.kind === "week") return `tuần ${dmy(p.start)} – ${dmy(p.end)}`;
  return `giai đoạn ${dmy(p.start)} – ${dmy(p.end)}`;
}
export function prevPeriod(p: Period): Period {
  const whole = p.start.endsWith("-01") && p.end === monthLast(p.start.slice(0, 7));
  if (whole) { const m = prevMonthOf(p.start.slice(0, 7)); return { kind: p.kind, start: `${m}-01`, end: monthLast(m) }; }
  const len = dayDiff(p.start, p.end) + 1;
  return { kind: p.kind, start: addDaysYmd(p.start, -len), end: addDaysYmd(p.start, -1) };
}
/** Whole calendar months covered exactly by the period (outcomes are monthly). */
function wholeMonths(p: Period): string[] | null {
  if (!p.start.endsWith("-01")) return null;
  const out: string[] = [];
  let m = p.start.slice(0, 7);
  for (let i = 0; i < 12; i++) {
    out.push(m);
    if (monthLast(m) === p.end) return out;
    if (monthLast(m) > p.end) return null;
    const [y, mo] = m.split("-").map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  return null;
}

// ── Scopes ──────────────────────────────────────────────────────────────────────

export async function scopeAccounts(kind: "group" | "account", id: string): Promise<string[]> {
  if (kind === "account") return [id];
  const sql = await getSql();
  const rows = await sql.query<{ id: string }>(`select id from ad_accounts where customer_id = $1 order by id`, [id]).catch(() => []);
  return rows.map((r) => r.id);
}
export async function accountLabels(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const sql = await getSql();
  const rows = await sql.query<{ id: string; display_name: string | null; alias: string | null }>(
    `select id, display_name, alias from ad_accounts where id = any($1::text[])`, [ids],
  ).catch(() => []);
  return new Map(rows.map((r) => [r.id, (r.alias && r.alias.trim()) || r.display_name || r.id]));
}
export async function groupsFor(ids: string[]): Promise<{ id: string; name: string; members: string[] }[]> {
  if (!ids.length) return [];
  const sql = await getSql();
  const rows = await sql.query<{ customer_id: string; name: string | null; id: string }>(
    `select a.customer_id, c.name, a.id from ad_accounts a join customers c on c.id = a.customer_id where a.customer_id is not null`,
  ).catch(() => []);
  const by = new Map<string, { id: string; name: string; members: string[] }>();
  for (const r of rows) { const g = by.get(r.customer_id) || { id: r.customer_id, name: r.name || r.customer_id, members: [] }; g.members.push(r.id); by.set(r.customer_id, g); }
  const vis = new Set(ids);
  // A group is offered only when the viewer sees EVERY account in it (strict isolation).
  return [...by.values()].filter((g) => g.members.every((m) => vis.has(m)));
}
async function scopeName(kind: "group" | "account", id: string): Promise<string> {
  if (kind === "account") return (await accountLabels([id])).get(id) || id;
  const sql = await getSql();
  const r = await sql.query<{ name: string | null }>(`select name from customers where id = $1`, [id]).catch(() => []);
  return r[0]?.name || id;
}

// ── Builder ─────────────────────────────────────────────────────────────────────

async function totalsFor(ids: string[], p: Period): Promise<{ t: Totals; per: Map<string, { spend: number | null; leads: number | null }>; through: string | null }> {
  const days = await dailySpend(ids, p.start, p.end);
  const per = new Map<string, { spend: number | null; leads: number | null }>();
  let spend: number | null = null, leads: number | null = null, through: string | null = null;
  for (const id of ids) {
    const l = days.get(id) || [];
    const s = l.length ? l.reduce((a, d) => a + d.cost, 0) : null;
    const cv = l.filter((d) => d.conv != null);
    const ld = cv.length ? cv.reduce((a, d) => a + (d.conv || 0), 0) : null;
    per.set(id, { spend: s, leads: ld });
    if (s != null) spend = (spend || 0) + s;
    if (ld != null) leads = (leads || 0) + ld;
    for (const d of l) if (!through || d.date > through) through = d.date;
  }
  // Outcomes: only for whole months and only when every account has them (else blank, never partial sums).
  let valid: number | null = null, closed: number | null = null, revenue: number | null = null, has = false;
  const months = wholeMonths(p);
  if (months) {
    const entries = await readEntries(ids, months);
    const outs = ids.flatMap((id) => months.map((m) => accountOutcome(entries, id, m)));
    if (outs.length && outs.every(Boolean)) {
      has = true;
      const sum = (k: "valid_leads" | "closed_customers" | "revenue") => { const v = outs.map((o) => o![k]); return v.some((x) => x == null) ? null : (v as number[]).reduce((a, b) => a + b, 0); };
      valid = sum("valid_leads"); closed = sum("closed_customers"); revenue = sum("revenue");
    }
  }
  const sp = spend != null && spend > 0 ? spend : null;
  return {
    per, through,
    t: {
      spend, leads, valid, closed, revenue, has_outcome: has,
      cpl: sp && leads && leads > 0 ? sp / leads : null,
      cost_per_valid: sp && valid && valid > 0 ? sp / valid : null,
      roas: sp && revenue != null ? revenue / sp : null,
    },
  };
}

async function campaignsFor(ids: string[], p: Period): Promise<CampRow[]> {
  const sql = await getSql();
  const g = ids.filter(isG), f = ids.filter(isFb), o = ids.filter(isOa), tk = ids.filter(isTt);
  const out: CampRow[] = [];
  if (g.length) {
    const rows = await sql.query<{ name: string; cost: unknown; conv: unknown }>(
      `select coalesce(d->>'campaign_name', d->>'campaign_id') as name, sum((d->>'cost')::numeric) as cost, sum((d->>'conversions')::numeric) as conv
         from adsops_analytics_warehouse w, jsonb_array_elements(coalesce(w.payload->'daily'->'campaign', '[]'::jsonb)) d
        where w.client_id = any($1::text[]) and d->>'date' between $2 and $3 group by 1`, [g, p.start, p.end],
    ).catch(() => []);
    for (const r of rows) out.push({ platform: "google", name: String(r.name || "—"), spend: Number(r.cost || 0), leads: r.conv == null ? null : Number(r.conv), cpl: null });
  }
  if (f.length) {
    const rows = await sql.query<{ name: string; cost: unknown; leads: unknown; messages: unknown }>(
      `select coalesce(max(campaign_name), campaign_id) as name, sum(spend) as cost, sum(leads) as leads, sum(messages) as messages
         from meta_insights_daily where client_id = any($1::text[]) and level = 'campaign' and date between $2 and $3 group by campaign_id`, [f, p.start, p.end],
    ).catch(() => []);
    for (const r of rows) out.push({ platform: "facebook", name: String(r.name || "—"), spend: Number(r.cost || 0), leads: r.leads != null ? Number(r.leads) : r.messages != null ? Number(r.messages) : null, cpl: null });
  }
  if (o.length) {
    const rows = await sql.query<{ name: string; cost: unknown; conv: unknown }>(
      `select coalesce(max(e.name), i.entity_id) as name, sum(i.spend) as cost, sum(i.conversions) as conv
         from openai_insights_daily i left join openai_entities e on e.client_id = i.client_id and e.level = 'campaign' and e.entity_id = i.entity_id
        where i.client_id = any($1::text[]) and i.level = 'campaign' and i.date between $2 and $3 group by i.entity_id`, [o, p.start, p.end],
    ).catch(() => []);
    for (const r of rows) out.push({ platform: "chatgpt", name: String(r.name || "—"), spend: Number(r.cost || 0), leads: r.conv == null ? null : Number(r.conv), cpl: null });
  }
  if (tk.length) {
    const rows = await sql.query<{ name: string; cost: unknown; conv: unknown }>(
      `select coalesce(max(e.name), i.entity_id) as name, sum(i.spend) as cost, coalesce(sum(i.conversions), sum(i.leads)) as conv
         from tiktok_insights_daily i left join tiktok_entities e on e.client_id = i.client_id and e.level = 'campaign' and e.entity_id = i.entity_id
        where i.client_id = any($1::text[]) and i.level = 'campaign' and i.date between $2 and $3 group by i.entity_id`, [tk, p.start, p.end],
    ).catch(() => []);
    for (const r of rows) out.push({ platform: "tiktok", name: String(r.name || "—"), spend: Number(r.cost || 0), leads: r.conv == null ? null : Number(r.conv), cpl: null });
  }
  for (const c of out) c.cpl = c.leads && c.leads > 0 && c.spend > 0 ? c.spend / c.leads : null;
  return out.filter((c) => c.spend > 0);
}

async function appendixFor(ids: string[], p: Period) {
  const sql = await getSql();
  const g = ids.filter(isG), f = ids.filter(isFb), o = ids.filter(isOa), tk = ids.filter(isTt);
  let imp: number | null = null, clk: number | null = null, cost = 0;
  if (g.length) {
    const r = await sql.query<{ imp: unknown; clk: unknown; cost: unknown }>(
      `select sum((d->>'impressions')::numeric) as imp, sum((d->>'clicks')::numeric) as clk, sum((d->>'cost')::numeric) as cost
         from adsops_analytics_warehouse w, jsonb_array_elements(coalesce(w.payload->'daily'->'account', '[]'::jsonb)) d
        where w.client_id = any($1::text[]) and d->>'date' between $2 and $3`, [g, p.start, p.end],
    ).catch(() => []);
    if (r[0]?.imp != null) { imp = Number(r[0].imp); clk = Number(r[0].clk || 0); cost += Number(r[0].cost || 0); }
  }
  if (f.length) {
    const r = await sql.query<{ imp: unknown; clk: unknown; cost: unknown }>(
      `select sum(impressions) as imp, sum(clicks) as clk, sum(spend) as cost from meta_insights_daily where client_id = any($1::text[]) and level = 'account' and date between $2 and $3`, [f, p.start, p.end],
    ).catch(() => []);
    if (r[0]?.imp != null) { imp = (imp || 0) + Number(r[0].imp); clk = (clk || 0) + Number(r[0].clk || 0); cost += Number(r[0].cost || 0); }
  }
  if (o.length) {
    const r = await sql.query<{ imp: unknown; clk: unknown; cost: unknown }>(
      `select sum(impressions) as imp, sum(clicks) as clk, sum(spend) as cost from openai_insights_daily where client_id = any($1::text[]) and level = 'account' and date between $2 and $3`, [o, p.start, p.end],
    ).catch(() => []);
    if (r[0]?.imp != null) { imp = (imp || 0) + Number(r[0].imp); clk = (clk || 0) + Number(r[0].clk || 0); cost += Number(r[0].cost || 0); }
  }
  if (tk.length) {
    const r = await sql.query<{ imp: unknown; clk: unknown; cost: unknown }>(
      `select sum(impressions) as imp, sum(clicks) as clk, sum(spend) as cost from tiktok_insights_daily where client_id = any($1::text[]) and level = 'account' and date between $2 and $3`, [tk, p.start, p.end],
    ).catch(() => []);
    if (r[0]?.imp != null) { imp = (imp || 0) + Number(r[0].imp); clk = (clk || 0) + Number(r[0].clk || 0); cost += Number(r[0].cost || 0); }
  }
  return {
    impressions: imp, clicks: clk,
    cpm: imp && imp > 0 ? (cost / imp) * 1000 : null,
    ctr: imp && imp > 0 && clk != null ? clk / imp : null,
    cpc: clk && clk > 0 ? cost / clk : null,
  };
}

/** Keywords / negatives added in the period, and an ESTIMATE of savings from negatives. */
async function workFor(ids: string[], p: Period): Promise<ReportData["work"]> {
  const g = ids.filter(isG);
  if (!g.length) return null;
  const sql = await getSql();
  const ev = await sql.query<{ action: string; keyword_text: string | null; match_type: string | null }>(
    `select action, keyword_text, match_type from ads_change_events
      where client_id = any($1::text[]) and action in ('add_keyword', 'add_negative', 'shared_negative_added')
        and (change_date_time at time zone 'Asia/Ho_Chi_Minh')::date between $2::date and $3::date`, [g, p.start, p.end],
  ).catch(() => []);
  const negs = ev.filter((e) => e.action !== "add_keyword" && e.keyword_text).map((e) => ({ text: e.keyword_text!.toLowerCase().replace(/[[\]"+]/g, "").trim(), mt: String(e.match_type || "").toUpperCase() }));
  // Wasted spend (no conversions) of the search terms these negatives block, in the period BEFORE.
  const pr = prevPeriod(p);
  let est: number | null = null, terms = 0;
  if (negs.length) {
    const rows = await sql.query<{ q: string; cost: unknown; conv: unknown }>(
      `select lower(d->>'query') as q, sum((d->>'cost')::numeric) as cost, sum(coalesce((d->>'conversions')::numeric, 0)) as conv
         from adsops_analytics_warehouse w, jsonb_array_elements(coalesce(w.payload->'daily'->'search_term', '[]'::jsonb)) d
        where w.client_id = any($1::text[]) and d->>'date' between $2 and $3 group by 1`, [g, pr.start, pr.end],
    ).catch(() => null);
    if (rows && rows.length) {
      est = 0;
      for (const r of rows) {
        if (Number(r.conv || 0) > 0) continue;
        const q = String(r.q || "");
        const words = q.split(/\s+/);
        const hit = negs.some((n) => n.mt.includes("EXACT") ? q === n.text : n.mt.includes("PHRASE") ? (` ${q} `).includes(` ${n.text} `) : n.text.split(/\s+/).every((w) => words.includes(w)));
        if (hit) { est += Number(r.cost || 0); terms++; }
      }
    }
  }
  return {
    keywords_added: ev.filter((e) => e.action === "add_keyword").length,
    negatives_added: ev.length - ev.filter((e) => e.action === "add_keyword").length,
    est_savings: est, est_terms: terms,
    est_basis: `Chi phí không ra chuyển đổi của các cụm tìm kiếm bị chặn, trong ${periodLabel(pr)}`,
  };
}

/** Hints from stored / cached data (each best-effort; a failing source adds nothing). */
async function hintsFor(ids: string[], labels: Map<string, string>, p: Period) {
  const out: string[] = [];
  let is: number | null = null, lost: number | null = null, qs: number | null = null;
  const many = ids.length > 1;
  const tag = (id: string) => (many ? `${labels.get(id) || id}: ` : "");
  const timeout = <T,>(pr: Promise<T>, ms = 12_000) => Promise.race([pr, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
  await Promise.all(ids.map(async (id) => {
    if (isOa(id) || isTt(id)) return; // ChatGPT / TikTok Ads: no stored alert/share/QS signals yet.
    if (isFb(id)) {
      const { metaAlertsFor } = await import("./meta-alerts.server.ts");
      const al = (await timeout(metaAlertsFor(id, labels.get(id) || id).catch(() => [])) || []);
      const fat = al.filter((a) => a.kind === "fatigue").length, freq = al.filter((a) => a.kind === "frequency").length, lim = al.filter((a) => a.kind === "learning_limited").length;
      if (fat) out.push(`${tag(id)}${fat} quảng cáo Facebook có dấu hiệu "mỏi" (CTR giảm, CPM tăng) — cần làm mới nội dung.`);
      if (freq) out.push(`${tag(id)}${freq} nhóm quảng cáo có tần suất hiển thị cao — cân nhắc mở rộng tệp.`);
      if (lim) out.push(`${tag(id)}${lim} nhóm quảng cáo bị giới hạn học — cân nhắc gộp nhóm / tăng ngân sách.`);
      return;
    }
    const sh = await timeout((async () => (await import("./google-share.server.ts")).readShares(id, "campaign", { start: p.start, end: p.end }))().catch(() => null));
    if (sh?.account) {
      if (!many) { is = sh.account.is ?? null; lost = sh.account.is_lost_budget ?? null; }
      const lb = sh.account.is_lost_budget;
      if (lb != null && lb >= 0.2) out.push(`${tag(id)}Google mất ${Math.round(lb * 100)}% lượt hiển thị do giới hạn ngân sách — có thể tăng ngân sách cho chiến dịch hiệu quả.`);
    }
    const q = await timeout((async () => (await import("./google-qs.server.ts")).readQs(id, p.start, p.end))().catch(() => null));
    if (q) {
      if (!many) qs = q.weighted_qs;
      if (q.low.length) out.push(`${tag(id)}${q.low.length} từ khoá có điểm chất lượng thấp (≤ 4) — cần cải thiện mẫu quảng cáo / trang đích.`);
    }
  }));
  // Pacing for the current month (only meaningful while the month runs).
  const month = ymdInTz(TZ).slice(0, 7);
  if (p.end.slice(0, 7) === month) {
    const rows = await pacingFor(ids, month, () => false).catch(() => []);
    for (const r of rows) {
      if (r.status && r.pace != null && Math.abs(r.pace) > 0.25) out.push(`${tag(r.client_id)}Chi tiêu đang ${r.pace > 0 ? "vượt" : "chậm hơn"} kế hoạch tháng ${Math.round(Math.abs(r.pace) * 100)}%.`);
    }
  }
  return { suggestions: out, is, lost, qs };
}

export async function buildReport(scopeKind: "group" | "account", scopeId: string, ids: string[], p: Period): Promise<ReportData> {
  const pr = prevPeriod(p);
  const labels = await accountLabels(ids);
  const [cur, prev, camps, app, work, hints, name] = await Promise.all([
    totalsFor(ids, p), totalsFor(ids, pr), campaignsFor(ids, p), appendixFor(ids, p), workFor(ids, p).catch(() => null), hintsFor(ids, labels, p), scopeName(scopeKind, scopeId),
  ]);
  const ch = (plat: "google" | "facebook" | "chatgpt" | "tiktok"): Channel | null => {
    const list = ids.filter((i) => platOf(i) === plat);
    if (!list.length) return null;
    let s: number | null = null, l: number | null = null;
    for (const i of list) { const v = cur.per.get(i); if (v?.spend != null) s = (s || 0) + v.spend; if (v?.leads != null) l = (l || 0) + v.leads; }
    return { spend: s, leads: l, cpl: s && l && l > 0 ? s / l : null };
  };
  // Targets from the monthly plan (month of the period start).
  const plans = await readPlans(ids, p.start.slice(0, 7));
  const pl = ids.map((i) => plans.get(i));
  const all = pl.every(Boolean);
  const one = ids.length === 1 ? pl[0] : null;
  const months = wholeMonths(p);
  const targets = {
    cpl: one?.target_cpl ?? (all && pl.every((x) => x!.target_conv) ? pl.reduce((a, x) => a + x!.planned_budget, 0) / pl.reduce((a, x) => a + (x!.target_conv || 0), 0) : null),
    cac: one?.target_cac ?? null,
    roas: one?.target_roas ?? null,
    leads: months?.length === 1 && all && pl.every((x) => x!.target_conv != null) ? pl.reduce((a, x) => a + (x!.target_conv || 0), 0) : null,
    budget: months?.length === 1 && all ? pl.reduce((a, x) => a + x!.planned_budget, 0) : null,
  };
  const ranked = camps.filter((c) => c.cpl != null).sort((a, b) => a.cpl! - b.cpl!);
  const top = ranked.slice(0, 3);
  const bottom = ranked.length > 3 ? ranked.slice(-Math.min(3, ranked.length - 3)).reverse() : [];
  const noLead = camps.filter((c) => c.leads != null && c.leads === 0).sort((a, b) => b.spend - a.spend).slice(0, 3);
  const notes: string[] = [];
  if (cur.through && cur.through < p.end) notes.push(`Số liệu quảng cáo đến ngày ${dmy(cur.through)}.`);
  const missing = ids.filter((i) => cur.per.get(i)?.spend == null);
  if (missing.length && missing.length < ids.length) notes.push(`Chưa có số liệu chi tiêu: ${missing.map((i) => labels.get(i) || i).join(", ")}.`);
  if (!months) notes.push("Lead hợp lệ / khách chốt / doanh thu được nhập theo tháng nên chỉ hiện khi báo cáo trọn tháng.");
  else if (!cur.t.has_outcome) notes.push("Chưa nhập đủ số liệu kinh doanh (lead hợp lệ, khách chốt, doanh thu) cho kỳ này.");
  return {
    version: 1, client_name: name,
    period: { ...p, label: periodLabel(p) }, prev: { ...pr, label: periodLabel(pr) },
    accounts: ids.map((i) => ({ client_id: i, label: labels.get(i) || i, platform: platOf(i) })),
    data_through: cur.through, cur: cur.t, prev_totals: prev.t, targets,
    channels: { google: ch("google"), facebook: ch("facebook"), chatgpt: ch("chatgpt"), tiktok: ch("tiktok") },
    campaigns: { top, bottom, no_lead: noLead },
    work, suggestions: hints.suggestions,
    appendix: { ...app, is: hints.is, is_lost_budget: hints.lost, qs: hints.qs },
    notes_data: notes, generated_at: new Date().toISOString(),
  };
}

/** First-time notes: good points from the numbers, issues from hints (editable by the lead). */
export function prefillNotes(d: ReportData): ReportNotes {
  const good: string[] = [];
  const c = d.cur, p = d.prev_totals;
  if (c.cpl != null && p.cpl != null && c.cpl < p.cpl) good.push(`CPL giảm ${Math.round((1 - c.cpl / p.cpl) * 100)}% so với kỳ trước.`);
  if (c.cpl != null && d.targets.cpl != null && c.cpl <= d.targets.cpl) good.push("CPL đạt mục tiêu.");
  if (c.leads != null && p.leads != null && p.leads > 0 && c.leads > p.leads) good.push(`Số lead tăng ${Math.round((c.leads / p.leads - 1) * 100)}% so với kỳ trước.`);
  if (d.campaigns.top[0]) good.push(`Chiến dịch hiệu quả nhất: ${d.campaigns.top[0].name}.`);
  return { good: good.map((x) => `• ${x}`).join("\n"), issues: d.suggestions.map((x) => `• ${x}`).join("\n"), plan: "", edited: false };
}

// ── Storage ─────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const listRow = (r: Row, links: ReportListRow["links"]): ReportListRow => ({
  id: Number(r.id), scope_kind: r.scope_kind as "group" | "account", scope_id: String(r.scope_id), title: String(r.title),
  period_kind: String(r.period_kind), start_date: String(r.start_date), end_date: String(r.end_date),
  status: r.status === "sent" ? "sent" : "draft", generated: r.data != null || Boolean(r.generated_at), auto: Boolean(r.auto),
  sent_at: iso(r.sent_at), created_by: (r.created_by as string) || null, updated_at: iso(r.updated_at), links,
});

/** Reports whose accounts are ALL visible to the viewer. */
export async function listReports(canSee: (id: string) => boolean, opts: { status?: "sent" } = {}): Promise<ReportListRow[]> {
  const sql = await getSql();
  const rows = await sql.query<Row>(
    `select id, scope_kind, scope_id, title, period_kind, start_date, end_date, account_ids, status, auto, sent_at, created_by, updated_at, generated_at
       from adsops_client_reports ${opts.status ? "where status = 'sent'" : ""} order by start_date desc, id desc limit 500`,
  ).catch(() => []);
  const vis = rows.filter((r) => (r.account_ids as string[]).length && (r.account_ids as string[]).every(canSee));
  const ids = vis.map((r) => Number(r.id));
  const links = ids.length ? await sql.query<Row>(`select id, report_id, expires_at, revoked_at, views from adsops_report_links where report_id = any($1::bigint[]) order by id desc`, [ids]).catch(() => []) : [];
  return vis.map((r) => listRow(r, links.filter((l) => Number(l.report_id) === Number(r.id)).map((l) => ({ id: Number(l.id), expires_at: iso(l.expires_at)!, revoked: l.revoked_at != null, views: Number(l.views || 0) }))));
}

export type FullReport = { row: ReportListRow; account_ids: string[]; data: ReportData | null; notes: ReportNotes; options: ReportOptions };
export async function getReport(id: number): Promise<FullReport | null> {
  const sql = await getSql();
  const r = (await sql.query<Row>(`select * from adsops_client_reports where id = $1`, [id]).catch(() => []))[0];
  if (!r) return null;
  return { row: listRow(r, []), account_ids: r.account_ids as string[], data: (r.data as ReportData) || null, notes: (r.notes as ReportNotes) || {}, options: (r.options as ReportOptions) || {} };
}

export async function createReport(input: { scope_kind: "group" | "account"; scope_id: string; ids: string[]; period: Period; auto?: boolean }, by: string | null): Promise<number | null> {
  const sql = await getSql();
  const title = `${await scopeName(input.scope_kind, input.scope_id)} — ${periodLabel(input.period)}`;
  const r = await sql.query<{ id: string }>(
    `insert into adsops_client_reports (scope_kind, scope_id, title, period_kind, start_date, end_date, account_ids, auto, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing returning id`,
    [input.scope_kind, input.scope_id, title, input.period.kind, input.period.start, input.period.end, input.ids, Boolean(input.auto), by],
  );
  return r[0] ? Number(r[0].id) : null;
}

/** (Re)generate the snapshot. Notes are prefilled only until a person edits them. */
export async function generate(id: number): Promise<FullReport | null> {
  const rep = await getReport(id);
  if (!rep) return null;
  const data = await buildReport(rep.row.scope_kind, rep.row.scope_id, rep.account_ids, { kind: rep.row.period_kind as Period["kind"], start: rep.row.start_date, end: rep.row.end_date });
  const notes = rep.notes.edited ? rep.notes : prefillNotes(data);
  const sql = await getSql();
  await sql.query(`update adsops_client_reports set data = $2, notes = $3, generated_at = now(), updated_at = now() where id = $1`, [id, JSON.stringify(data), JSON.stringify(notes)]);
  return { ...rep, data, notes };
}

export async function updateReport(id: number, patch: { notes?: ReportNotes; options?: ReportOptions; status?: "draft" | "sent" }, by: string): Promise<void> {
  const sql = await getSql();
  if (patch.notes) await sql.query(`update adsops_client_reports set notes = $2, updated_at = now() where id = $1`, [id, JSON.stringify({ ...patch.notes, edited: true })]);
  if (patch.options) await sql.query(`update adsops_client_reports set options = $2, updated_at = now() where id = $1`, [id, JSON.stringify(patch.options)]);
  if (patch.status === "sent") await sql.query(`update adsops_client_reports set status = 'sent', sent_at = now(), sent_by = $2, updated_at = now() where id = $1`, [id, by]);
  if (patch.status === "draft") await sql.query(`update adsops_client_reports set status = 'draft', sent_at = null, sent_by = null, updated_at = now() where id = $1`, [id]);
}

export async function deleteReport(id: number): Promise<void> {
  const sql = await getSql();
  await sql.query(`delete from adsops_client_reports where id = $1`, [id]);
}

const hash = (t: string) => createHash("sha256").update(t).digest("hex");
export async function createLink(reportId: number, days: number, by: string): Promise<{ token: string; expires_at: string }> {
  const token = randomBytes(24).toString("base64url");
  const sql = await getSql();
  const r = await sql.query<{ expires_at: unknown }>(
    `insert into adsops_report_links (report_id, token_hash, expires_at, created_by) values ($1, $2, now() + make_interval(days => $3), $4) returning expires_at`,
    [reportId, hash(token), days, by],
  );
  return { token, expires_at: iso(r[0].expires_at)! };
}
export async function revokeLink(reportId: number, linkId: number): Promise<void> {
  const sql = await getSql();
  await sql.query(`update adsops_report_links set revoked_at = now() where id = $1 and report_id = $2 and revoked_at is null`, [linkId, reportId]);
}
/** Token → report id (valid, not revoked, not expired). Counts the view. */
export async function resolveToken(token: string): Promise<number | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const sql = await getSql();
  const r = await sql.query<{ report_id: string }>(
    `update adsops_report_links set views = views + 1, last_viewed_at = now()
      where token_hash = $1 and revoked_at is null and expires_at > now() returning report_id`, [hash(token)],
  ).catch(() => []);
  return r[0] ? Number(r[0].report_id) : null;
}

// ── Schedules (daily cron: insert DRAFT placeholders only; data is built on first open) ──

export async function readSchedules(): Promise<Map<string, "weekly" | "monthly">> {
  const sql = await getSql();
  const rows = await sql.query<{ scope_kind: string; scope_id: string; frequency: string }>(`select scope_kind, scope_id, frequency from adsops_report_schedules where enabled`).catch(() => []);
  return new Map(rows.map((r) => [`${r.scope_kind}:${r.scope_id}`, r.frequency as "weekly" | "monthly"]));
}
export async function setSchedule(kind: "group" | "account", id: string, freq: "weekly" | "monthly" | null, by: string): Promise<void> {
  const sql = await getSql();
  if (!freq) { await sql.query(`delete from adsops_report_schedules where scope_kind = $1 and scope_id = $2`, [kind, id]); return; }
  await sql.query(
    `insert into adsops_report_schedules (scope_kind, scope_id, frequency, enabled, updated_by) values ($1,$2,$3,true,$4)
     on conflict (scope_kind, scope_id) do update set frequency = excluded.frequency, enabled = true, updated_by = excluded.updated_by, updated_at = now()`,
    [kind, id, freq, by],
  );
}
/** Cheap: a few SQL statements, no data reads. Safe inside the cron budget. */
export async function ensureScheduledDrafts(): Promise<{ created: number }> {
  const sql = await getSql();
  const rows = await sql.query<{ scope_kind: string; scope_id: string; frequency: string }>(`select scope_kind, scope_id, frequency from adsops_report_schedules where enabled`).catch(() => []);
  let created = 0;
  for (const s of rows) {
    const kind = s.scope_kind === "group" ? "group" : "account";
    const ids = await scopeAccounts(kind, s.scope_id);
    if (!ids.length) continue;
    const p = lastComplete(s.frequency === "monthly" ? "month" : "week");
    if (await createReport({ scope_kind: kind, scope_id: s.scope_id, ids, period: p, auto: true }, "cron").catch(() => null)) created++;
  }
  return { created };
}
export { ymd };
