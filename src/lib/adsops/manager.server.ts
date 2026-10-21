/** "Bảng điều hành": reads only stored AdsOps data (no Google / Meta calls). */
import { getSql } from "@/lib/db";
import { addDaysYmd, ymdInTz } from "./warehouse.server.ts";
import { dailySpend, pacingFor, readPlans, type Day } from "./budget-plan.server.ts";
import { accountOutcome, readEntries } from "./outcomes.server.ts";
import { readAccountsOverview } from "./accounts-overview.server.ts";
import { readActivity } from "./account-activity.server.ts";
import { REASON_NO_SPEND, REASON_NO_SPEND_10 } from "./account-activity.types.ts";
import {
  CHURN_RULES as R, HEALTH_GREEN, HEALTH_LABEL, HEALTH_WEIGHTS, HEALTH_YELLOW,
  type AccountRef, type ChurnRow, type ClientSpend, type HealthComponent, type HealthRow, type Kpis, type ManagerRead,
} from "./manager.types.ts";
import type { BudgetPlan } from "./budget-plan.types.ts";

const TZ = "Asia/Ho_Chi_Minh";
type Acc = { client_id: string; label: string; customer_id_dashed: string };
const isFb = (id: string) => id.startsWith("fb_");
const isOa = (id: string) => id.startsWith("oa_");
const isTt = (id: string) => id.startsWith("tt_");
/** Google = neither Facebook nor ChatGPT Ads. */
const isG = (id: string) => !isFb(id) && !isOa(id) && !isTt(id);
const dmy = (s: string) => s.split("-").reverse().join("/");
const daysIn = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
const mEnd = (m: string) => `${m}-${String(daysIn(m)).padStart(2, "0")}`;
function mAdd(m: string, n: number) { let [y, mo] = m.split("-").map(Number); mo += n; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return `${y}-${String(mo).padStart(2, "0")}`; }
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const fmtD = (v: number) => `${Math.round(v).toLocaleString("vi-VN")}đ`;

export function resolvePeriod(start: string | null, end: string | null) {
  const today = ymdInTz(TZ);
  if (start && end && start <= end) {
    const len = dayDiff(start, end) + 1;
    const whole = start.endsWith("-01") && end === mEnd(start.slice(0, 7));
    const prev = whole ? { start: `${mAdd(start.slice(0, 7), -1)}-01`, end: mEnd(mAdd(start.slice(0, 7), -1)) } : { start: addDaysYmd(start, -len), end: addDaysYmd(start, -1) };
    return { period: { start, end, label: `${dmy(start)} – ${dmy(end)}`, mtd: false }, prev: { ...prev, label: `${dmy(prev.start)} – ${dmy(prev.end)}` } };
  }
  // MTD (today included, data may lag) vs the same days of last month.
  const m = today.slice(0, 7), pm = mAdd(m, -1);
  const day = Number(today.slice(8, 10));
  const pEnd = `${pm}-${String(Math.min(day, daysIn(pm))).padStart(2, "0")}`;
  return { period: { start: `${m}-01`, end: today, label: `Tháng ${m.slice(5)}/${m.slice(0, 4)} đến nay`, mtd: true }, prev: { start: `${pm}-01`, end: pEnd, label: `cùng kỳ tháng ${pm.slice(5)}/${pm.slice(0, 4)}` } };
}

type Sum = { spend: number | null; leads: number | null };
function sumDays(list: Day[] | undefined, from: string, to: string): Sum {
  const l = (list || []).filter((d) => d.date >= from && d.date <= to);
  const cv = l.filter((d) => d.conv != null);
  return { spend: l.length ? l.reduce((a, d) => a + d.cost, 0) : null, leads: cv.length ? cv.reduce((a, d) => a + (d.conv || 0), 0) : null };
}
function addSum(a: Sum, b: Sum): Sum {
  return { spend: b.spend == null ? a.spend : (a.spend || 0) + b.spend, leads: b.leads == null ? a.leads : (a.leads || 0) + b.leads };
}
const cplOf = (s: Sum) => (s.spend && s.leads && s.leads > 0 ? s.spend / s.leads : null);
/** Group target CPL: single plan target, else Σbudget ÷ Σtarget leads when every account has both. */
function targetCpl(ids: string[], plans: Map<string, BudgetPlan>): number | null {
  const pl = ids.map((i) => plans.get(i));
  if (ids.length === 1) return pl[0]?.target_cpl ?? null;
  if (pl.every((p) => p && p.target_conv)) return pl.reduce((a, p) => a + p!.planned_budget, 0) / pl.reduce((a, p) => a + (p!.target_conv || 0), 0);
  return null;
}
function targetRoas(ids: string[], plans: Map<string, BudgetPlan>): number | null {
  const v = ids.map((i) => plans.get(i)?.target_roas ?? null);
  if (v.some((x) => x == null)) return null;
  return v.every((x) => x === v[0]) ? v[0] : null;
}

export async function readManager(accounts: Acc[], startIn: string | null, endIn: string | null): Promise<ManagerRead> {
  const { period, prev } = resolvePeriod(startIn, endIn);
  const ids = accounts.map((a) => a.client_id);
  const label = new Map(accounts.map((a) => [a.client_id, a.label]));
  const today = ymdInTz(TZ);
  const curM = today.slice(0, 7);
  const trendMonths = Array.from({ length: 6 }, (_, i) => mAdd(curM, i - 5));
  const from = [prev.start, `${trendMonths[0]}-01`, addDaysYmd(period.start, -60)].sort()[0];
  const to = period.end > today ? period.end : today;
  const sql = await getSql();

  // Client groups (Khách hàng mapping); accounts without a group stand alone.
  const gRows = ids.length ? await sql.query<{ id: string; customer_id: string | null; name: string | null }>(
    `select a.id, a.customer_id, c.name from ad_accounts a left join customers c on c.id = a.customer_id where a.id = any($1::text[])`, [ids],
  ).catch(() => []) : [];
  const groupOf = new Map(gRows.filter((r) => r.customer_id).map((r) => [r.id, { key: `g:${r.customer_id}`, name: r.name || r.customer_id! }]));
  const groups = new Map<string, { key: string; label: string; ids: string[] }>();
  for (const id of ids) {
    const g = groupOf.get(id);
    const key = g ? g.key : `a:${id}`;
    const e = groups.get(key) || { key, label: g ? g.name : label.get(id) || id, ids: [] };
    e.ids.push(id); groups.set(key, e);
  }

  const lastFull = [mAdd(curM, -3), mAdd(curM, -2), mAdd(curM, -1)];
  const [days, activity, overview, plansCur, ...plansPast] = await Promise.all([
    dailySpend(ids, from, to), readActivity(ids).catch(() => new Map()), readAccountsOverview(accounts).catch(() => []),
    readPlans(ids, curM), ...lastFull.map((m) => readPlans(ids, m)),
  ]);
  const planBy = new Map<string, Map<string, BudgetPlan>>([[curM, plansCur], ...lastFull.map((m, i) => [m, plansPast[i]] as [string, Map<string, BudgetPlan>])]);
  const ov = new Map(overview.map((o) => [o.client_id, o]));
  let through: string | null = null;
  for (const l of days.values()) for (const d of l) if (!through || d.date > through) through = d.date;

  // ── KPIs ──
  const periodMonths = (() => { const out: string[] = []; let m = period.start.slice(0, 7); while (m <= period.end.slice(0, 7) && out.length < 24) { if (`${m}-01` >= period.start && mEnd(m) <= period.end) out.push(m); m = mAdd(m, 1); } return out; })();
  const entriesAll = await readEntries(ids, [...new Set([...periodMonths, ...lastFull, ...(() => { const o: string[] = []; let m = prev.start.slice(0, 7); while (m <= prev.end.slice(0, 7) && o.length < 24) { if (`${m}-01` >= prev.start && mEnd(m) <= prev.end) o.push(m); m = mAdd(m, 1); } return o; })()])]);
  const kpis = (s: string, e: string): Kpis => {
    let g: Sum = { spend: null, leads: null }, f: Sum = { spend: null, leads: null }, o: Sum = { spend: null, leads: null }, tk: Sum = { spend: null, leads: null };
    let act = 0;
    const activeGroups = new Set<string>();
    for (const id of ids) {
      const v = sumDays(days.get(id), s, e);
      if (isFb(id)) f = addSum(f, v); else if (isOa(id)) o = addSum(o, v); else if (isTt(id)) tk = addSum(tk, v); else g = addSum(g, v);
      if (v.spend && v.spend > 0) { act++; activeGroups.add(groupOf.get(id)?.key || id); }
    }
    const t = addSum(addSum(addSum(g, f), o), tk);
    // Revenue: whole months inside [s, e] with an outcome entered.
    let rev: number | null = null, revSpend = 0, n = 0;
    let m = s.slice(0, 7);
    const months: string[] = [];
    while (m <= e.slice(0, 7) && months.length < 24) { if (`${m}-01` >= s && mEnd(m) <= e) months.push(m); m = mAdd(m, 1); }
    for (const mm of months) for (const id of ids) {
      const o = accountOutcome(entriesAll, id, mm);
      if (o?.revenue == null) continue;
      rev = (rev || 0) + o.revenue; n++;
      revSpend += sumDays(days.get(id), `${mm}-01`, mEnd(mm)).spend || 0;
    }
    return {
      spend: { total: t.spend, google: g.spend, facebook: f.spend, chatgpt: o.spend, tiktok: tk.spend }, leads: t.leads, cpl: cplOf(t),
      active_accounts: act, active_clients: activeGroups.size,
      revenue: rev, roas: rev != null && revSpend > 0 ? rev / revSpend : null,
      revenue_basis: rev != null ? `${n} tài khoản-tháng đã nhập doanh thu` : months.length ? null : "Doanh thu nhập theo tháng: chỉ tính khi kỳ chứa trọn tháng.",
    };
  };
  const cur = kpis(period.start, period.end);
  const prevK = kpis(prev.start, prev.end);

  // New: first spend inside the period with stored days (no spend) in the 60 days before. Stopped: 10-day rule.
  const newAcc: AccountRef[] = [], stopped: AccountRef[] = [];
  for (const id of ids) {
    const l = days.get(id) || [];
    const before = l.filter((d) => d.date < period.start && d.date >= addDaysYmd(period.start, -60));
    const inP = sumDays(l, period.start, period.end);
    if (inP.spend && inP.spend > 0 && before.length >= 30 && before.every((d) => d.cost <= 0)) newAcc.push({ client_id: id, label: label.get(id) || id });
    const a = activity.get(id);
    const had = (sumDays(l, prev.start, period.end).spend || 0) > 0;
    if (a && a.state === "inactive" && (a.reason === REASON_NO_SPEND_10 || a.reason === REASON_NO_SPEND) && had) stopped.push({ client_id: id, label: label.get(id) || id });
  }

  const trend = trendMonths.map((m) => {
    let g: number | null = null, f: number | null = null, o: number | null = null, tk: number | null = null;
    for (const id of ids) { const v = sumDays(days.get(id), `${m}-01`, mEnd(m)).spend; if (v == null) continue; if (isFb(id)) f = (f || 0) + v; else if (isOa(id)) o = (o || 0) + v; else if (isTt(id)) tk = (tk || 0) + v; else g = (g || 0) + v; }
    return { month: m, google: g, facebook: f, chatgpt: o, tiktok: tk };
  });

  const clientSpend: ClientSpend[] = [...groups.values()].map((gr) => {
    let c: Sum = { spend: null, leads: null }, p: Sum = { spend: null, leads: null };
    for (const id of gr.ids) { c = addSum(c, sumDays(days.get(id), period.start, period.end)); p = addSum(p, sumDays(days.get(id), prev.start, prev.end)); }
    return { key: gr.key, label: gr.label, open_id: gr.ids[0], spend: c.spend, prev: p.spend, delta: c.spend != null && p.spend != null ? c.spend - p.spend : null, leads: c.leads, cpl: cplOf(c) };
  });
  const top = clientSpend.filter((c) => c.spend && c.spend > 0).sort((a, b) => b.spend! - a.spend!).slice(0, 10);
  const movers = clientSpend.filter((c) => c.delta != null && c.delta !== 0).sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!)).slice(0, 10);

  // ── Alerts (stored data only) ──
  const fbIds = ids.filter(isFb), gIds = ids.filter(isG);
  const alerts = new Map<string, string[]>();
  const addAlert = (id: string, s: string) => { const l = alerts.get(id) || []; l.push(s); alerts.set(id, l); };
  const metaReadable = new Set<string>();
  {
    const { metaAlertsFor } = await import("./meta-alerts.server.ts");
    await Promise.all(fbIds.map(async (id) => {
      const al = await metaAlertsFor(id, label.get(id) || id).catch(() => null);
      if (!al) return;
      metaReadable.add(id);
      for (const a of al) if (a.kind === "fatigue" || a.kind === "frequency" || a.kind === "learning_limited") addAlert(id, a.kind === "fatigue" ? "FB mỏi quảng cáo" : a.kind === "frequency" ? "FB tần suất cao" : "FB giới hạn học");
    }));
  }
  const lostIs = new Map<string, number>();
  if (gIds.length) {
    const rows = await sql.query<{ client_id: string; v: unknown }>(
      `select distinct on (client_id) client_id, (payload->'account'->>'is_lost_budget')::numeric as v from google_share_cache
        where client_id = any($1::text[]) and level = 'account' and end_date >= $2::date order by client_id, end_date desc, start_date asc`, [gIds, addDaysYmd(today, -35)],
    ).catch(() => []);
    for (const r of rows) if (r.v != null) lostIs.set(r.client_id, Number(r.v));
  }
  for (const id of gIds) {
    const o = ov.get(id);
    if (o?.runway.status === "red" || (o?.runway.runway_days != null && !o.runway.infinite && o.runway.runway_days < R.runwayDays)) addAlert(id, "Ngân sách còn < 3 ngày");
    const lb = lostIs.get(id);
    if (lb != null && lb >= 0.2) addAlert(id, `Mất ${Math.round(lb * 100)}% IS do ngân sách`);
  }

  // ── Health ──
  const pacing = await pacingFor(ids, curM, () => false).catch(() => []);
  const pace = new Map(pacing.map((p) => [p.client_id, p]));
  const lastMonth = lastFull[2];
  const health: HealthRow[] = [];
  const activeKeys = new Set(clientSpend.filter((c) => (c.spend || 0) > 0 || (c.prev || 0) > 0).map((c) => c.key));
  for (const gr of groups.values()) {
    if (!activeKeys.has(gr.key)) continue;
    const comps: HealthComponent[] = [];
    const push = (key: HealthComponent["key"], score: number | null, detail: string) => comps.push({ key, label: HEALTH_LABEL[key], weight: HEALTH_WEIGHTS[key], score: score == null ? null : Math.max(0, Math.min(100, Math.round(score))), detail });
    // CPL (month to date) vs target / 3-month own average.
    let mtd: Sum = { spend: null, leads: null }, avg3: Sum = { spend: null, leads: null };
    for (const id of gr.ids) { mtd = addSum(mtd, sumDays(days.get(id), `${curM}-01`, today)); avg3 = addSum(avg3, sumDays(days.get(id), `${lastFull[0]}-01`, mEnd(lastFull[2]))); }
    const c = cplOf(mtd), tgt = targetCpl(gr.ids, plansCur), base = cplOf(avg3);
    const ref = tgt ?? base;
    push("cpl", c != null && ref ? (c / ref <= 1 ? 100 : 100 - (c / ref - 1) * 200) : null, c == null ? "Chưa có CPL tháng này" : ref ? `CPL ${fmtD(c)} vs ${tgt ? "mục tiêu" : "TB 3 tháng"} ${fmtD(ref)}` : "Chưa có mục tiêu / lịch sử CPL");
    // Pacing.
    const ps = gr.ids.map((i) => pace.get(i)).filter((p) => p?.plan && p.status);
    push("pacing", ps.length ? ps.reduce((a, p) => a + (p!.status === "on_track" ? 100 : p!.status!.endsWith("warn") ? 60 : 20), 0) / ps.length : null, ps.length ? ps.map((p) => `${p!.pace != null ? `${p!.pace > 0 ? "+" : ""}${Math.round(p!.pace * 100)}%` : "—"}`).join(", ") : "Chưa đặt kế hoạch tháng");
    // Days since last optimization (Google change log).
    const opts = gr.ids.filter(isG).map((i) => ov.get(i)?.last_opt_at).filter((x): x is string => Boolean(x));
    const dSince = opts.length ? Math.min(...opts.map((x) => dayDiff(x.slice(0, 10), today))) : null;
    push("opt_days", dSince == null ? null : dSince <= 7 ? 100 : dSince <= 14 ? 60 : dSince <= 21 ? 30 : 0, dSince == null ? "Không có nhật ký tối ưu (Google)" : `${dSince} ngày`);
    // Open alerts.
    const al = gr.ids.flatMap((i) => alerts.get(i) || []);
    const alertKnown = gr.ids.some((i) => (isFb(i) ? metaReadable.has(i) : ov.get(i)?.runway.checked_at != null || lostIs.has(i)));
    push("alerts", alertKnown ? 100 - 25 * al.length : null, alertKnown ? (al.length ? al.join("; ") : "Không có cảnh báo") : "Chưa có dữ liệu cảnh báo");
    // Google optimization score.
    const sc = gr.ids.map((i) => ov.get(i)?.score.score).filter((x): x is number => x != null);
    push("opt_score", sc.length ? (sc.reduce((a, b) => a + b, 0) / sc.length) * 100 : null, sc.length ? `${Math.round((sc.reduce((a, b) => a + b, 0) / sc.length) * 100)}%` : "Không có điểm tối ưu");
    // Real ROAS last month vs target.
    const outs = gr.ids.map((i) => accountOutcome(entriesAll, i, lastMonth));
    const tr = targetRoas(gr.ids, planBy.get(lastMonth)!);
    let roas: number | null = null;
    if (outs.every((o) => o?.revenue != null)) { const sp = gr.ids.reduce((a, i) => a + (sumDays(days.get(i), `${lastMonth}-01`, mEnd(lastMonth)).spend || 0), 0); roas = sp > 0 ? outs.reduce((a, o) => a + o!.revenue!, 0) / sp : null; }
    push("roas", roas != null && tr ? Math.min(100, (roas / tr) * 100) : null, roas == null ? "Chưa nhập doanh thu tháng trước" : tr ? `ROAS ${roas.toFixed(2)}× vs mục tiêu ${tr}×` : `ROAS ${roas.toFixed(2)}× (chưa có mục tiêu)`);
    const have = comps.filter((x) => x.score != null);
    const wsum = have.reduce((a, x) => a + x.weight, 0);
    const score = wsum ? Math.round(have.reduce((a, x) => a + x.weight * x.score!, 0) / wsum) : null;
    health.push({
      key: gr.key, label: gr.label, open_id: gr.ids[0], accounts: gr.ids.map((i) => ({ client_id: i, label: label.get(i) || i })),
      score, color: score == null ? null : score >= HEALTH_GREEN ? "green" : score >= HEALTH_YELLOW ? "yellow" : "red",
      components: comps, missing: comps.filter((x) => x.score == null).map((x) => x.label),
    });
  }
  health.sort((a, b) => (a.score ?? 101) - (b.score ?? 101));

  // ── Churn risk ──
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const lastSun = addDaysYmd(today, -dow - 1);
  const weeks = [3, 2, 1, 0].map((k) => ({ start: addDaysYmd(lastSun, -6 - 7 * k), end: addDaysYmd(lastSun, -7 * k) })); // oldest → newest
  const repRows = await sql.query<{ scope_kind: string; scope_id: string; account_ids: string[]; sent_at: unknown }>(
    `select scope_kind, scope_id, account_ids, max(sent_at) as sent_at from adsops_client_reports where status = 'sent' group by scope_kind, scope_id, account_ids`,
  ).catch(() => []);
  const churn: ChurnRow[] = [];
  for (const gr of groups.values()) {
    const last35 = gr.ids.reduce((a, i) => a + (sumDays(days.get(i), addDaysYmd(today, -35), today).spend || 0), 0);
    if (!(last35 > 0)) continue;
    const reasons: string[] = [];
    let pts = 0;
    // 1) Week-over-week spend drops ≥20%, consecutive, ending last complete week.
    const ws = weeks.map((w) => gr.ids.reduce<number | null>((a, i) => { const v = sumDays(days.get(i), w.start, w.end).spend; return v == null ? a : (a || 0) + v; }, null));
    let drops = 0;
    for (let k = ws.length - 1; k > 0; k--) { const a = ws[k - 1], b = ws[k]; if (a == null || b == null || a <= 0) break; if (b <= a * (1 - R.spendDropPct)) drops++; else break; }
    if (drops >= R.spendDropWeeks) { pts += R.spendDropPoints; reasons.push(`Chi tiêu giảm ≥${R.spendDropPct * 100}% trong ${drops} tuần liên tiếp (${ws.slice(-drops - 1).map((v) => (v == null ? "—" : `${Math.round(v / 1e6)}tr`)).join(" → ")})`); }
    // 2) CPL over target in consecutive full months (newest backwards).
    let over = 0;
    for (let k = lastFull.length - 1; k >= 0; k--) {
      const m = lastFull[k];
      const s = gr.ids.reduce<Sum>((a, i) => addSum(a, sumDays(days.get(i), `${m}-01`, mEnd(m))), { spend: null, leads: null });
      const c = cplOf(s), t = targetCpl(gr.ids, planBy.get(m)!);
      if (c != null && t != null && c > t) over++; else break;
    }
    if (over >= R.cplMonths) { pts += R.cplPoints; reasons.push(`CPL vượt mục tiêu ${over} tháng liên tiếp`); }
    // 3) No optimization ≥14 days (Google accounts whose change log has been pulled).
    const gOv = gr.ids.filter(isG).map((i) => ov.get(i)).filter((o) => o && (o.last_opt_at || o.change_pulled_at));
    if (gOv.length) {
      const lastOpt = gOv.map((o) => o!.last_opt_at).filter((x): x is string => Boolean(x)).sort().pop() || null;
      const d = lastOpt ? dayDiff(lastOpt.slice(0, 10), today) : null;
      if (d == null || d >= R.noOptDays) { pts += R.noOptPoints; reasons.push(d == null ? "Chưa ghi nhận lần tối ưu nào trong Nhật ký" : `${d} ngày chưa tối ưu`); }
    }
    // 4) Budget runway < 3 days (latest check, not topped up since).
    const low = gr.ids.filter((i) => { const o = ov.get(i); return o && !o.runway.infinite && o.runway.runway_days != null && o.runway.runway_days < R.runwayDays; });
    if (low.length) { pts += R.runwayPoints; reasons.push(`Ngân sách còn < ${R.runwayDays} ngày, chưa nạp thêm: ${low.map((i) => label.get(i) || i).join(", ")}`); }
    // 5) Real ROAS below target in consecutive full months.
    let roasBad = 0;
    for (let k = lastFull.length - 1; k >= 0; k--) {
      const m = lastFull[k];
      const outs = gr.ids.map((i) => accountOutcome(entriesAll, i, m));
      const t = targetRoas(gr.ids, planBy.get(m)!);
      const sp = gr.ids.reduce((a, i) => a + (sumDays(days.get(i), `${m}-01`, mEnd(m)).spend || 0), 0);
      if (t != null && sp > 0 && outs.every((o) => o?.revenue != null) && outs.reduce((a, o) => a + o!.revenue!, 0) / sp < t) roasBad++; else break;
    }
    if (roasBad >= R.roasMonths) { pts += R.roasPoints; reasons.push(`ROAS thực dưới mục tiêu ${roasBad} tháng liên tiếp`); }
    // 6) No report sent in > 35 days (#74): any sent report covering one of these accounts.
    const sent = repRows.filter((r) => (r.account_ids || []).some((a) => gr.ids.includes(a))).map((r) => (r.sent_at instanceof Date ? r.sent_at.toISOString() : String(r.sent_at || ""))).filter(Boolean).sort().pop() || null;
    const noReport = !sent || Date.now() - Date.parse(sent) > R.reportDays * 864e5;
    if (noReport) { pts += R.reportPoints; reasons.push(sent ? `Chưa gửi báo cáo ${Math.floor((Date.now() - Date.parse(sent)) / 864e5)} ngày` : "Chưa từng gửi báo cáo khách hàng"); }
    if (!reasons.length) continue;
    churn.push({ key: gr.key, label: gr.label, open_id: gr.ids[0], level: pts >= 5 ? "high" : pts >= 3 ? "medium" : "low", points: pts, reasons, no_report: noReport, last_report_at: sent });
  }
  churn.sort((a, b) => b.points - a.points);

  const plansStart = period.start.slice(0, 7) === curM ? plansCur : await readPlans(ids, period.start.slice(0, 7));
  const accounts_detail: ManagerRead["accounts_detail"] = {};
  for (const id of ids) {
    const s = sumDays(days.get(id), period.start, period.end);
    const pc = pace.get(id);
    accounts_detail[id] = {
      label: label.get(id) || id, group_key: groupOf.get(id)?.key || `a:${id}`,
      spend: s.spend, leads: s.leads, cpl: cplOf(s), target_cpl: plansStart.get(id)?.target_cpl ?? null,
      pace_status: pc?.plan && pc.status ? pc.status : null, alerts: alerts.get(id) || [], last_opt_at: !isG(id) ? null : ov.get(id)?.last_opt_at ?? null,
    };
  }
  return { accounts_detail, period, prev, data_through: through, cur, prev_kpis: prevK, new_accounts: newAcc, stopped_accounts: stopped, trend, top_clients: top, movers, health, churn };
}
