/** Staff performance from stored data only. Shared accounts count for each assignee. */
import { getSql } from "@/lib/db";
import { addDaysYmd, ymdInTz } from "./warehouse.server.ts";
import { dailySpend, readPlans } from "./budget-plan.server.ts";
import { OPTIMIZED_ACTIONS } from "./change-log.types.ts";
import { readManager } from "./manager.server.ts";
import type { PerfNums, StaffAccount, StaffPerfRead, StaffRow } from "./staff-perf.types.ts";

type Acc = { client_id: string; label: string; customer_id_dashed: string };
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

export async function readStaffPerf(accounts: Acc[], start: string | null, end: string | null): Promise<StaffPerfRead> {
  const m = await readManager(accounts, start, end);
  const { period, prev } = m;
  const ids = accounts.map((a) => a.client_id);
  const vis = new Set(ids);
  const sql = await getSql();
  const today = ymdInTz("Asia/Ho_Chi_Minh");

  // Assignment: staff grants on accounts the viewer can see; optimizers listed even without grants.
  const staff = await sql.query<{ id: string; email: string; role: string; display_name: string | null }>(`select id, email, role, display_name from staff_users`).catch(() => []);
  const grants = await sql.query<{ principal_id: string; ad_account_id: string }>(`select principal_id, ad_account_id from account_grants where principal_kind = 'staff'`).catch(() => []);
  const byStaff = new Map<string, string[]>();
  for (const g of grants) if (vis.has(g.ad_account_id)) { const l = byStaff.get(g.principal_id) || []; l.push(g.ad_account_id); byStaff.set(g.principal_id, l); }
  const assignees = new Map<string, string[]>();
  for (const [sid, l] of byStaff) for (const a of l) { const x = assignees.get(a) || []; x.push(sid); assignees.set(a, x); }
  const people = staff.filter((s) => byStaff.has(s.id) || s.role === "optimizer");
  const emailToStaff = new Map(staff.map((s) => [s.email.toLowerCase(), s.id]));

  // Change events (both periods), attributed per event: author if a staff email, else assignees.
  const ev = await sql.query<{ client_id: string; d: string; email: string | null }>(
    `select client_id, to_char(change_date_time at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') as d, lower(user_email) as email
       from ads_change_events where client_id = any($1::text[]) and action = any($2::text[])
        and (change_date_time at time zone 'Asia/Ho_Chi_Minh')::date between $3::date and $4::date`,
    [ids, OPTIMIZED_ACTIONS, prev.start < period.start ? prev.start : period.start, period.end],
  ).catch(() => []);
  const authorStored = ev.some((e) => e.email);
  type Cnt = { author: number; assigned: number };
  const cnt = (from: string, to: string) => {
    const out = new Map<string, Cnt>();
    const bump = (sid: string, k: keyof Cnt) => { const c = out.get(sid) || { author: 0, assigned: 0 }; c[k]++; out.set(sid, c); };
    for (const e of ev) {
      if (e.d < from || e.d > to) continue;
      const author = e.email ? emailToStaff.get(e.email) : undefined;
      if (author) bump(author, "author");
      else for (const sid of assignees.get(e.client_id) || []) bump(sid, "assigned");
    }
    return out;
  };
  const cCur = cnt(period.start, period.end), cPrev = cnt(prev.start, prev.end);
  // Weeks (Mon–Sun) fully inside the period; else the 7 days ending at the period end.
  const weeks: { s: string; e: string }[] = [];
  { let s = period.start; while ((new Date(`${s}T00:00:00Z`).getUTCDay() + 6) % 7 !== 0) s = addDaysYmd(s, 1); const last = period.end > today ? today : period.end; while (addDaysYmd(s, 6) <= last) { weeks.push({ s, e: addDaysYmd(s, 6) }); s = addDaysYmd(s, 7); } if (!weeks.length) weeks.push({ s: addDaysYmd(last, -6), e: last }); }
  const evByAcc = new Map<string, string[]>();
  for (const e of ev) { const l = evByAcc.get(e.client_id) || []; l.push(e.d); evByAcc.set(e.client_id, l); }
  const pulled = new Set((await sql.query<{ client_id: string }>(`select distinct client_id from ads_change_pulls where ok and client_id = any($1::text[])`, [ids]).catch(() => [])).map((r) => r.client_id));

  // Previous period per-account spend / CPL vs target.
  const [pDays, pPlans] = await Promise.all([dailySpend(ids, prev.start, prev.end), readPlans(ids, prev.start.slice(0, 7))]);
  const prevAcc = new Map<string, { spend: number | null; ok: boolean | null }>();
  for (const id of ids) {
    const l = pDays.get(id) || [];
    const sp = l.length ? l.reduce((a, d) => a + d.cost, 0) : null;
    const cv = l.filter((d) => d.conv != null); const ld = cv.length ? cv.reduce((a, d) => a + (d.conv || 0), 0) : null;
    const cpl = sp && ld && ld > 0 ? sp / ld : null; const t = pPlans.get(id)?.target_cpl ?? null;
    prevAcc.set(id, { spend: sp, ok: cpl != null && t != null ? cpl <= t : null });
  }

  const reps = await sql.query<{ status: string; account_ids: string[]; sent_at: unknown }>(`select status, account_ids, sent_at from adsops_client_reports`).catch(() => []);
  const health = new Map(m.health.map((h) => [h.key, h]));
  const churn = new Map(m.churn.map((c) => [c.key, c]));
  const D = m.accounts_detail;

  const rows: StaffRow[] = people.map((s) => {
    const accs = (byStaff.get(s.id) || []).filter((a) => D[a]);
    const groups = [...new Set(accs.map((a) => D[a].group_key))];
    const detail: StaffAccount[] = accs.map((a) => {
      const d = D[a];
      const g = !a.startsWith("fb_") && pulled.has(a);
      const dates = evByAcc.get(a) || [];
      return {
        client_id: a, label: d.label, spend: d.spend, cpl: d.cpl, target_cpl: d.target_cpl,
        cpl_ok: d.cpl != null && d.target_cpl != null ? d.cpl <= d.target_cpl : null,
        pace_status: d.pace_status, health: health.get(d.group_key)?.score ?? null, alerts: d.alerts,
        last_opt_days: d.last_opt_at ? dayDiff(d.last_opt_at.slice(0, 10), today) : null,
        weekly_opt: g ? weeks.every((w) => dates.some((x) => x >= w.s && x <= w.e)) : null,
        shared: (assignees.get(a) || []).length > 1,
      };
    });
    const sumN = (v: (number | null)[]) => { const x = v.filter((n): n is number => n != null); return x.length ? x.reduce((a, b) => a + b, 0) : null; };
    const cplB = detail.filter((d) => d.cpl_ok != null);
    const pB = accs.map((a) => prevAcc.get(a)!).filter((x) => x.ok != null);
    const sentIn = (from: string, to: string) => reps.filter((r) => r.status === "sent" && (r.account_ids || []).some((a) => accs.includes(a)) && (() => { const t = iso(r.sent_at); if (!t) return false; const d = new Date(Date.parse(t) + 7 * 3600e3).toISOString().slice(0, 10); return d >= from && d <= to; })()).length;
    const pace = detail.filter((d) => d.pace_status);
    const hs = groups.map((g) => health.get(g)?.score).filter((x): x is number => x != null);
    const wk = detail.filter((d) => d.weekly_opt != null);
    const od = detail.map((d) => d.last_opt_days).filter((x): x is number => x != null);
    const cc = cCur.get(s.id), cp = cPrev.get(s.id);
    const anyGoogle = accs.some((a) => pulled.has(a));
    const cur: PerfNums = { spend: sumN(detail.map((d) => d.spend)), cpl_ok: cplB.length ? cplB.filter((d) => d.cpl_ok).length : null, cpl_basis: cplB.length, changes: anyGoogle || cc ? (cc?.author || 0) + (cc?.assigned || 0) : null, reports_sent: sentIn(period.start, period.end) };
    const prv: PerfNums = { spend: sumN(accs.map((a) => prevAcc.get(a)!.spend)), cpl_ok: pB.length ? pB.filter((x) => x.ok).length : null, cpl_basis: pB.length, changes: anyGoogle || cp ? (cp?.author || 0) + (cp?.assigned || 0) : null, reports_sent: sentIn(prev.start, prev.end) };
    return {
      id: s.id, name: s.display_name || s.email, email: s.email, role: s.role,
      accounts: accs.length, clients: groups.length, cur, prev: prv,
      pace_ok: pace.length ? pace.filter((d) => d.pace_status === "on_track").length : null, pace_basis: pace.length,
      health_avg: hs.length ? Math.round(hs.reduce((a, b) => a + b, 0) / hs.length) : null,
      red_clients: groups.filter((g) => health.get(g)?.color === "red").length,
      changes_author: cc?.author || 0, changes_assigned: cc?.assigned || 0,
      weekly_opt: wk.length ? wk.filter((d) => d.weekly_opt).length : null, weekly_basis: wk.length,
      avg_opt_days: od.length ? Math.round((od.reduce((a, b) => a + b, 0) / od.length) * 10) / 10 : null,
      alerts: detail.reduce((a, d) => a + d.alerts.length, 0),
      drafts: reps.filter((r) => r.status === "draft" && (r.account_ids || []).some((a) => accs.includes(a))).length,
      overdue_reports: groups.filter((g) => churn.get(g)?.no_report).length,
      churn_high: groups.filter((g) => churn.get(g)?.level === "high").length,
      churn_medium: groups.filter((g) => churn.get(g)?.level === "medium").length,
      shared_accounts: detail.filter((d) => d.shared).length,
      detail: detail.sort((a, b) => (b.spend || 0) - (a.spend || 0)),
    };
  });
  rows.sort((a, b) => (b.cur.spend || 0) - (a.cur.spend || 0));
  return { period, prev, weeks: weeks.length, author_stored: authorStored, rows };
}
